# Memória no MCP: leitura com limite e pares parecidos

Status: approved by Luis on 2026-11-23
Branch: feature/memoria-mcp-limite-e-similares

## Por quê

Fecha as duas tasks que faltavam do lote "Memória no MCP", ambas inspiradas no ai-memory 3.3.0:

1. **`read_memory` devolve o corpo inteiro** (hoje corta em 6 000 caracteres com um `truncated` solto e não deixa ler o resto). Uma memória grande consome muito contexto do agente de uma vez, e quem precisa do final não consegue pedir. É a task "Memória: `read_memory` com limite (`max_chars`, `truncated`, `total_chars`)".
2. **`check_memories` só acha contradição de título idêntico** (`findConflicts`). Duas memórias que falam da mesma coisa com títulos diferentes ("Usar SQLite no desktop" e "Banco: SQLite no app desktop") passam batido, e o acervo apodrece com duplicatas. É a task "Memória: `check_memories` apontar pares parecidos (`similarity_candidate`)".

A task "Futuro: subagentes/sessões filhas não devem gravar handoff" **continua só um lembrete**: o Sagyou ainda não cria sessões filhas a partir de uma sessão do Fleet, então não há o que implementar.

## Objetivos

- `read_memory` lê o corpo **em páginas**: o agente pede um trecho e recebe o total e onde continuar.
- A regra de página é **simples e idêntica** onde for reproduzida (desktop TypeScript hoje, crate `core`/`agent` em Rust depois), testável por fixture.
- `check_memories` aponta, além das contradições de hoje, **pares parecidos** (`similarity_candidate`), só como sinal: não bloqueia, não decide qual substitui qual e não altera nada.

## Fora do escopo

- Embeddings, FTS ou qualquer modelo para achar similaridade: a regra é sobreposição de termos, pura e determinística.
- Resolver, arquivar ou mesclar pares parecidos pelo MCP: `resolve_memory_conflict` continua valendo **só** para contradições de título idêntico. Um par parecido o agente resolve com `update_memory`/`archive_memory` por decisão dele ou do usuário.
- Paginar `search_memory` e `list_recent_memories` (já têm limite próprio) e ler uma seção por título em `read_memory`.
- Mudar o que o MemoryView mostra: `ai:memory:conflicts` continua só com contradições.
- Sessões filhas e handoff (task "Futuro").

## Decisões (de Luis)

- Fazer as duas tasks juntas, numa spec só.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

**`read_memory` em páginas**
- **Parâmetros novos, opcionais:** `offset` (inteiro ≥ 0, padrão 0) e `limit` (inteiro de 500 a 12 000, padrão **6 000**, o corte de hoje). O padrão mantém o comportamento atual para quem não passa nada. Segue o padrão `limit`/`offset`/`truncated`/`nextOffset` do `read_tasks` e do `read_notes`.
- **Unidade: pontos de código Unicode** (caracteres, não unidades UTF-16 do JavaScript), para o Rust (`chars()`) reproduzir sem adivinhar. Um emoji conta 1.
- **Resposta:** os campos de hoje (`id`, `title`, `type`, `tags`, `projectId`, `scope`, `updatedAt`, `warning`) mais `body` (só a página), `offset`, `limit`, `totalChars` (tamanho do corpo inteiro), `truncated` (`offset + caracteres devolvidos < totalChars`) e, quando truncado, `nextOffset` (`offset + caracteres devolvidos`).
- **`offset` além do fim:** devolve `body: ""`, `truncated: false`, sem `nextOffset` (não é erro).
- **Argumento inválido** (`offset`/`limit` não inteiro, negativo, `limit` fora de 500–12 000): recusa com o campo e a regra, sem ajustar o valor (como `list_recent_memories`): `limit precisa ser um inteiro de 500 a 12000.` e `offset precisa ser um inteiro maior ou igual a 0.`
- **Contador de decaimento:** cada página lida conta como leitura (`touchMemory`, que já tem o limite de uma vez por hora por memória), então ler a memória em várias páginas não a faz "esquentar" mais do que ler uma vez.
- **Descrição da ferramenta:** diz que o corpo vem em páginas e como continuar (`nextOffset`).
- A trava de leitura entre projetos continua valendo igual: a página é servida depois do cartão, quando houver.

**Pares parecidos**
- **Entrada:** as mesmas memórias que `check_memories` já recebe (o projeto pedido mais as globais), só **ativas** e **sem handoff**.
- **Termos de uma memória:** as palavras do título **e** das tags, em minúsculas, sem acento, com letras e dígitos, com **3 ou mais** caracteres, sem repetição.
- **Similaridade:** `|A ∩ B| / |A ∪ B|` (Jaccard) entre os termos das duas. Entra como par parecido quando **≥ 0,6**, cada uma tem **pelo menos 2 termos**, e **os corpos são diferentes** (corpo igual é duplicata inofensiva, como hoje).
- **Não repete o que já é contradição:** um par com o mesmo título (que o `findConflicts` já aponta) não aparece também em `similar`.
- **Ordem e limite:** do mais parecido para o menos, desempate pelos ids; no máximo **8** pares na resposta (o limite de hoje para contradições), com o total real.
- **Resposta de `check_memories`:** o formato de hoje (`total`, `truncated`, `conflicts`) **não muda** e ganha `similar: { total, truncated, pairs: [{ similarity, a: { id, title, snippet }, b: { id, title, snippet } }] }`, em que `similarity` é o número com 2 casas decimais. O trecho segue o `conflictSnippet` (240 caracteres).
- **Aviso:** a descrição da ferramenta diz que `similar` é só um sinal e que não indica qual das duas deve ficar.
- **Custo:** o acervo ativo tem no máximo 500 memórias (`MEMORY_MAX`); comparar todos os pares é barato e roda só quando `check_memories` é chamado.
- **Lugar da regra:** funções puras em `packages/core/src/memory.ts` (`memoryTerms`, `similarMemories`), sem Node, com testes de fixture, para o celular e o Rust poderem reaproveitar.

## Comportamento

**`read_memory` de uma memória de 14 000 caracteres**
1. `read_memory { id }` → `body` com os primeiros 6 000, `totalChars: 14000`, `truncated: true`, `nextOffset: 6000`.
2. `read_memory { id, offset: 6000 }` → os 6 000 seguintes, `nextOffset: 12000`.
3. `read_memory { id, offset: 12000 }` → os 2 000 finais, `truncated: false`, sem `nextOffset`.
4. `read_memory { id, limit: 500 }` → 500 caracteres, `nextOffset: 500`.
5. Uma memória pequena responde como hoje, com `truncated: false`.

**`check_memories` com dois títulos parecidos**
- "Usar SQLite no desktop" (tags `banco`, `desktop`) e "Banco SQLite no app desktop" (tags `banco`, `desktop`) têm termos `{usar, sqlite, desktop, banco}` e `{banco, sqlite, app, desktop}`: 3 em comum de 5 → 0,60 → aparecem em `similar` com `similarity: 0.6`.
- Dois títulos sem termos em comum, ou com 1 termo só, não aparecem.
- Handoffs e memórias arquivadas nunca entram.
- Sem pares parecidos: `similar: { total: 0, truncated: false, pairs: [] }`.

## Dados

- **Sem mudança de dados.** Nada novo em SQLite, `userData`, backup ou sync. As duas mudanças são só de leitura e de resposta do MCP.
- **Compatibilidade:** quem chama `read_memory` sem os parâmetros novos recebe o corpo até 6 000 como hoje, agora com `totalChars` a mais e `offset`/`limit`/`nextOffset` no mesmo formato. Quem lê `check_memories` e ignora `similar` não percebe diferença.

## Telas

- Nenhuma. É só o MCP.

## Perguntas em aberto

(nenhuma)
