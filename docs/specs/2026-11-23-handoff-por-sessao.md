# Handoff por sessão e proteção de edição de memória

Status: approved by Luis on 2026-11-23
Branch: feature/handoff-por-sessao

## Por quê

Hoje o handoff de terminal é **um por projeto** (`handoff:<projectId>`, `handoffId` em `packages/core/src/memory.ts`) e só é gravado quando o terminal sai. Isso quebra o uso que o Luis quer: abrir **mais de um terminal do mesmo projeto** para trabalhar em partes diferentes do código.

1. Dois terminais do mesmo projeto escrevem na mesma linha: quem sair por último apaga o handoff do outro.
2. Uma sessão ainda em andamento não tem handoff nenhum. Quem abre outra sessão no mesmo projeto não sabe que ela existe nem no que ela mexe.
3. Se o PC travar ou desligar no meio, o handoff nunca é escrito (só a saída normal grava). A task "Avaliar: handoff de sessão que terminou sem saída normal (crash)" é este caso.
4. O `update_memory` (`mcp-write-tools.ts`) troca o corpo inteiro e não confere versão: dois agentes editando a mesma memória, o último sobrescreve o outro sem aviso.

Sessões abertas pelo Fleet nascem em branco e **não recebem briefing** (só `ai:code-agent:run` com pedido inicial monta um). O canal que alcança essas sessões é o MCP, que o CLI consulta sob demanda. Por isso o que uma sessão precisa saber sobre as outras tem de estar numa ferramenta de leitura do MCP, não só no briefing.

## Objetivos

- Cada sessão de terminal tem o **seu** handoff; duas sessões do mesmo projeto nunca se sobrescrevem.
- O handoff existe **desde o início da sessão** e é atualizado enquanto ela roda. Assim sobrevive a queda, travamento ou desligamento do PC.
- Uma sessão nova consegue ver as **outras sessões em andamento** do mesmo projeto (assunto até agora e arquivos já alterados) antes de começar a mexer.
- Sessão que não saiu normalmente aparece como **interrompida** na próxima abertura do app, nunca como "em andamento" para sempre.
- `update_memory` pode ser chamado com `expectedUpdatedAt` e recusa a escrita se a memória mudou desde a leitura.

## Fora do escopo

- Edição por seção (heading) no `update_memory` (passo 2 da task original).
- Limite de tamanho do `read_memory`, escopo por resultado do `search_memory` e `similarity_candidate` no `check_memories`: ficam em outras specs.
- O bug da ordenação por data em `selectRecentMemories` (`sagyou-fix` à parte). Este trabalho depende dele **estar corrigido antes**, porque listar os handoffs mais recentes usa essa ordenação.
- Guardar o texto da conversa do terminal. O handoff continua sendo um breadcrumb; o log completo fica só no arquivo da run, gravado na saída.
- Impedir ou travar duas sessões de editarem o mesmo arquivo. Cada sessão tem a sua worktree e sessões interativas não aplicam o diff ao projeto; esta spec só **mostra** o que cada uma está mexendo.
- Recuperar worktrees órfãs. A limpeza que o app faz ao abrir continua como está.
- Subagentes e sessões filhas (task "Futuro"): continua só um lembrete.

## Decisões (de Luis)

- **Um handoff por sessão**, não por projeto.
- Sessões **em andamento** também são visíveis para as outras do mesmo projeto.
- A proteção contra queda/desligamento entra **nesta mesma spec**, com o mesmo mecanismo (não é uma spec separada).
- `update_memory` com `expectedUpdatedAt` entra junto.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Id novo:** `handoff:<projectId|global>:<runId>`. `handoffId(projectId, runId?)` no core; sem `runId` devolve o id antigo, para o código legado e os registros já gravados.
- **Handoffs antigos** (`handoff:<projectId>`) ficam como estão. Continuam sendo `type: 'handoff'`, decaem pelo TTL de sempre e contam no limite de cada projeto.
- **Estados** (no corpo, nas tags e no prefixo do título): `em andamento`, `interrompida`, e os de hoje (`completed`, `cancelled`, `failed`, `not_applied`). Títulos: `[em andamento] Sessão de terminal: <assunto>` e `[interrompida] Sessão de terminal: <assunto>`; sem assunto: `[em andamento] Sessão de terminal` / `[interrompida] Sessão de terminal`. O de saída normal mantém o título de hoje.
- **Quando grava (checkpoint):** ao abrir a sessão; a cada escrita aplicada por MCP (decisão, task com timer, etc., via `run-activity`), com no máximo uma gravação a cada 15 s por run; e a cada 2 minutos enquanto a run estiver viva. Só grava se o texto mudou. A lista de arquivos alterados vem do diff da worktree no momento do checkpoint.
- **Saída normal:** a mesma linha passa para o estado final de hoje, com a lista de arquivos do diff arquivado.
- **Interrompida:** ao abrir o app, antes de o sync reconciliar, todo handoff `em andamento` cuja run não está viva neste processo (nenhuma está, no início) passa para `interrompida`, com a linha `A sessão terminou sem saída normal (o app fechou ou o PC desligou). Último registro: <data>.` O handoff guarda o que o Sagyou sabia no último checkpoint.
- **Limite por projeto:** `runMemoryPrune` mantém os **5 handoffs mais recentes** por projeto (por `updatedAt`) e arquiva o resto. Nunca arquiva um `em andamento` com run viva nem um handoff fixado (pinned).
- **Sync:** os checkpoints `em andamento` **não geram versão de sync** (a escrita local não captura); só a gravação que sai de `em andamento` (finalização ou marcação `interrompida`) é capturada. Assim os outros aparelhos nunca veem uma sessão "em andamento" que não existe lá, e o histórico de versões não enche de checkpoints. O plano precisa confirmar com `reconcileSyncRecords` que uma linha `em andamento` deixada por uma queda é versionada só depois de marcada `interrompida`.
- **`list_active_sessions` (ferramenta de leitura do MCP):** não persiste nada. Cruza os handoffs `em andamento` com as runs vivas do app e devolve, no máximo 20: `runId`, `projectId`, `iniciadaEm`, `ultimoRegistroEm`, `assunto`, `acoes` (resumos das escritas aplicadas) e `arquivos` (até 20). Exclui a sessão que está perguntando. Sem argumentos, uma sessão de projeto vê o seu projeto; sessão geral e o token externo veem todos os projetos; `projectId` opcional filtra. Leitura não mexe no decaimento. Um handoff `em andamento` sem run viva (backup restaurado, por exemplo) **não** aparece.
- **Briefing:** quando existe pedido inicial, o briefing ganha o bloco `SESSÕES EM ANDAMENTO NESTE PROJETO` (até 3, só `assunto` e `arquivos`), fora do limite dos handoffs recentes. Sessões abertas em branco não recebem briefing e usam a ferramenta.
- **Como o agente descobre:** a descrição de `list_active_sessions` diz para chamá-la **ao começar e antes de editar arquivos**; o texto de recall das ferramentas de memória (hoje no briefing e nas descrições de `search_memory`/`list_recent_memories`) cita também o estado `em andamento`/`interrompida`.
- **`update_memory`:** `expectedUpdatedAt` é **opcional** (sem ele, funciona como hoje). O valor é o `updatedAt` que `read_memory` e `search_memory` já devolvem, comparado como texto exato, não como data. `resolve_memory_conflict` fica como está.
- **`ai:memory:handoff`** (IPC sem chamador conhecido): continua usando o id antigo por projeto. O plano confirma se há chamador; se não houver, é candidato à limpeza, não é removido aqui.

## Comportamento

**Duas sessões no mesmo projeto**
1. A abre às 10h: nasce `handoff:P:runA` com `[em andamento] Sessão de terminal`.
2. B abre às 10h20 no mesmo projeto, chama `list_active_sessions` e recebe A com assunto, ações e arquivos até o último checkpoint.
3. Cada uma regrava só a sua linha. Nenhuma toca na outra.
4. Quando A sai, `handoff:P:runA` vira `completed` (ou o estado que for) e B continua `em andamento`.

**PC travou ou desligou**
1. As linhas `em andamento` ficam no SQLite como estavam no último checkpoint (até 2 min de defasagem, ou 15 s após a última escrita por MCP).
2. Na próxima abertura do app, todas viram `interrompida`.
3. Uma sessão nova vê o rastro por `list_recent_memories` com `type: 'handoff'` e `read_memory`. O corpo mostra assunto, ações, pendências e os arquivos do último checkpoint.

**`list_active_sessions`**
- Sem outras sessões vivas: `{ sessoes: [], total: 0 }`.
- Com argumentos inválidos (`projectId` que não é texto): recusa com o texto padrão de argumento inválido do broker.
- Em sessão de projeto, `projectId` de **outro** projeto é aceito (leitura entre projetos já é permitida no broker); em sessão geral sem `projectId`, lista todos os projetos.

**`update_memory` com `expectedUpdatedAt`**
- Igual ao `updatedAt` atual: edita como hoje.
- Diferente: não escreve e responde exatamente `A memória foi alterada depois da sua leitura (agora: <updatedAt>). Leia de novo com read_memory e refaça a edição.`
- Memória inexistente ou de handoff: as recusas de hoje continuam e vêm antes.
- Ausente: sem checagem, como hoje.

**Limite de 5 handoffs**
- Passou de 5 ativos no projeto: os mais antigos (por `updatedAt`) são **arquivados**, nunca apagados. O usuário os restaura no MemoryView.
- Handoffs `global` (sem projeto) seguem a mesma regra.

## Dados

- **Sem mudança de tabela ou coluna.** Continua a tabela `memory` (satélite, fora do `persistAll`).
- **Ids novos** de handoff (`handoff:<projectId|global>:<runId>`) e **dois estados novos** no corpo/tags/título. Os registros antigos continuam válidos e legíveis.
- ⚠️ **Mudança em dado persistido de memória:** o formato do id dos handoffs muda, e uma versão antiga do app, ao ler um handoff novo, o trata como uma memória `handoff` qualquer (o tipo não muda). A versão antiga continua gravando o id por projeto, sem conflito. Não é uma quebra de schema.
- **Sync:** memórias são registros sincronizados; os handoffs novos viajam como qualquer memória, **só depois de finalizados** (ver decisão do construtor). Mais linhas de handoff por projeto (até 5 ativas mais as arquivadas) viajam para os outros aparelhos.
- **Backup:** handoffs seguem no backup como memórias. Um backup restaurado pode trazer linhas `em andamento`; a próxima abertura as marca `interrompida` e `list_active_sessions` não as lista (não há run viva).
- **Core:** `handoffId` está em `packages/core/src/memory.ts` (compartilhado com o celular). O plano confere se algum teste de fixture (`sync-vectors.json`, que não pode ser regenerado) usa um id de handoff; a mudança é aditiva e não deve afetar hashes.
- `expectedUpdatedAt` não persiste nada.

## Telas

- **Sem tela nova.** O `MemoryView` lista os handoffs como já faz, agora com o prefixo `[em andamento]` ou `[interrompida]` no título. Nenhuma ação nova no Fleet.
- Textos em pt-BR conforme as decisões acima; ferramentas MCP têm descrição em pt-BR, como as demais.

## Perguntas em aberto

(nenhuma)
