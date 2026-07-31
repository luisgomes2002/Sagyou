# GUIDE.md — contexto para agentes de código

Orientação para um agente de código que vai **mexer** neste projeto.
A ideia é que você não precise descobrir tudo sozinho antes da primeira linha.

> **`CLAUDE.md` é a fonte da verdade sobre arquitetura.** Este arquivo é o mapa;
> o `CLAUDE.md` é o território, e é bem mais detalhado. Se algo aqui contradiz o
> `CLAUDE.md`, o `CLAUDE.md` vence — e o erro aqui é um bug, conserte.
>
> Este arquivo é curto de propósito: um agente o carrega no contexto e o reenvia
> a cada passo, então cada parágrafo aqui é pago muitas vezes por execução
> (~2.3k tokens/passo hoje; o `CLAUDE.md` seria ~14k). Detalhe fino vai no
> `CLAUDE.md`, que se lê sob demanda. **Ao acrescentar algo aqui, corte algo.**

---

## 🧠 CONTEXTO — como ler este arquivo

Três marcadores, e só três. Eles valem justamente porque são raros: se tudo
estiver marcado, nada está.

| Marcador | Significa |
|---|---|
| 🔴 **CRÍTICO** | Quebrar isto corrompe dados reais de usuários, ou abre um buraco de segurança. Não há "depois eu arrumo": não existe backup em servidor. |
| ⚠️ **REGRA** | Uma decisão firme do projeto. Pode contrariá-la se tiver um motivo melhor — mas diga qual, não a desfaça em silêncio. |
| 🧠 **CONTEXTO** | Por que algo é como é. Não é ordem; é o que evita você "consertar" o que não está quebrado. |

## ⚠️ REGRA — mantenha este arquivo vivo

Se a sua mudança **cria ou muda uma regra** — um invariante novo, uma armadilha
nova, uma decisão que a próxima pessoa vai querer desfazer sem saber o custo —
escreva-a aqui, no mesmo trabalho. E se ela for de arquitetura, no `CLAUDE.md`
também: os dois andam juntos.

🧠 **CONTEXTO:** isto não tem como ser automatizado, e não finja que tem. Nenhum
script detecta "surgiu uma regra nova" — é julgamento, e só o agente que fez a
mudança está em posição de exercê-lo, na hora. Um hook que só reclamasse "você
mexeu em `src/` e não no `GUIDE.md`" dispararia em quase todo commit, e a única
coisa que ensinaria é a ignorá-lo.

O teste é simples: *alguém, daqui a seis meses, vai desfazer isto achando que é
bobagem?* Se sim, é regra — documente com o custo junto.

## O que é

Sagyou — app **pessoal e offline** de kanban, hábitos, metas e finanças.
Electron, janela sem moldura, um usuário só, tudo na máquina dele.

⚠️ **Há dados de produção reais em uso.** Pessoas têm tasks, hábitos, metas e
registros financeiros de verdade salvos localmente. Não existe "é só um app de
exemplo": uma migração errada apaga o trabalho de alguém, e não há backup em
servidor para restaurar. Leia **Regras que quebram dados** antes de tocar em
qualquer coisa persistida.

## Stack

| Camada | O quê |
|---|---|
| Runtime | Electron 39 — três processos: `main`, `preload`, `renderer` |
| UI | React 19 + TypeScript + Tailwind CSS 4 |
| Build | electron-vite (Vite); electron-builder para distribuir |
| Estado | Zustand — `store/kanban.ts` compõe os slices em `store/slices/` |
| Banco | SQLite via `better-sqlite3`, no processo main |
| Dinheiro | `decimal.js` — **nunca** `number` (veja abaixo) |
| Testes | Vitest + Testing Library, jsdom por padrão |
| Drag & drop | dnd-kit |
| Grafo | d3-force |
| IA | SDK `openai` (qualquer endpoint compatível), proxiado pelo main |

Idioma: **a UI e os textos são em pt-BR**; código, nomes e comentários em
inglês. As ferramentas da IA têm nome em português de propósito (`ler_tasks`,
`criar_tasks`) — é o modelo que as chama.

## Comandos

```bash
npm run dev          # sobe o app em dev (Electron + Vite HMR)
npm run typecheck    # checa main e renderer
npm run lint         # ESLint
npm test             # roda tudo uma vez
npx vitest run src/main/__tests__/web-fetch.test.ts   # um arquivo só
npm run build:linux  # (ou :win / :mac) gera o distribuível
```

**Antes de dar qualquer coisa por pronta:** `npm run typecheck && npm test`.
O lint tem ~240 erros pré-existentes de estilo antigo — não conserte os que não
são seus, mas **não adicione novos**.

## Estrutura

```
src/
  main/          # janela, IPC, SQLite, spawn de processos
    index.ts     # cria a janela, orquestra os handlers, proxy das chamadas de IA
    handlers/    # handlers IPC por domínio (extraídos de index.ts)
      window.ts  # window:minimize/maximize/close/is-maximized
      files.ts   # files:*, excel:export, ai:images:*, task:images:*
      backup.ts  # backup:export/import, ai:import + coletores de blob
    store.ts     # persistência SQLite (kanban.db)
    memory.ts    # memória durável da IA (validação, decay, sanitização de secrets)
    code-agent.ts # agente de código nativo (loop de tool-calling)
    ai-jail.ts   # sandbox obrigatório para comandos do agente de código
    web-fetch.ts # busca páginas para a IA (a política de segurança vive aqui)
    web-render.ts # renderização headless de SPAs para a IA
    code-files.ts, code-diff.ts, skills.ts, usage.ts, chat-images.ts, backup-files.ts, …
    __tests__/   # precisam de @vitest-environment node
  preload/
    index.ts     # ponte contextBridge -> window.electronAPI
    index.d.ts   # tipagem da ponte (mantenha em sincronia com index.ts)
  renderer/src/
    App.tsx      # troca de views; dono do estado dos modais
    store/
      kanban.ts  # compõe os slices abaixo; core (loadData, _persist, _flushPersist)
      slices/    # slices Zustand por domínio (extraídos de kanban.ts)
        projects.ts  # projetos + colunas + codePaths
        tasks.ts     # tasks + sprints + timers
        financial.ts # listas + items + transações + metas financeiras
        habits.ts, goals.ts, notes.ts, planner.ts, files.ts, backup.ts
      aiRun.ts   # execução da IA (store separada, sobrevive à troca de view)
    components/
      modals/     # ~9 modais (GoalModal, TaskModal, ProjectModal, …)
      views/      # views da aplicação (Board, GraphView, GoalView, HabitView, …)
      ai/         # componentes de IA (AIView, FleetView, AiRunHost, …)
      layout/     # Sidebar, TitleBar, Toast
      financial/  # componentes financeiros
      (raiz)      # componentes compartilhados (ModalBase, CancelButton, EmptyState, …)
    ai/
      tools.ts    # infraestrutura: REGISTRY, TOOL_DEFS, runTool, describeTool*
      tools/
        helpers.ts  # funções helper + constantes (fn, resolveTask, PRIORITIES, …)
        entries.ts  # 32 definições de ferramentas (definição + run)
      agent.ts    # o loop (runAgent)
      system-prompt.md, code-prompt.md, validators.ts, permission-registry.ts, glossary.json
    utils/
      dates.ts    # todayLocalISO, todayUTCISO, formatDateBR
      money.ts    # moneyStr (coerção canônica), D (Decimal seguro)
      immutable.ts # setAdd, setDel (Set imutável para Zustand)
    types/, services/
    __tests__/   # espelha a estrutura acima
```

Uma regra acima de todas: **o renderer nunca toca disco nem rede**. Tudo passa
por um handler IPC no main, exposto pelo preload. Capacidade nova = handler em
`main/index.ts` + método em `preload/index.ts` + tipo em `preload/index.d.ts`.

## Convenções

- **Prettier manda**: aspas simples, **sem ponto e vírgula**, largura 100, sem
  trailing comma (`.prettierrc.yaml`). Não discuta com o formatador.
- TypeScript estrito; funções exportadas declaram tipo de retorno (o ESLint cobra).
- React: função nomeada + export nomeado. Arquivo que exporta componente **só**
  exporta componentes (fast refresh) — helpers vão para `utils/`.
- Comentários dizem **por quê**, não o quê. O padrão da casa é registrar a
  decisão e o que quebra se alguém a desfizer. Siga-o.
- Testes descrevem comportamento em frases ("mantém o nome quando o autosave
  passa por cima"), não a implementação.

## Regras que quebram dados

Não são preferências. Quebrá-las corrompe dados reais de gente real.

1. **Dinheiro é string decimal, não número.** `FinancialTransaction.amount`,
   `FinancialGoal.targetAmount` e `ShoppingItem.price` são strings canônicas
   (`"1500.5"`) em memória, no backup e no SQLite (colunas `TEXT`). Toda conta
   passa por `decimal.js` (`D()` em `components/financial/shared.ts`). Converta
   para `number` só para largura de barra e porcentagem. `qty` é `number` — é
   quantidade, não dinheiro.
   **No consolidado, totais nativos nunca somam moedas diferentes**: mostre BRL, USD e JPY
   separadamente. A equivalência cambial é só uma leitura em tempo real, identificada como tal,
   e nunca é gravada nem altera os lançamentos.
   As configurações de planejamento (banco/app, saldo real, orçamentos e recorrências) são
   opcionais e persistem em metadata da tabela; seus valores monetários também são strings decimais.
2. **Nunca remova nem renomeie campos** de tipos persistidos sem migração ou
   fallback. Campo novo opcional é seguro; mudar a forma de um array ou objeto
   existente, não.
3. **Avise explicitamente** ao propor algo que possa corromper dados no load
   (trocar `string` por `string[]`, mudar esquema de IDs), com:
   `⚠️ Breaking schema change — existing data may be affected.`
4. **Nem tudo está no banco.** Em `app.getPath('userData')`: `kanban.db`,
   `files/` (os blobs dos anexos — a tabela só guarda metadados),
   `ai-config.json`, `ai-conversations.json`, `ai-usage-log.json`,
   `ai-run-metrics.json` (uma linha por execução do agente — modelo, passos,
   tokens, buscas redundantes, releituras — regras puras em `main/run-metrics.ts`,
   enviadas pelo `runAgent` no `finally`, best-effort), `chat-images/`,
   `chat-files/` (texto extraído dos documentos enviados no chat, limpo com a conversa),
    `task-images/` (bytes das imagens de task — só metadata no DB, downscale JPEG
    no cliente, `migrateTaskImagesToDisk` migra dados legados), `skills/`
    (arquivos `.md` de system prompts — usados via `/skill-name` no chat),
    `agent-runs/` (execuções arquivadas do agente de código — log + diff congelados).
    Apagar um
    lado sem o outro deixa órfão.
5. **Ferramenta de IA que escreve leva `write: true`** em `ai/tools.ts`. É a
   única coisa entre o modelo e os dados do usuário: sem isso a ação roda sem
   aprovação. Ferramenta nova que muta estado **tem** que marcar.
6. **Ferramenta de leitura que devolve menos do que existe tem que dizer isso.**
   Tudo o que uma tool retorna é reenviado ao modelo a cada passo seguinte da
   execução, então elas cortam: `ler_tasks` esconde as concluídas por padrão
   (45% do quadro real), `ai:code:list`/`:read` paginam. Toda redução vem com o
   número do que ficou de fora (`total`, `truncado`, `concluidas_ocultas`,
   `outros_projetos`, `nextOffset`) — sem ele o modelo afirma com confiança que
   o quadro tem 228 tasks quando tem 413, ou que uma task não existe quando ela
   está em outro projeto. A resposta errada custa mais que os tokens salvos.
7. **Leitura de código por escopo, não por arquivo inteiro.** `ler_arquivo` aceita
   `simbolo` (extrai uma função/classe via `extractSymbol` em `code-files.ts`) ou
   `linha_inicio`/`linha_fim` (`extractLines`) — ~1-3k chars em vez de janelas de
   20k paginadas. Tudo regex/best-effort de propósito (sem AST). É o 5º arg
   `scope` de `ai:code:read`, que ganha da paginação por char; a 1ª página de um
   arquivo grande traz `simbolos` (o mapa de declarações) só quando `truncated`.
   `buscar_no_codigo` agrupa por arquivo (`arquivo` + `ocorrencias`), então o
   modelo leva a `linha` direto para o `ler_arquivo` mirado. O prompt
   (`system-prompt.md`) tem tabela de custo e exemplo bom-vs-ruim guiando isso.
   Leitura **cega** de arquivo grande (sem escopo/`inicio`/`max_chars`, `total >
   CODE_READ_PAGE`) devolve só ~100 linhas + `simbolos` + `dica`, não a janela de
   20k. `buscar_no_codigo` tem cache de 30s por (raízes+termo), limpo quando o
   agente de código roda. Freios de releitura (`ler_arquivo` cego 2×, busca fuzzy
   substring que avisa mas não bloqueia) e o log de custo por execução vivem em
   `agent.ts` (estado **por execução**), **não** em `tools.ts` (global entre
   conversas).
8. **Roteamento de modelo é opcional e por execução.** `AIConfig.modelComplex`,
   quando definido, faz `routeModel(cfg, texto)` mandar tarefas de código/análise
   (palavras como código, bug, refatorar, arquitetura, investigar) para o modelo
   pesado; o resto fica no `model` barato. Ausente = um modelo só, comportamento
   antigo. A escolha é feita uma vez em `runAgent` (`rcfg`) e vale para todas as
   chamadas daquela execução.

9. 🔴 **A tabela `memory` é satélite, fora do `persistAll`.** Memórias do assistente
   (decisões, tradeoffs, gotchas, handoffs) ficam em SQLite mas nunca passam pelo
   store Zustand — `access_count`/`last_accessed_at` são bumpados a cada leitura, e
   isso via `persistAll` reescreveria as 17 tabelas por bump. As ferramentas são
   `salvar_memoria` (write, gated), `buscar_memoria` (por id ou termo),
   `buscar_conversas`, `ler_conversa` (transcript completo por id) e
   `verificar_memorias`. A sanitização de segredos (`scrubSecrets`) roda em todo
   save — memória é reenviada ao modelo a cada passo, então uma chave vazada seria
   permanente. Decay arquiva (nunca hard-deleta); memória pinada nunca decai.
   ⚠️ `memory.project_id` é **TEXT puro, NUNCA FK com `ON DELETE CASCADE`** — o cascade
   era perda de dados (persistAll/persistDiff deletam-e-reinserem o projeto e apagavam
   as memórias dele, que não voltam por estarem fora do persistAll); `migrateMemoryDropProjectFk`
   remove o FK. Projeto apagado deixa memórias órfãs (decaem sozinhas), não as destrói.
   Handoff automático (`writeHandoff`) grava um breadcrumb por projeto ao fim de
   cada run, sem chamada LLM. ⚠️ O corpo é cortado em 600 chars **na gravação**, então
   `buscar_memoria` não expande um handoff `…`; quando cortado, ele guarda `id=<convId>` e
   o modelo abre a conversa inteira com `ler_conversa` (senão gasta buscas às cegas e refaz
   do zero). Compartilhada entre chat e code-agent.

10. **Orçamento é por chamada do modelo, não por tool round.** `maxSteps` limita toda chamada bem-sucedida da run — rodadas principais, compactação e resposta final. O contexto de uma conversa reaberta entra limitado (12 mensagens/24k caracteres/1 imagem); ferramentas além de 8 numa rodada recebem resultado sintético. O limite é **por execução**: várias conversas/projetos continuam rodando em paralelo. O subagente de pesquisa exige aprovação, é no máximo 2 por run e seu resumo é cortado antes de voltar ao agente pai.

## Segurança — o que já está resolvido

`main/web-fetch.ts` busca páginas cuja URL **vem do modelo**, ou seja, não é
confiável (uma página lida pode dizer ao modelo o que buscar em seguida). Já
existe, com testes, e não deve ser afrouxado:

- só `http`/`https` (allowlist — `file:` leria o disco);
- redes privadas, loopback, link-local e metadata de nuvem bloqueadas;
- **redirects seguidos à mão**, com a mesma política reaplicada a cada salto;
- credenciais embutidas (`user:senha@host`) recusadas;
- nada do usuário vai junto: sem cookie, sem authorization, sem referer;
- o parser (`new URL()`) é o único sanitizador — **não** acrescente limpeza de
  string na frente dele, e não decodifique entidades HTML.

`main/web-render.ts` é o irmão que **executa JavaScript** (páginas SPA), via
`ai:web:fetch` com `render`. Um navegador é uma superfície SSRF muito maior:
ele carrega todo sub-recurso, e **nenhum** passa pela checagem de redirect do
`web-fetch`. Por isso **toda requisição** (documento e sub-recursos) passa pela
mesma política `checkUrl` via `session.webRequest.onBeforeRequest` — mantenha
isso. Sessão efêmera sem cookie, sandbox, sem node. A orquestração do
`BrowserWindow` **não roda no vitest** (precisa do Electron) — verifique no app.

`main/code-files.ts` confina todo acesso a arquivo dentro da raiz escolhida
(`confineToRoot`) — é a única barreira entre o assistente e o resto do disco.

## Testes

- Vitest, jsdom por padrão. Teste de processo main precisa de
  `@vitest-environment node` no topo (o SDK da OpenAI se recusa a construir sob
  globais de browser).
- `ElectronStorage` é mockado por arquivo, **antes** de importar a store.
- Os testes do main usam **coisas reais** — servidor HTTP local, repositório git
  de verdade, processo filho de verdade. Prefira isso a stub: quase todo bug
  desta área é um detalhe de como a coisa real se comporta.
- Testando o **agente de código nativo** (`main/code-agent.ts`): o loop é puro e
  injetável (`callModel`, o runner de comando e a aprovação vêm de fora), então o
  núcleo é testado contra um dir temporário + provedor stub em `code-agent.test.ts`.
  A cola de IPC (handler `ai:code-agent:run`, streaming, o ida-e-volta de
  aprovação) é testada em `handlers.test.ts` contra o servidor HTTP local.
- `vitest.config.ts` fixa `TZ=America/Sao_Paulo`: bug de data local não pode se
  esconder atrás de um teste rodando em UTC.

## Coisas que parecem erro e não são

Não "simplifique" nenhuma destas sem ler o comentário que as acompanha:

- **`await` em série no `main/code-files.ts`** — de propósito. A versão síncrona
  travava o event loop do main (que também serve o IPC) por ~70ms.
- **A montagem manual de `tool_calls` no `ai:chat:stream`** — o SDK faz isso e
  quebra com provedores compatíveis que não mandam `role` em todo delta.
- **`maxRetries: 0` no cliente OpenAI** — o retry é do `callModelResilient`. Com
  os dois, uma resposta virou 12 requisições HTTP.
- **A store da execução da IA é separada (`store/aiRun.ts`)** — a execução
  sobrevive à `AIView` ser desmontada. Não a mova para dentro do componente.
- **O layout do grafo é uma simulação viva** (`GraphView.tsx` + `utils/graph-layout.ts`):
  o d3-force muta nós, então preserve `positionsRef` ao recriar o grafo e nunca chame
  `sim.tick()` no evento `tick`. Arrastar fixa só durante o gesto; ao soltar, pare e guarde a posição da sessão.
- **`ai/tools.ts` está fatiado** — as helpers e constantes (`fn`, `resolveTask`,
  `PRIORITIES`, …) vivem em `ai/tools/helpers.ts` e as 31 definições do REGISTRY
  em `ai/tools/entries.ts`. `tools.ts` só tem a infraestrutura (REGISTRY,
  TOOL_DEFS, runTool, describeTool*). Adicionar uma ferramenta = adicionar em
  `entries.ts` e pronto.
- **Multi-agente: a store é desingletonizada** — N chat-agents rodam em paralelo
  (até no mesmo projeto). Os campos por-run são coleções por `convId`
  (`running: Set`, `streaming`/`streamingTools: Record`, `autoApprove`/
  `abortRequested: Set`, `pendingApprovals: []` = fila de cards). `send()` captura
  seu `convId` e escreve via `writeConv`/`addUsageConv` (nunca um "run atual"
  global); o `convId` é passado ao loop e às tools (`runTool(name,args,convId)` →
  `currentRunConvId()`). `taskLeases` + `acquireLease` impedem dois agentes de
  pegar a mesma task (as tools de escrita chamam `leaseBlock`). O painel
  `FleetView.tsx` (aba "Agentes") lista as runs vivas a partir de `running`/
  `runProjects` e mostra o gasto de tokens por agente (`runUsage`, zerado ao fim
  da run). Detalhes e fases em `MULTI_AGENT_PLAN.md`.
- **Múltiplos cronômetros** (`activeTimers: ActiveTimer[]`, 1 por task) — vários
  timers correm ao mesmo tempo. `startTimer(taskId)` adiciona sem parar os outros;
  `stopTimer(taskId)` credita só aquele. Espelho legado `activeTimer =
  activeTimers[0]` no `settings` do DB (não viaja no backup); `normalizeTimers`
  migra o objeto único antigo e faz o commit de tempo em loop no load. ⚠️ Mudança
  de schema — mantenha a coleção **e** o espelho.
- **O diff do agente captura a base *antes* de rodar** (`captureBase`) — depois
  não dá para separar o que o agente fez do que o usuário já tinha em andamento.
- **Runs antigas são snapshots congelados** (`agent-runs.ts`): o log e o diff são
  gravados uma vez, quando o agente sai, em `userData/agent-runs/` (payload em
  arquivo, só ids no índice — `ai-conversations.json` é reescrito inteiro a cada
  autosave). ⚠️ **Nunca recalcule o diff de uma run arquivada**: mediria a árvore
  de hoje e apresentaria as edições posteriores do usuário como trabalho do
  agente. Por isso `CodeDiff` recebe `onRefresh` opcional — uma run passada não
  tem o que recarregar.
- ⚠️ **O agente de código é NATIVO (`main/code-agent.ts`).** É um loop de
  tool-calling que roda em main com o provedor do app. As únicas barreiras entre
  o modelo e o disco são (1) `confineToRoot` (todo caminho preso à pasta do
  projeto) e (2) **aprovação por ação** antes de qualquer escrita ou comando. As
  duas são carga, não enfeite.
- **5 ferramentas**: `listar_arquivos`, `ler_arquivo`, `buscar_no_codigo` (leitura,
  rodam direto), `escrever_arquivo`, `executar_comando` (`needsApproval` → passam por
  card). A aprovação é um **ida-e-volta de IPC**: o loop manda `ai:code-agent:approve-request`
  e para numa promise em `pendingApprovals`; o renderer mostra o card e responde por
  `ai:code-agent:approve-response`. `stopCodeAgent()` aborta o loop **e** nega toda
  aprovação parada — não há mais processo filho pra matar. `executar_comando` usa
  `exec` async (não `execSync`, que travaria o event loop do main), com timeout e
  saída limitada.
- 🛡️ **Sandbox obrigatório (`main/ai-jail.ts`)**: a aprovação cobre a *intenção*, o
  ai-jail cobre o *alcance* — confina os comandos à pasta do projeto (bubblewrap no
  Linux, sandbox-exec no macOS). `sandboxEnabled` ausente = **ligado**; só `false`
  explícito roda sem confinar. O handler `ai:code-agent:run` **recusa iniciar** quando
  o sandbox é exigido mas o ai-jail não está disponível (`getJailStatus`); o usuário
  instala (onboarding) ou desmarca o Sandbox. Ativo, o runner embrulha cada comando com
  `wrapCommand` → `ai-jail --rw-map <dir> -- /bin/sh -c '<cmd>'` (⚠️ **não existe
  `--workdir`** — o confinamento é por mounts). ⚠️ **Windows roda o sandbox *dentro do
  WSL2*** (não há build nativo): a detecção procura o ai-jail dentro do WSL (`wsl -e
  bash -lc 'command -v ai-jail…'`, `viaWsl:true`) e os comandos vão por `runSandboxedWsl`
  → `wsl -e <ai-jail> --rw-map <wsl-path> -- bash -c 'cd … && <cmd>'` (**argv**, sem
  aspas atravessando cmd.exe→wsl→bash; `winToWslPath` traduz `C:\proj`→`/mnt/c/proj`) —
  ou seja, o comando roda no Linux do WSL. Onboarding em 2 passos (`wsl --install` →
  instalar ai-jail dentro do WSL, ambos oferecidos pra rodar à mão). Só binários
  `linux-x86_64` e `macos-aarch64` existem upstream; instala em `~/.local/bin` com
  **sha256 verificado**. A detecção só roda com o sandbox **ligado**. Lógica pura testada
  em `ai-jail.test.ts`.
  ⚠️ **ai-jail + bwrap no PATH não prova que o sandbox roda** (Ubuntu 23.10+ restringe os
  user namespaces que o bwrap precisa): no Linux, achados os dois, `detectAiJail` faz um
  **smoke test** (`sandboxSmokeTest`: `ai-jail --rw-map <tmp> -- sh -c 'true'`) e vira
  `available:false` se não iniciar — o gate recusa em vez de rodar sem confinar. Falha de
  namespace (`looksLikeUserNsBlock`) dá o `reason` com o fix `sudo sysctl -w
  kernel.apparmor_restrict_unprivileged_userns=0` (mostrado, nunca rodado); `bubblewrap`
  fica `true` (está instalado, só não cria o namespace). O erro do gate mostra `jail.reason`.
- **Config separada**: `AIConfig.codeAgent {baseUrl,apiKey,model}` — campo vazio cai
  pro provedor do chat (`resolveCodeAgentConfig`). O painel mostra o **modelo real**
  (banner `modelo: X @ Y`, `status.model`, header). Os
  passos aparecem no log como `[tool] …` / `[resultado] …` e em eventos
  `ai:code-agent:tool`.
- ⚠️ **O agente não commita nada** — o painel de Mudanças existe pra o *usuário*
  revisar e commitar. `captureBase` roda **antes do loop** e o diff vai da base à
  worktree, então nada se perde deixando a árvore suja.
- **O log é renderizado como terminal** (`AgentTerminal.tsx` + `utils/ansi.ts`):
  `parseAnsi` colore o SGR, **remove** cursor/OSC e **aplica** `\r`/erase-in-line por
  linha (não faz pré-passe no texto cru). Puro e testado (`utils/ansi.test.ts`).
- **O painel lidera pelo diff, não pelo log**: "Mudanças" fica visível *durante* a
  execução (poll de 2s; derivado em main de uma base anterior ao run) e o log cru vai
  pra trás de "Log completo". Diff vazio com agente rodando diz "ainda não", não "não
  alterou nada" — fatos opostos.
- **`rodar_agente_codigo` monta um briefing enxuto** — `arquivos` (caminhos
  relativos) → seção "arquivos indicados" do system prompt (`buildSystemPrompt`) com
  descoberta desativada (`codeToolsFor`), e `decisoes` (escolhas já acertadas, ex.
  "manter fallback X") → seção "DECISÕES JÁ TOMADAS" como restrições. Main confina cada
  caminho à raiz (`confineToRoot`) e descarta os inválidos; o run abre com um banner do
  modelo, dos arquivos indicados e das decisões, e fecha com `[sagyou] duração: N.Ns`.
  O objetivo é o agente editar direto, sem grep exploratório.
- **O system prompt do agente traz um briefing de memória E de conversas**: além das
  memórias do projeto (`formatMemoriesForPrompt`), o run handler roda
  `briefConversationsForTask(loadConversations(), task, {excludeId: convId})`
  (`conversation-search.ts`, puro/testado) e passa como `conversas` pro
  `buildSystemPrompt` — reaproveita decisões/armadilhas já discutidas. Busca pelas
  **palavras-chave da task** (uma frase inteira nunca é substring de mensagem antiga),
  exclui o chat que disparou o run, e é best-effort/guardado como a memória. No chat, o
  prompt manda consultar `buscar_conversas`/`buscar_memoria` antes de disparar.
- 🛡️ **`detectAgentHint` ligado ao agente nativo**: o `CommandRunner` do run passa a
  saída (stdout+stderr) de todo comando que falha por `detectAgentHint` — é o único
  ponto com a saída completa (o painel só recebe o resumo de uma linha, sem o marcador
  `bwrap:`). Casando `bwrap:` / `needs access to create user namespaces`, seta
  `codeAgentHint` **uma vez** e **empurra `ai:code-agent:hint`** pro card aparecer no
  meio do run (não só no fim). O smoke test do ai-jail pega o caso comum antes de
  começar; isso cobre o que escapa (detecção em cache, ou o comando do próprio agente
  chamando bwrap/containers com o sandbox off). Checado **antes** de
  `looksLikeSandboxBlock` (que também casa `bwrap:`), pra não rotular uma falha de
  namespace — sandbox que não *iniciou* — como tentativa de sair do projeto.
- **Arquivos fixados são citados em caminho relativo** (`relative(dir, f)`):
  `files` chega absoluto do `confineToRoot`, então o prompt dizia "caminhos
  relativos à raiz" e entregava um absoluto — além de vazar o home da máquina.
- **Handlers em `main/handlers/` recebem dependências via injeção.**
  `registerWindowHandlers` recebe `() => mainWindow` (getter, não o valor)
  porque é chamado antes de `createWindow()` — capturar `mainWindow` na
  chamada pegaria `null`. Handlers novos devem seguir o mesmo padrão: receber
  getters ou valores que não dependam de estado ainda não inicializado.
- **O autosave do `AiRunHost` é um `useEffect` único.** Dois efeitos separados
  (conversa ativa + parked) disputavam o `ai-conversations.json` com
  load-modify-save intercalados — o último sobrescrevia o primeiro.
- 🔴 **`saveConversations` escreve em `.tmp` e renomeia.** `writeFileSync` direto
  corrompia o JSON se o processo crashasse no meio da escrita, deixando o
  arquivo truncado. O rename é atômico: ou o arquivo original sobrevive, ou o
  novo está completo.
- **`loadRunIndex` faz poda lazy de runs expiradas.** Execuções de agente têm
  TTL de 24h (`agent-runs.ts`), mas a poda só rodava quando um novo agente
  terminava. Agora `loadRunIndex()` chama `pruneRuns` em toda leitura — runs
  antigas somem mesmo sem novos agentes.
- **`pruneConversations` limpa o histórico na inicialização.** Conversas inativas
  há mais de 14 dias são removidas; se sobrarem mais de 50, as mais antigas vão
  junto. As imagens (`chat-images/`) das conversas removidas também são apagadas
  do disco, desde que nenhuma conversa mantida ainda as referencie. Roda uma vez
  em `app.whenReady()`, antes de `createWindow()`.

## Antes de terminar

1. `npm run typecheck` — limpo.
2. `npm test` — tudo passando.
3. Nenhum erro novo de lint.
4. Mexeu em algo persistido? Releia **Regras que quebram dados**.
5. Mudou arquitetura? Atualize o `CLAUDE.md` — **e este arquivo**.
