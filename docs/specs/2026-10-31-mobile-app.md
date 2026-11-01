# Sync, etapa 3: app Android (v1) e `packages/core`

Status: approved by Luis on 2026-10-31
Branch: feature/mobile-app

Terceira etapa do roteiro `docs/specs/2026-10-30-sync-mobile-roteiro.md`. Parte da
etapa 2 (`docs/specs/2026-10-30-sync-cloudflare.md`, PR #30), que já sincroniza dois
PCs pela Cloudflare com lotes cifrados. Esta etapa põe um celular Android na mesma
sincronização, com um app próprio, e tira do desktop o código que os dois precisam
igual.

## Por quê

Fora de casa, Luis quer lançar um gasto, marcar um hábito, anotar algo ou criar uma
tarefa sem abrir o PC. Hoje isso só existe no desktop. O celular precisa dos mesmos
dados, funcionando offline, sem que nada fique legível fora dos aparelhos dele.

## Objetivos

- Um app Android (Expo / React Native) instalado por APK, que pareia com o desktop pelo
  QR da tela Sincronização e passa a sincronizar como mais um aparelho.
- No celular, v1: tarefas, hábitos, lançamentos financeiros (gasto e receita), notas e
  busca, todos offline-first.
- Regras de dados escritas uma vez só, em `packages/core`, usadas pelo desktop e pelo
  celular: tipos, normalização, dinheiro em string decimal, registros e hash de sync,
  HLC, lote e cifra.
- O desktop continua se comportando exatamente como hoje depois da reorganização.

## Fora do escopo

- O que a v2 cobre: finanças completas (dívidas, faturas, transferências entre moedas,
  conciliação, rendimentos), metas, planejamento, lista de compras, anexos e imagens,
  canvas com posição livre, memórias e Fleet.
- iPhone, site, Play Store.
- Ser o **primeiro** aparelho do sync ou recuperar pelo código de recuperação: isso
  continua no desktop. O celular só entra pareando com um aparelho já ativo.
- Atualização automática do app Android (instala-se o APK novo à mão) — coberto em `docs/specs/2026-11-01-mobile-releases.md` (aviso + download pelo navegador).
- Controle remoto do PC, desbloqueio pelo celular e aprovação de escritas (etapa 6).
- Bytes de anexos (a etapa 2 já não sincroniza).

## Decisões (de Luis)

Do roteiro (2026-10-30): Expo / React Native, só Android, instalado por APK; app mobile
em `apps/mobile`, código compartilhado em `packages/core` e o Worker em `sync-server/`,
no mesmo repositório; escopo da v1 e da v2 acima; dinheiro como string decimal com as
regras compartilhadas.

Na entrevista desta spec (2026-10-31):

- **Sprint da tarefa criada no celular:** o formulário tem o campo sprint, já preenchido
  com a sprint aberta mais recente do projeto, e Luis pode trocar.
- **Tabela do lançamento:** o celular tem o próprio perfil financeiro ativo (trocado nos
  ajustes do app, não sincroniza, como no desktop). O formulário vem com a última tabela
  usada naquele perfil e permite trocar entre as tabelas dele.
- **Bloqueio:** biometria ao abrir o app e quando ele volta do segundo plano depois de
  5 minutos.
- **APK:** gerado por GitHub Actions, assinado com uma chave guardada em secrets do
  repositório. Sem conta Expo e sem Android Studio no PC.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Ordem e PRs.** Três PRs, nesta ordem:
  1. Sync 3.1: reorganização do repositório (workspaces npm, `apps/desktop`,
     `packages/core` vazio, `sync-server/`), só estrutura, sem mudar comportamento;
  2. Sync 3.2: extrair o `packages/core`, com o desktop importando dele;
  3. Sync 3.3–3.11: o app.
  Cada um passa no CI antes do próximo.
- **`packages/core` não usa Node.** Hoje a etapa 2 usa `crypto` e `zlib` do Node. No core
  passam a ser `@noble/hashes` (SHA-256, HMAC, HKDF), `@noble/ciphers` (já usado) e
  `fflate` (gzip), todos JS puro. Os bytes produzidos são idênticos (gzip é o formato, não
  a biblioteca); um teste do core decifra um lote gerado pela implementação atual do
  desktop, para provar compatibilidade. Aleatoriedade vem de `globalThis.crypto.getRandomValues`
  (nativo no Node/Electron; no celular pelo polyfill `react-native-get-random-values`,
  que usa o gerador seguro do Android). *(Ajustado no plano, 2026-10-31.)*
- **O que vai para o core:** tipos de domínio (`types/index.ts`), `store/normalization.ts`,
  helpers de dinheiro (`D()`, `parseDecimalInput`, `formatAmountInput`, `moneyText`),
  `hlc.ts`, `sync-records.ts` (kinds, extração, hash canônico), `sync-plan.ts`,
  `sync-merge.ts`, `sync-batch.ts`, `sync-crypto.ts`, `sync-apply.ts` e o próprio motor
  (`createSyncEngine`, que já recebe store, config, fetch, timers e log por injeção).
  Ficam no desktop: SQLite (`store.ts`), `safeStorage`, o id do aparelho, arquivos, IPC e
  a limpeza de dados ao revogar. *(Ajustado no plano, 2026-10-31.)*
- **O celular guarda tudo que sincroniza, não só a v1.** Recebe e grava todos os kinds
  (metas, dívidas, planejamento, memórias…) no próprio SQLite, mesmo sem tela. Assim a v2
  não precisa ressincronizar nada, e editar uma tarefa no celular nunca apaga um campo
  que o celular não mostra: a edição parte do payload completo gravado.
- **Lá, o que é do aparelho também não sincroniza:** perfil financeiro ativo, última
  tabela usada, preferências do app, chave e token do sync.
- **Guarda da chave:** chave de sync e token do aparelho em `expo-secure-store`
  (Android Keystore). Nunca em AsyncStorage, SQLite ou log.
- **Senha como alternativa à biometria:** é a trava de tela do próprio Android (PIN,
  padrão ou senha), oferecida pelo `expo-local-authentication`. O app não cria uma senha
  própria. Sem nenhuma trava configurada no Android, o app não abre os dados e diz:
  "Configure um bloqueio de tela no Android para usar o Sagyou."
- **Banco:** `expo-sqlite` com uma tabela `records(kind, id, payload)` que guarda cada
  registro sincronizado exatamente como o payload do sync (sem uma tabela por tipo), mais
  `sync_records`, `sync_state`, `sync_conflicts` e `sync_pending`, com a mesma semântica
  da etapa 2. Carregar e salvar sem editar nunca gera versão nova. *(Ajustado no plano,
  2026-10-31.)*
  Busca com FTS5 do próprio SQLite, derivado e descartável como no desktop.
- **Estado:** Zustand, reaproveitando dos slices do desktop só a lógica pura que já vive
  (ou passa a viver) no core; as ações do celular gravam direto no SQLite por registro,
  sem o "salvar tudo" do desktop.
- **Ritmo do sync no celular:** igual à etapa 2 com o app aberto (envio 5 s após salvar,
  recebimento ao abrir, a cada 60 s e quando a rede volta). Em segundo plano o app não
  sincroniza na v1.
- **Navegação:** abas inferiores Tarefas, Hábitos, Finanças, Notas, Busca; ajustes no
  canto da barra superior.
- **Notas:** são as notas do canvas do projeto. Uma nota criada no celular entra no
  canvas abaixo da nota mais baixa do projeto, com largura e cor padrão; o celular mostra
  as notas em lista e não move posições.
- **Sem sprint aberta:** o campo sprint oferece "Nova sprint…" para criar uma ali mesmo.
- **Assinatura do APK:** keystore gerado uma vez por Luis, em base64 num secret do
  GitHub; o workflow roda só por ação manual ou tag `mobile-v*` e anexa o APK como
  artefato. Perder o keystore impede instalar por cima (é preciso desinstalar).

## Comportamento

- **Primeira abertura:** tela "Parear com o Sagyou" com "Escanear QR" (câmera) e "Colar
  código" (o mesmo texto que o desktop mostra). Sem pareamento, nenhuma outra tela
  existe.
- **Pareamento:** lê URL, chave e convite; registra o aparelho (o nome padrão é o
  modelo do celular, editável); baixa o retrato e depois as mudanças. Mostra "Baixando
  seus dados…" (sem contagem: o motor não expõe progresso). Convite vencido ou usado: "Este código expirou. Gere outro
  no Sagyou do PC."
- **Tarefas:** lista de projetos não arquivados; dentro do projeto, tarefas por coluna.
  Criar (título, descrição, prioridade, prazo, tags, coluna, sprint), editar, mover de
  coluna, concluir (move para a coluna "done", grava `completedAt`, como no desktop). A
  aba tem também "Próximas": tarefas com prazo, de todos os projetos, por data, com as
  vencidas no topo.
- **Hábitos:** lista com a sequência atual; tocar marca ou desmarca hoje; dá para marcar
  ou desmarcar os últimos 7 dias.
- **Finanças:** saldo atual da tabela escolhida na moeda dela; lista dos lançamentos do
  mês; "Novo gasto" e "Nova receita" com valor, data (hoje por padrão), categoria
  (incluindo as categorias do perfil) e descrição. Valor passa por `parseDecimalInput`
  com a moeda da tabela e é gravado como string decimal. Nada de total somando moedas
  diferentes. Transações de dívida, faturas e transferências aparecem na lista, mas não
  são editáveis no celular.
- **Notas:** lista por projeto; ler, criar e editar o texto.
- **Busca:** um campo que encontra tarefas, notas, hábitos, transações e projetos, com
  as transações filtradas pelo perfil ativo do celular. Tocar no resultado abre o item.
- **Conflitos:** seguem a regra da etapa 2. O celular mostra "N conflitos — resolva no
  PC" nos ajustes; resolver conflitos é do desktop na v1.
- **Revogado:** um 401 com "apagar" apaga o banco do app e a chave, e volta à tela de
  pareamento. Sem "apagar": mostra "Este aparelho foi desconectado da sincronização" e
  mantém os dados locais, só leitura.
- **Offline:** tudo funciona; o topo mostra "Sem conexão: as alterações ficam guardadas"
  quando há alterações esperando.
- **Atualização do desktop segurando o sync:** não se aplica ao celular.

## Dados

- **Desktop:** sem mudança de dados. A reorganização e a extração do core movem código,
  não schema; `kanban.db`, backups e `sync-config.json` continuam iguais. Um teste do core
  garante que o hash canônico e o lote gerados depois da extração são idênticos aos de
  antes (vetores fixos), senão todo aparelho reenviaria tudo.
- **Celular (novo):** `expo-sqlite` no armazenamento privado do app; `expo-secure-store`
  com chave e token; preferências locais (perfil ativo, última tabela, nome do aparelho).
  Nada disso tem backup no celular na v1: os dados estão na nuvem e nos PCs.
- **Protocolo:** sem mudança. O celular fala `v: 1`, as mesmas rotas do Worker.

## Telas

Seguem `UI_DESIGN.md` adaptado ao celular (mesmas cores, tipografia e textos em pt-BR;
tema claro/escuro do sistema). Pareamento, as cinco abas, formulários de tarefa,
lançamento e nota, ajustes (nome do aparelho, perfil financeiro, estado do sync,
conflitos pendentes, "Desconectar este aparelho").

## Perguntas em aberto
