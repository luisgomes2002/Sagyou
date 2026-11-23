# Plano de implementação: Memória só do próprio projeto e edição por seção

Status: approved by Luis on 2026-11-23
Spec: docs/specs/2026-11-23-memoria-escopo-e-secao.md
Branch: feature/memoria-escopo-e-secao

**Objetivo:** uma sessão de projeto lê só as memórias do próprio projeto (e as globais), e ler outro projeto exige um cartão de aprovação; `update_memory` passa a editar uma seção.

**Arquitetura:** a regra de seção (achar o título, trocar o conteúdo) é uma função pura no core. A trava de leitura é um módulo puro novo no desktop (`mcp-project-read.ts`: alvo da chamada, concessões por sessão, textos), usado pelo broker, que chama uma dep `approveProjectRead` assíncrona; o `index.ts` liga essa dep ao mesmo cartão dos cartões de escrita arriscada (`requestMcpWriteApproval`, `risky: true`).

## Restrições Globais

- **Testes só no CI** (regra do Luis): nada de `npm test`/`typecheck`/`lint` local; os passos "rode" valem como push + `gh pr checks`. Branch sem PR não roda CI, então o build abre um **PR em rascunho** depois da Task 2 (o Luis já aprovou esse padrão no PR #65; confirmar de novo no portão). Empurrar no fim de cada fase (A: T1–T2, B: T3–T4, C: T5, D: T6).
- Prettier do repositório: `npx --yes prettier@3.10.1 --check` nos arquivos tocados; em `index.ts`, `store.ts`, `sagyou-mcp.ts` formatar **só os trechos novos** (há dívida antiga).
- **Textos exatos** (pt-BR):
  - Cartão: `Ler memórias do projeto "<nome>"?` (card `name` = `mcp:read_other_project_memory`, `risky: true`, 5 min).
  - Recusa/expirado/bloqueado: `Leitura de outro projeto não aprovada. Não insista: só leia outro projeto se o usuário pedir.`
  - Projeto inexistente: `Projeto não encontrado.`
  - Seção sem `expectedUpdatedAt`: `Para editar uma seção, passe expectedUpdatedAt (o updatedAt lido com read_memory).`
  - Seção ausente: `Seção "<título>" não encontrada nesta memória.`
  - Título repetido: `Há mais de uma seção "<título>" nesta memória; use update_memory sem section.`
  - Dica nas descrições: `Lê, por padrão, o projeto da sessão e as globais; outro projeto exige a aprovação do usuário.`
  - Rótulo do cartão no Fleet: `Leitura solicitada pelo MCP desta sessão.` (hoje diz "Escrita…" para todo `mcp:`).
- A trava vale só quando `session.projectId !== null` **e** o projeto alvo é diferente do da sessão e não é `null`. Sessão geral e token externo (`runId: 'external'`, `projectId: null`) nunca pedem cartão.
- Ferramentas cobertas: `search_memory`, `list_recent_memories`, `check_memories`, `read_memory`, `list_active_sessions`. Não cobertas: `read_tasks`/`read_project`/`read_notes`/`read_goals`, `ler_tasks`/`ler_projeto`, `list_projects`.
- Aprovado vale por **token** (sessão), em memória do broker; apagado quando o token sai (`revoke`, expiração, run encerrada). Recusa **nunca** é lembrada. Pedidos simultâneos ao mesmo (token, projeto) compartilham um cartão.
- **Falha fechada:** dep ausente, erro ou rejeição da dep = recusado (o texto de recusa), nunca leitura.
- Seção: título Markdown `#`–`######` (a sequência final de `#` só é removida quando precedida de espaço, então `## Notas sobre C#` fica `Notas sobre C#`); fim = próximo título de nível igual ou menor fora de bloco cercado (``` ou ~~~); comparação por `titleKey` (sem acento/maiúsculas/espaços repetidos); limite do corpo resultante 2 000 (o `editMemory` existente recusa com `body inválido.`).
- **(decisão do construtor) Linhas em branco:** as linhas em branco **finais** da seção original são preservadas como estão; só as linhas de conteúdo (até a última não vazia) são trocadas. `\r\n` é normalizado para `\n` **no corpo inteiro** quando o patch dá certo (é a única alteração fora da seção, e só em corpo com CRLF).
- **(decisão do construtor) Parâmetro `section`:** os `#` iniciais e espaços são removidos antes de comparar (`'## Decisão'` vale `'Decisão'`); as mensagens de erro ecoam o texto já limpo.
- **(decisão do construtor) Corpo com títulos:** o `body` da seção não pode conter linha de título (fora de bloco cercado) de nível igual ou menor que o da seção (inclui reenviar o próprio título): recusa com `O corpo da seção não pode conter títulos de nível igual ou menor que o da seção.` Subseções mais profundas são permitidas.
- **(decisão do construtor) Esvaziar seção:** a ferramenta continua recusando `body` vazio (`body inválido.`); a função pura aceita `''`, mas não é alcançável pelo MCP. Intencional.
- **(decisão do construtor) Memória órfã** (projeto dono apagado, ainda ativa): com a trava, uma sessão de projeto a vê como `Memória indisponível nesta sessão MCP.` (sem cartão e sem revelar que existe); sessão geral e acesso externo continuam lendo. Ela decai sozinha, como já está documentado. Vale só para `read_memory`; nas ferramentas com `projectId` do agente, projeto inexistente responde `Projeto não encontrado.`
- **(decisão do construtor) CI e vermelho observável:** o PR em rascunho é aberto **antes da Task 1**, com os commits de spec e plano. Nas Tasks 1 e 4 (as de regra e de segurança) o commit só dos testes vai primeiro, e o CI vermelho é conferido antes do commit da implementação; nas Tasks 2, 3 e 5 o passo "FALHA" é conferido por leitura (o teste não passa porque a função/rótulo não existe) e o primeiro CI da fase já roda com teste e implementação.
- Sem mudança de dados persistidos; `packages/core` sem Node (`no-node.test.ts`); `log.*` no main, nunca o nome do projeto, conteúdo ou token.
- Versão: **não sobe** enquanto a 1.14.0 não for publicada (último release v1.13.0; conferir `git tag` no PR). Se a 1.14.0 já tiver saído, subir para 1.15.0 (MINOR) em `apps/desktop/package.json` e `package-lock.json`.

## Foco de Review

1. **Fail-open na trava.** Dep ausente, erro, recusa, expiração, app bloqueado ou run encerrada não podem devolver dado de outro projeto. Esperado: a recusa exata, nenhum item. Testado na Task 4 (dep ausente, que rejeita, recusa, concessão tardia depois de `drop`) e verificado no app na Task 6 (bloqueado, expirado, run encerrada: só existem no `index.ts`).
2. **Vazar antes de aprovar.** `read_memory` de id de outro projeto não pode revelar título, tipo, tags ou existência antes do cartão; o cartão só tem o nome do projeto. Esperado: só a recusa. Testado na Task 4.
3. **Concessão que atravessa sessões.** Aprovação de uma sessão não vale para outra nem sobrevive ao `revoke`. Esperado: outro token pede cartão de novo. Testado na Task 4.
4. **Seção corrompendo a memória.** Título dentro de bloco de código, título repetido, última seção sem quebra final, `\r\n`, subseções, corpo maior que 2 000. Esperado: só o conteúdo da seção muda; o resto igual (exceto `\r\n` → `\n`). Testado na Task 1.
5. **Edição sobre versão velha.** `expectedUpdatedAt` obrigatório com `section` e checado também no `apply` (o `prepareMemoryWrite` roda duas vezes). Esperado: recusa sem escrever. Testado na Task 2.
6. **Quebrar quem já funciona.** Agente que passa o `projectId` do próprio projeto, sessão geral e token externo não podem receber cartão; `update_memory` sem `section` continua igual (dados persistidos existentes: nenhuma memória é reescrita pela mudança). Testado nas Tasks 2 e 4.

### Task 1: Edição por seção no core (função pura)
**Arquivos:** Modificar `packages/core/src/memory.ts`; Teste: criar `packages/core/src/__tests__/memory-sections.test.ts`
**Interfaces:**
- Produz (exportadas de `@sagyou/core/memory`):
  - `export type SectionPatchError = 'not-found' | 'ambiguous' | 'heading-in-content'`
  - `export function replaceMemorySection(body: string, section: string, content: string): { body: string } | { error: SectionPatchError }`
- [ ] Passo 1: escreva o teste que falha (`memory-sections.test.ts`), com o corpo `"Intro\n\n## Decisão\nUsar A.\n\n### Detalhe\nporque X\n\n## Outras\nresto"`:
  - `replaceMemorySection(body, 'Decisão', 'Usar B.')` → `"Intro\n\n## Decisão\nUsar B.\n\n## Outras\nresto"` (a subseção `### Detalhe` faz parte da seção e some junto; a linha em branco final da seção é preservada; o resto igual).
  - Busca sem acento e sem maiúsculas: `'decisao'` e `'  DECISÃO '` acham a mesma; `'## Decisão'` (com `#`) também.
  - Última seção sem quebra final: `replaceMemorySection('# T\na', 'T', 'b')` → `{ body: '# T\nb' }`.
  - Título com `#` no fim: `'## Notas sobre C#\nx'` achado por `'notas sobre c#'`.
  - Conteúdo com título: `content` `'## Decisão\nx'` (ou `'# Z'`) na seção `## Decisão` → `{ error: 'heading-in-content' }`; `'### Sub\nx'` é aceito; um `## ` dentro de bloco cercado no conteúdo é aceito.
  - Título dentro de bloco cercado não conta: `"## A\n```\n## B\n```\nx"` com seção `'B'` → `{ error: 'not-found' }`; com `'A'` e conteúdo `'y'` → `"## A\ny"`.
  - Título repetido (`"## A\n1\n## A\n2"`) → `{ error: 'ambiguous' }`; título inexistente → `{ error: 'not-found' }`.
  - `\r\n`: `"## A\r\n1\r\n## B\r\n2"` seção `'A'`, conteúdo `'x'` → `"## A\nx\n## B\n2"` (corpo inteiro normalizado); conteúdo vazio `''` deixa a seção só com o título e as linhas em branco finais originais.
  - Nível: ao editar `## A`, um `# Z` seguinte (nível menor) encerra a seção; ao editar `### D`, um `## O` seguinte também.
- [ ] Passo 2: commit **só dos testes**, push no PR rascunho e CI da fase A. Esperado: FALHA porque a função não existe.
- [ ] Passo 3: implemente `replaceMemorySection` em `memory.ts`: normaliza `\r\n`, percorre as linhas controlando bloco cercado, coleta títulos com `/^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/` e compara `titleKey` do parâmetro (já sem `#` iniciais); troca as linhas de conteúdo da seção (até a última não vazia) por `content.trim()` e mantém as linhas em branco finais originais; recusa `heading-in-content` olhando as linhas do `content` fora de bloco cercado.
- [ ] Passo 4: CI da fase A. Esperado: PASSA.
- [ ] Passo 5: commit `feat(memory): troca o conteúdo de uma seção de memória`

### Task 2: `update_memory` com `section`
**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/mcp-write-tools.ts`; Teste: `apps/desktop/src/main/__tests__/mcp-write-tools.test.ts`
**Interfaces:**
- Consome (Task 1): `replaceMemorySection`.
- Produz: parâmetro `section` (string, até 200) em `update_memory`; em `prepareMemoryOp`, depois de `editableMemory` e de `checkExpectedUpdatedAt`: ver abaixo. A descrição da ferramenta ganha `Com section, body é o novo conteúdo só daquela seção (o título é mantido); exige expectedUpdatedAt.`
- [ ] Passo 1: escreva os testes que falham (dentro do `describe('prepareMemoryWrite')`, com uma memória de corpo `"Intro\n\n## Decisão\nUsar A.\n\n## Outras\nresto"`, `updatedAt` `READ_AT`):
  - `section: 'Decisão', body: 'Usar B.', expectedUpdatedAt: READ_AT` → `ok` e `op.memory.body` = `"Intro\n\n## Decisão\nUsar B.\n\n## Outras\nresto"`; título, tags, pin e `accessCount` intactos; `updatedAt` = NOW.
  - `section` sem `expectedUpdatedAt` → `{ ok: false, error: 'Para editar uma seção, passe expectedUpdatedAt (o updatedAt lido com read_memory).' }`.
  - `expectedUpdatedAt` velho → a recusa de versão do passo 1 (texto exato), **mesmo com `section`**; a mudança entre `prepare` e `apply` (segunda chamada com `updatedAt` novo) também recusa.
  - Seção ausente → `Seção "Inexistente" não encontrada nesta memória.`; título repetido → `Há mais de uma seção "A" nesta memória; use update_memory sem section.`
  - `section: 5` ou `''` (ou só `'##'`) → `section inválido.`; `section: '## Decisão'` vale `Decisão`; `body` com título de nível igual ou menor → `O corpo da seção não pode conter títulos de nível igual ou menor que o da seção.`; `section` sem `body` → `body inválido.`; corpo resultante > 2 000 → `body inválido.`; segredo no `body` sai `[REDIGIDO]` e `redacted: true`.
  - `section` + `tags`/`title` mudam também; handoff, arquivada e inexistente mantêm as recusas de hoje (vêm antes); sem `section` o comportamento de hoje não muda (um teste de regressão com corpo inteiro).
- [ ] Passo 2: leitura: sem a implementação `section` é ignorado e o corpo inteiro seria trocado, então os testes falham (conferido pelo CI da fase A, que já roda com a implementação).
- [ ] Passo 3: implemente em `mcp-write-tools.ts`: ao ver `args.section !== undefined`, valida o tipo, exige `expectedUpdatedAt`, chama `replaceMemorySection(existing.body, section, args.body)` (corpo vindo já validado como texto não vazio) e passa o resultado a `editMemory` no lugar de `args.body`; resumo `Editar seção "<section>" da memória "<título>"`.
- [ ] Passo 4: CI da fase A. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): update_memory edita uma seção da memória`

### Task 3: Módulo puro da trava de leitura entre projetos
**Arquivos:** Criar `apps/desktop/src/main/modules/agent/mcp-project-read.ts`; Teste: criar `apps/desktop/src/main/__tests__/mcp-project-read.test.ts`
**Interfaces:**
- Produz:
  - `export const PROJECT_READ_REFUSED = 'Leitura de outro projeto não aprovada. Não insista: só leia outro projeto se o usuário pedir.'`, `PROJECT_NOT_FOUND = 'Projeto não encontrado.'`, `PROJECT_READ_HINT = 'Lê, por padrão, o projeto da sessão e as globais; outro projeto exige a aprovação do usuário.'`, `PROJECT_READ_CARD = 'read_other_project_memory'`, `projectReadResumo(name: string): string` (`Ler memórias do projeto "<nome>"?`).
  - `export type ProjectReadDecision = 'approved' | 'refused' | 'not-found'`
  - `export function crossProjectTarget(sessionProjectId: string | null, requested: string | null | undefined): string | null` — o id do **outro** projeto que exige cartão, ou `null`.
  - `export class ProjectReadGrants { constructor(ask: (token: string, projectId: string) => Promise<ProjectReadDecision>); check(token: string, projectId: string): Promise<{ ok: true } | { ok: false; error: string; reason: 'refused' | 'not-found' }>; drop(token: string): void }` — guarda aprovados por token, compartilha o cartão pendente por (token, projeto), não lembra recusa, e falha fechado (a promessa da `ask` rejeitada = recusado). Cada token tem uma **geração** que `drop` incrementa: uma `ask` que resolve depois de `drop(token)` não grava a concessão e devolve recusado.
- [ ] Passo 1: escreva os testes que falham: `crossProjectTarget('A', 'B')` = `'B'`; `('A','A')`, `('A', undefined)`, `('A', null)`, `(null, 'B')` = `null`; `check` aprovado chama `ask` uma vez e a segunda chamada do mesmo token/projeto não chama; token diferente chama de novo; dois `check` simultâneos compartilham uma só chamada de `ask`; `refused` devolve `{ ok:false, error: PROJECT_READ_REFUSED }` e a chamada seguinte pergunta de novo; `not-found` devolve `PROJECT_NOT_FOUND` e não lembra; `ask` que rejeita ou lança → `PROJECT_READ_REFUSED`; `drop(token)` apaga as concessões e as pendências daquele token; uma `ask` que só resolve **depois** de `drop` (aprovada) devolve `PROJECT_READ_REFUSED` e não deixa concessão (a chamada seguinte pergunta de novo); `projectReadResumo('Murasaki')` = `Ler memórias do projeto "Murasaki"?`; um nome com aspas ou quebra de linha é limpo para uma linha (`replace(/\s+/g,' ')`, sem `"` duplicadas) e cortado em 80 caracteres.
- [ ] Passo 2: CI da fase B. Esperado: FALHA porque o módulo não existe.
- [ ] Passo 3: implemente o módulo (Map de concessões por token → Set de projetos; Map de pendências por `${token}\u0000${projectId}`).
- [ ] Passo 4: CI da fase B. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): regras puras da leitura de memória entre projetos`

### Task 4: Trava no broker
**Arquivos:** Modificar `apps/desktop/src/main/modules/agent/sagyou-mcp.ts`; Teste: `apps/desktop/src/main/__tests__/sagyou-mcp.test.ts`, `mcp-worktree-security.test.ts`, `mcp-external-broker.test.ts`. Todo teste desses três arquivos que hoje lê outro projeto (procurar `project-2` e `projectId:` nos três; conhecidos: a leitura entre alpha/beta, a busca com `projectId` de outro projeto, a leitura por id de outro projeto e o `list_active_sessions` com `project-2`) passa a montar o broker com `approveProjectRead: async () => 'approved'`. É mudança mecânica; os casos novos abaixo são os de segurança.
**Interfaces:**
- Consome (Task 3): `ProjectReadGrants`, `crossProjectTarget`, os textos, `PROJECT_READ_HINT`.
- Produz: dep `McpBrokerDeps.approveProjectRead?: (session: McpSession, projectId: string) => Promise<ProjectReadDecision>` (ausente = `refused`); o broker cria um `ProjectReadGrants` com `ask = (token, projectId) => { const session = sessions.get(token); return session ? (deps.approveProjectRead?.(session, projectId) ?? 'refused') : 'refused' }` (sessão já revogada = recusado) e chama `drop(token)` onde apaga a sessão (o `sessions.delete(token)` da validação em `tools/call` e o `revoke`). O ramo assíncrono do `tools/call` termina sempre com `.catch(() => failure(call, request.id, PROJECT_READ_REFUSED))`, para um erro fora do `try/catch` síncrono nunca deixar a chamada sem resposta.
  - Em `tools/call`, para `search_memory`, `list_recent_memories`, `check_memories`, `list_active_sessions`: alvo = `crossProjectTarget(session.projectId, args.projectId já limpo por readProjectId)`; para `read_memory`: alvo = `crossProjectTarget(session.projectId, memória.projectId)` (memória inexistente/arquivada mantém `Memória indisponível nesta sessão MCP.` sem cartão; se o resultado for `not-found` (projeto dono apagado, memória órfã), responde também `Memória indisponível nesta sessão MCP.`). Com alvo: `grants.check(session.token, alvo)`; `ok` → serve a ferramenta como hoje; senão `failure(error)`. O corpo de cada uma das 5 ferramentas vira a função interna `serveMemoryRead(name, call, requestId, args, session)` (movida sem mudar comportamento) para poder ser chamada direto ou depois da aprovação.
  - Descrições de `search_memory`, `list_recent_memories`, `check_memories`, `read_memory` e `list_active_sessions` terminam com `PROJECT_READ_HINT`.
- [ ] Passo 1: escreva os testes que falham (broker com dep `approveProjectRead` falsa que registra as chamadas):
  - Sessão `project-1`: `search_memory {term}` e com `projectId: 'project-1'` **não** chamam a dep; com `projectId: 'project-2'` chama a dep **uma vez** e, aprovado, devolve os itens; chamada seguinte do mesmo projeto não chama a dep.
  - Recusado: resposta de erro `Leitura de outro projeto não aprovada. Não insista: só leia outro projeto se o usuário pedir.`, **sem nenhum item** e sem `touchMemory`; a chamada seguinte chama a dep de novo.
  - `not-found` → `Projeto não encontrado.`
  - `read_memory` de uma memória órfã (a dep devolve `not-found`): `Memória indisponível nesta sessão MCP.`, nunca `Projeto não encontrado.`
  - `read_memory` de uma memória do `project-2`: recusado antes de aprovar, sem título/tipo/tags no texto da resposta (`JSON.stringify(reply)` não contém o título da memória); aprovado, devolve como hoje; memória global e do próprio projeto não chamam a dep; memória inexistente/arquivada dá `Memória indisponível nesta sessão MCP.` sem chamar a dep.
  - `list_recent_memories`, `check_memories` e `list_active_sessions` com `projectId` de outro projeto: mesma trava; sem `projectId`, não chamam a dep.
  - Dep **ausente** e dep que rejeita: recusado (falha fechada).
  - Sessão com `projectId: null` e o token externo (`runId: 'external'`): leem outro projeto sem chamar a dep.
  - Outro token (nova `grant`) do mesmo projeto pergunta de novo; depois de `broker.revoke(token)` e novo `grant` do mesmo token, pergunta de novo.
  - As descrições das 5 ferramentas contêm `outro projeto exige a aprovação do usuário`.
- [ ] Passo 2: commit **só dos testes** (e do ajuste mecânico dos testes existentes), push e CI da fase B. Esperado: FALHA porque nada é perguntado e o dado de outro projeto é devolvido.
- [ ] Passo 3: implemente no broker como descrito; extrair `serveMemoryRead` primeiro, sem mudar comportamento (os testes existentes continuam verdes), depois ligar a trava.
- [ ] Passo 4: CI da fase B. Esperado: PASSA.
- [ ] Passo 5: commit `feat(mcp): leitura de memória de outro projeto pede aprovação`

### Task 5: Cartão no `index.ts` e rótulo no Fleet
**Arquivos:** Modificar `apps/desktop/src/main/index.ts`, `apps/desktop/src/renderer/src/components/ai/fleet/AttentionPanel.tsx`; Teste: `apps/desktop/src/renderer/src/__tests__/components/AttentionPanel.test.tsx`, `apps/desktop/src/main/__tests__/mcp-write-tools.test.ts` (é onde mora `autoApprovesPending`)
**Interfaces:**
- Consome (Tasks 3–4): `approveProjectRead` do broker, `projectReadResumo`, `PROJECT_READ_CARD`.
- Produz: no `startSagyouMcpBroker({...})` do `index.ts`: `approveProjectRead: async (session, projectId) => { const project = loadData().projects.find((p) => p.id === projectId); if (!project) return 'not-found'; const approved = await requestMcpWriteApproval(session.runId, PROJECT_READ_CARD, { projectId }, projectReadResumo(project.name), true); log.info('mcp', 'cross_project_read', { decision: approved ? 'approved' : 'not_approved' }); return approved ? 'approved' : 'refused' }`. No `AttentionPanel`, o rótulo de um card `mcp:` vira `Leitura solicitada pelo MCP desta sessão.` quando `approval.name === 'mcp:read_other_project_memory'` e continua `Escrita solicitada pelo MCP desta sessão.` nos demais.
- [ ] Passo 1: escreva os testes que falham: no `AttentionPanel.test.tsx`, um card `{ name: 'mcp:read_other_project_memory', resumo: 'Ler memórias do projeto "B"?' }` mostra `Leitura solicitada pelo MCP desta sessão.` e **não** `Escrita solicitada…`; um `mcp:delete_task` continua com `Escrita…`; em `mcp-write-tools.test.ts` (junto dos testes de `autoApprovesPending`), `autoApprovesPending('mcp:read_other_project_memory', true)` é `false` (o modo automático nunca aprova) e `MCP_APPROVAL_REQUIRED` não contém o nome (não é uma ferramenta).
- [ ] Passo 2: CI da fase C. Esperado: FALHA só no teste do rótulo do `AttentionPanel` (é sempre "Escrita…"); a asserção de `autoApprovesPending` já passa hoje (`risky: true`) e fica como trava contra regressão.
- [ ] Passo 3: implemente as duas ligações. O `index.ts` não é importável isoladamente: a ligação é verificada no app (Task 6).
- [ ] Passo 4: CI da fase C. Esperado: PASSA.
- [ ] Passo 5: commit `feat(agent): cartão de leitura entre projetos e rótulo no Fleet`

### Task 6: Fechamento — suíte, verificação no app, docs e PR
**Arquivos:** Modificar `CLAUDE.md`, `GUIDE.md` (e `README.md` só se citar a leitura de memória); versão só se a 1.14.0 já tiver sido publicada.
- [ ] Passo 1: docs: em `CLAUDE.md` e `GUIDE.md`, descrever a trava (ferramentas cobertas, quando não vale, concessão por token, recusa não lembrada, falha fechada, cartão `risky` que o modo automático nunca aprova) e `update_memory` com `section`/`expectedUpdatedAt` obrigatório; trocar a frase "leituras podem escolher outro projeto" onde se referir a memória.
- [ ] Passo 2: suíte completa, typecheck e lint no CI (`gh pr checks`), sem local.
- [ ] Passo 3: **verificação no app** (`npm run dev`, o `index.ts` não roda no vitest): (a) sessão do projeto A pede `search_memory` com `projectId` do B: o cartão `Ler memórias do projeto "B"?` aparece no Fleet (rótulo "Leitura…") e no celular; (b) aprovar libera, e a segunda busca em B não pergunta; (c) recusar devolve a recusa e uma nova tentativa abre outro cartão; (d) o toggle automático da sessão não aprova o cartão; (e) sessão geral e acesso externo leem outro projeto sem cartão; (f) `update_memory` por seção numa memória real, e a mesma chamada com `expectedUpdatedAt` velho recusa; (g) bloquear o app com um cartão de leitura pendente: o agente recebe a recusa; deixar o cartão expirar (5 min) ou parar a sessão: recusa e nenhum dado; (h) memória de projeto apagado (órfã): `read_memory` responde `Memória indisponível nesta sessão MCP.`.
- [ ] Passo 4: PR (estágio 5): sem mudança de dados persistidos. Versão: `apps/desktop/package.json` já está em 1.14.0 (ainda sem tag); se a 1.14.0 **não** foi publicada, nada muda; se foi, subir para 1.15.0 nos dois arquivos de versão.
- [ ] Passo 5: commit `docs(memoria-escopo-e-secao): documentação da trava e da edição por seção`
