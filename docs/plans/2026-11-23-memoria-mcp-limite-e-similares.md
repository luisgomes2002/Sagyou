# Plano de implementação: Memória no MCP — leitura com limite e pares parecidos

Status: approved by Luis on 2026-11-23
Spec: docs/specs/2026-11-23-memoria-mcp-limite-e-similares.md
Branch: feature/memoria-mcp-limite-e-similares

**Objetivo:** `read_memory` lê o corpo em páginas e `check_memories` aponta pares de memórias parecidas, com regras puras no core que o Rust possa reproduzir por fixture.

**Arquitetura:** duas funções puras em `packages/core/src/memory.ts` (`readMemoryPage`, `similarMemories`), cobertas por fixtures JSON; o broker (`sagyou-mcp.ts`) valida os argumentos novos, chama essas funções e formata a resposta. Sem dado persistido, sem tela.

## Restrições Globais

- **Testes só no CI** (regra do Luis): nada de `npm test`/`typecheck`/`lint` local; os passos "rode" valem como push + `gh pr checks`. O **PR em rascunho** é aberto antes da Task 1. **Vermelho observado de verdade:** nas Tasks 1, 2 e 3 o commit só dos testes vai primeiro, e a implementação só é empurrada **depois** de o CI daquele commit terminar vermelho pelo motivo certo (lição do PR #68: um push seguinte cancela o CI em andamento).
- Prettier do repositório (`npx --yes prettier@3.10.1`); em `sagyou-mcp.ts` formatar só os trechos novos (há dívida antiga).
- **Valores exatos da spec:**
  - Página: `offset` inteiro ≥ 0 (padrão 0); `limit` inteiro de **500 a 12 000**, padrão **6 000**; unidade = **pontos de código Unicode** (`Array.from`).
  - Resposta de `read_memory`: os campos de hoje (`id`, `title`, `type`, `tags`, `projectId`, `scope`, `updatedAt`, `warning`) + `body` (a página), `offset`, `limit`, `totalChars`, `truncated`, e `nextOffset` só quando truncado. `offset` além do fim: `body: ""`, `truncated: false`, sem `nextOffset`.
  - Recusas: `limit precisa ser um inteiro de 500 a 12000.` e `offset precisa ser um inteiro maior ou igual a 0.` (sem ajuste silencioso).
  - Similaridade: termos = palavras de **título e tags**, em minúsculas, sem acento (`titleKey`), letras/dígitos (`/[\p{L}\p{N}]{3,}/gu`), 3+ caracteres, sem repetição; `|A∩B| / |A∪B|` **≥ 0,6** comparado com inteiros (`shared * 10 >= total * 6`, sem ponto flutuante); cada memória com **≥ 2 termos**; corpos diferentes (`body.trim()`); só ativas e sem handoff; par com o mesmo `titleKey` fica de fora (já é do `findConflicts`); ordem: mais parecido primeiro, empate por `a` depois `b`; `similarity` = `Math.round(shared * 100 / total) / 100`; no máximo **8** pares na resposta, com o total real.
  - `check_memories` mantém `total`, `truncated`, `conflicts` e ganha `similar: { total, truncated, pairs: [{ similarity, a: { id, title, snippet }, b: { id, title, snippet } }] }`; o snippet é o `conflictSnippet` (240 caracteres).
- **(decisão do construtor) Termos:** o texto analisado é `título + ' ' + tags.join(' ')` (um espaço entre o título e as tags e entre as tags, para a última palavra de um não fundir com a primeira do outro), passado **uma vez** por `titleKey`, e daí `/[\p{L}\p{N}]{3,}/gu`.
- **(decisão do construtor) Snippet:** reaproveita o `conflictSnippet` **como está** (corta em 240 unidades UTF-16 e acrescenta `…`, então vem com até **241**); os testes afirmam `<= 241`. Não se mexe nele para não alterar `conflicts` nem `list_recent_memories`.
- **(decisão do construtor) Argumentos de página:** `undefined` = padrão; `null`, texto, decimal, negativo ou fora da faixa = recusa (**não** usar `??`). Os dois inválidos juntos: o erro de `limit` vem primeiro, depois o de `offset` (a mesma ordem de `list_recent_memories`).
- **(decisão do construtor) Compatibilidade da unidade:** o corte de 6 000 passa de unidades UTF-16 para **pontos de código**; só difere de hoje num corpo com emoji ou outro caractere fora do plano básico (ele pode deixar de ser `truncated`). Registrado aqui e no PR.
- `packages/core` sem Node (`no-node.test.ts`). Sem mudança de dados persistidos, de IPC ou de tela.
- A trava de leitura entre projetos (PR #68) continua igual: a página é servida depois do cartão, e um argumento inválido **não** abre cartão.
- Versão: não sobe enquanto a 1.14.0 não for publicada (conferir `git tag` no PR); se já saiu, 1.15.0 em `apps/desktop/package.json` e `package-lock.json`.

## Foco de Review

1. **Unicode.** `offset`, `limit` e `nextOffset` contam pontos de código; um emoji conta 1 e nunca é partido no meio. Esperado: o corpo reconstituído pelas páginas é igual ao original. Testado na Task 1 (fixture com emoji) e na Task 2.
2. **Argumento inválido como oráculo.** `read_memory` valida `offset`/`limit` **antes** de procurar a memória e antes do cartão: o mesmo erro para memória inexistente, de outro projeto ou válida, e nenhum cartão aberto à toa. Testado na Task 2.
3. **Compatibilidade.** Sem parâmetros, o corpo é os primeiros 6 000 caracteres (como hoje, só que contados em pontos de código) com os mesmos campos e `truncated`; só ganha `totalChars`/`offset`/`limit`/`nextOffset`. Testado na Task 2 (o teste atual de 6 100 caracteres continua passando).
4. **Decaimento.** Cada página lida chama `touchMemory` uma vez (o limite de uma vez por hora já existe); `list_recent_memories`/`check_memories` continuam sem tocar. Testado na Task 2 e 3.
5. **Falso positivo e custo da similaridade.** Handoff, arquivada, mesmo título (já é contradição), corpo igual e memória com menos de 2 termos nunca viram par; 500 memórias terminam dentro do tempo limite padrão do teste (sem asserção de tempo própria). Testado na Task 1.
6. **Contrato de `check_memories`.** `conflicts`/`total`/`truncated` ficam idênticos (testes existentes de conflitos, sem alteração); `ai:memory:conflicts` (MemoryView) segue só com contradições porque `findConflicts` **não é alterada** (os testes atuais de `findConflicts` em `memory.test.ts` continuam sem mudança). Testado na Task 3.

### Task 1: Regras puras no core (página de corpo e pares parecidos) com fixtures
**Arquivos:** Modificar `packages/core/src/memory.ts`; Criar `packages/core/src/__tests__/fixtures/memory-page-vectors.json`, `packages/core/src/__tests__/fixtures/memory-similar-vectors.json`; Teste: criar `packages/core/src/__tests__/memory-page-similar.test.ts`
**Interfaces:**
- Produz (exportadas de `@sagyou/core/memory`):
  - `export const READ_PAGE_DEFAULT = 6_000`, `READ_PAGE_MIN = 500`, `READ_PAGE_MAX = 12_000`
  - `export interface MemoryReadPage { body: string; totalChars: number; truncated: boolean; nextOffset?: number }`
  - `export function readMemoryPage(body: string, offset: number, limit: number): MemoryReadPage` — pontos de código; `offset`/`limit` já validados pelo chamador (a função trata `offset > total` como página vazia).
  - `export function memoryTerms(m: Pick<AiMemory, 'title' | 'tags'>): string[]` — ordenados, sem repetição.
  - `export interface SimilarMemoryPair { a: string; b: string; shared: number; total: number; similarity: number }`
  - `export function similarMemories(memories: AiMemory[]): SimilarMemoryPair[]` — todos os pares que passam, já ordenados (sem o corte de 8); `a` < `b` pelo id.
- [ ] Passo 1: escreva os testes que falham. O teste lê os dois JSON e percorre os casos (é o contrato que o Rust vai ler):
  - `memory-page-vectors.json`: lista de `{ name, body, offset, limit, expect: { body, totalChars, truncated, nextOffset? } }` com: corpo de 10 letras, `offset 0 limit 4` → `"abcd"`, `totalChars 10`, `truncated true`, `nextOffset 4`; `offset 8 limit 4` → `"ij"`, `truncated false`, sem `nextOffset`; limite exato (`offset 6 limit 4` → `"ghij"`, `truncated false`); `offset 10` e `offset 99` → `body ""`, `truncated false`, sem `nextOffset`; corpo vazio; emoji (`"a😀b😀c"`, `offset 1 limit 2` → `"😀b"`, `nextOffset 3`, `totalChars 5`); acento composto (`"é"` decomposto conta 2 pontos, `"é"` composto conta 1, sem normalizar).
  - Propriedade (no próprio teste): para um corpo com emoji, concatenar as páginas seguindo `nextOffset` (limite 3) reconstrói o corpo original.
  - `memory-similar-vectors.json`: `{ memories: [...], expect: [{ a, b, shared, total, similarity }] }` com: o exemplo da spec ("Usar SQLite no desktop" tags `banco`,`desktop` × "Banco SQLite no app desktop" tags `banco`,`desktop`) → `shared 3`, `total 5`, `similarity 0.6`; um par com `shared 2` de `total 4` (0,5) **fora**; um par com 1 termo em comum **fora**; memória com 1 só termo **fora**; mesmo `titleKey` e corpos diferentes **fora** (é do `findConflicts`); corpo igual **fora**; handoff e arquivada **fora**; acentos e maiúsculas iguais (`"Decisão"` × `"decisao"`) contam como o mesmo termo; palavras de 1–2 letras ("no", "de") não contam; empate de similaridade desempata por `a` e depois `b`; três memórias parecidas entre si devolvem 3 pares ordenados.
  - Teste de custo: 500 memórias ativas geradas no teste terminam e devolvem um array (sem asserção de tempo).
- [ ] Passo 2: commit **só dos testes e das fixtures**, push no PR rascunho e CI. **Espere terminar vermelho** (`readMemoryPage`/`similarMemories` não existem) antes do passo 3.
- [ ] Passo 3: implemente em `memory.ts`: `readMemoryPage` usa `Array.from(body)` e `slice(offset, offset + limit).join('')`; `memoryTerms` junta título e tags, passa por `titleKey`, extrai `/[\p{L}\p{N}]{3,}/gu`, remove repetição e ordena; `similarMemories` filtra (ativas, sem handoff), calcula os termos uma vez por memória, compara todos os pares com inteiros (`shared * 10 >= total * 6`, `terms >= 2`, `titleKey` diferente, `body.trim()` diferente) e ordena por `shared/total` decrescente comparando por multiplicação cruzada, depois `a`, depois `b`.
- [ ] Passo 4: CI. Esperado: PASSA.
- [ ] Passo 5: commit `feat(memory): página de corpo e pares parecidos no core`

### Task 2: `read_memory` em páginas
**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/sagyou-mcp.ts`; Teste: `apps/desktop/src/main/__tests__/sagyou-mcp.test.ts`
**Interfaces:**
- Consome (Task 1): `readMemoryPage`, `READ_PAGE_DEFAULT`, `READ_PAGE_MIN`, `READ_PAGE_MAX`.
- Produz: `readPageArgs(args: unknown): { offset: number; limit: number } | { error: string }` (módulo, não exportada); `memoryReadResult(memory, page)` passa a receber `{ offset, limit }` e devolve os campos da spec; o schema de `read_memory` ganha `offset` (`integer`, `minimum: 0`) e `limit` (`integer`, `minimum: 500`, `maximum: 12000`); a descrição ganha `O corpo vem em páginas (limit, padrão 6000, e offset); use nextOffset para continuar.`; `memoryReadTarget` devolve `null` para `read_memory` com argumentos de página inválidos (não abre cartão à toa).
- [ ] Passo 1: escreva os testes que falham:
  - Memória de 14 000 caracteres (`'a'` repetido, com marcas distintas nas posições 0, 6000, 12000): sem parâmetros → `body` de 6 000, `totalChars 14000`, `offset 0`, `limit 6000`, `truncated true`, `nextOffset 6000`; `offset 6000` → 6 000 caracteres e `nextOffset 12000`; `offset 12000` → 2 000, `truncated false`, **sem** a chave `nextOffset`; `limit 500` → 500 e `nextOffset 500`; `offset 99999` → `body ""`, `truncated false`.
  - Memória pequena: igual a hoje (`truncated false`, `totalChars` = tamanho) e os campos antigos presentes (`id`, `title`, `type`, `tags`, `projectId`, `scope`, `updatedAt`, `warning`).
  - Memória com emoji: as páginas (limite 500) seguindo `nextOffset` reconstroem o corpo original.
  - Argumentos inválidos (`limit 499`, `limit 12001`, `limit 1.5`, `limit "x"`, `limit null`, `offset -1`, `offset 1.5`, `offset "0"`, `offset null`) → recusa com o texto exato da spec; com os dois inválidos o erro é o de `limit`; **a mesma recusa para uma memória inexistente e para a de outro projeto**, sem chamar `approveProjectRead` e sem `touchMemory`.
  - Cada leitura válida chama `touchMemory` uma vez (inclusive a página 2); a recusa por argumento não chama.
  - A trava de projeto continua: outra projeto com argumentos válidos pede o cartão (o teste existente cobre; adicionar um caso com `offset`).
  - O teste existente de 6 100 caracteres (`body` com 6 000 e `truncated true`) continua verde, sem alteração.
  - A lista de ferramentas mostra `offset` e `limit` no schema e `nextOffset` na descrição.
- [ ] Passo 2: commit **só dos testes**, push e CI. **Espere o vermelho** antes do passo 3.
- [ ] Passo 3: implemente. No ramo `read_memory` do `handleLine`, validar `readPageArgs` **antes** de procurar a memória (a recusa por argumento vem primeiro e é a mesma para qualquer id); depois seguir como hoje e servir `memoryReadResult(memory, page)`, que usa `readMemoryPage(memory.body, offset, limit)`; remover o `MEMORY_BODY_LIMIT` (agora `READ_PAGE_DEFAULT`).
- [ ] Passo 4: CI. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): read_memory lê o corpo em páginas`

### Task 3: `check_memories` com pares parecidos
**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/sagyou-mcp.ts`; Teste: `apps/desktop/src/main/__tests__/sagyou-mcp.test.ts`
**Interfaces:**
- Consome (Task 1): `similarMemories`, `SimilarMemoryPair`.
- Produz: `memoryConflictResult(memories)` devolve também `similar: { total, truncated, pairs }` (corte de **8**, `MEMORY_SIMILAR_LIMIT = 8`); cada par `{ similarity, a: { id, title, snippet }, b: { id, title, snippet } }` com `snippet = conflictSnippet(body)`; a descrição de `check_memories` passa a dizer `Também aponta pares parecidos (similar): é só um sinal, não indica qual dos dois deve ficar; resolve_memory_conflict vale só para contradições.`
- [ ] Passo 1: escreva os testes que falham (broker com `memoriesForConflict` devolvendo um acervo):
  - Dois títulos parecidos da spec → `similar.total 1`, `pairs[0].similarity 0.6`, ids e títulos certos, snippet de até 241 caracteres (240 + `…`, o `conflictSnippet` de hoje).
  - Sem pares: `similar: { total: 0, truncated: false, pairs: [] }`.
  - 10 pares: cinco memórias com os mesmos termos em ordem diferente no título (`titleKey` distinto, corpos distintos) dão C(5,2)=10 pares de similaridade 1: `similar.total 10`, `truncated true`, `pairs` com 8, em ordem de `a` e `b` crescentes (o empate); a ordem por similaridade decrescente já é provada na Task 1.
  - Um par de **mesmo título** com corpos diferentes aparece em `conflicts` (como hoje) e **não** em `similar`; `conflicts`/`total`/`truncated` ficam idênticos ao de hoje (o teste existente de conflitos continua verde sem alteração).
  - Handoff e arquivada nunca entram em `similar`.
  - A chamada não chama `touchMemory`; a trava de projeto continua valendo (já coberta; um caso com `projectId` de outro projeto pede o cartão).
  - A descrição de `check_memories` contém `não indica qual dos dois deve ficar`.
- [ ] Passo 2: commit **só dos testes**, push e CI. **Espere o vermelho** (`similar` ausente) antes do passo 3.
- [ ] Passo 3: implemente em `memoryConflictResult`.
- [ ] Passo 4: CI. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): check_memories aponta pares parecidos`

### Task 4: Fechamento — docs, suíte e PR
**Arquivos:** Modificar `CLAUDE.md`, `GUIDE.md`
- [ ] Passo 1: docs: em `CLAUDE.md` e `GUIDE.md`, descrever `read_memory` em páginas (parâmetros, unidade em pontos de código, resposta, padrão 6 000, recusas, argumento validado antes de procurar a memória e antes do cartão) e `check_memories` com `similar` (regra de termos, 0,6, 2 termos, exclusões, corte de 8; é só sinal e `resolve_memory_conflict` continua só para contradições); mencionar que as regras vivem no core com fixtures (`memory-page-vectors.json`, `memory-similar-vectors.json`) para o Rust reproduzir.
- [ ] Passo 2: suíte completa, typecheck e lint no CI (`gh pr checks`), sem local.
- [ ] Passo 3: verificação no app (`npm run dev`), curta, porque é só MCP: (a) pedir `read_memory` de uma memória grande por um CLI do Fleet e seguir `nextOffset` até o fim; (b) um `limit` inválido volta com o texto da regra e sem cartão; (c) `check_memories` num projeto com dois títulos parecidos mostra `similar`.
- [ ] Passo 4: PR (estágio 5): sem mudança de dados persistidos; versão: conferir `git tag` e `gh release list`: sem a tag `v1.14.0`, nada sobe (o `package.json` já está em 1.14.0); com ela publicada, subir para 1.15.0. O PR cita a mudança de unidade (UTF-16 → pontos de código).
- [ ] Passo 5: commit `docs(memoria-mcp-limite-e-similares): documentação da leitura em páginas e dos pares parecidos`
