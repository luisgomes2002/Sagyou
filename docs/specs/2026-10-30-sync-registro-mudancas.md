# Sync, etapa 1: registro de versões por registro

Status: approved by Luis on 2026-10-30
Branch: feature/sync-registro-mudancas

Primeira etapa do roteiro `docs/specs/2026-10-30-sync-mobile-roteiro.md`. Não há rede,
servidor nem tela nesta etapa: ela só ensina o desktop a saber, registro a registro, o
que mudou, quando e em qual aparelho. É a base que as etapas 2 (Cloudflare) e 3 (app
Android) usam para trocar só o que mudou e resolver conflitos.

## Por quê

Hoje o renderer envia o estado inteiro a cada salvamento e o main grava a diferença
contra o último retrato da sessão (`persistDiff`), ou regrava tudo no primeiro
salvamento (`persistAll`). Nada no banco diz **qual versão** um registro tem nem
**quem** o alterou por último. Exclusões só deixam rastro para projeto, tarefa e
sprint (`tombstones`). Sem isso, dois aparelhos não conseguem dizer "eu tenho a versão
mais nova desta tarefa" nem "esta nota foi apagada lá, apague aqui".

Além disso, a granularidade atual não serve para sync: uma tabela financeira inteira,
com todas as transações, é uma entidade só. Se o celular lança um gasto e o PC lança
outro na mesma tabela, um sobrescreveria o outro.

## Objetivos

- Cada registro sincronizável tem uma versão: relógio, aparelho de origem e uma
  impressão do conteúdo.
- Toda criação, alteração e exclusão feita pelo app, pelo MCP ou por um backup
  importado atualiza essa versão, sem mudar o que o usuário vê.
- A unidade de versão é pequena o bastante para que edições em aparelhos diferentes
  raramente disputem o mesmo registro (uma transação é um registro, não a tabela
  inteira).
- Os dados existentes ganham versão na primeira abertura, sem alterar as tabelas
  atuais.

## Fora do escopo

- Rede, servidor, criptografia, pareamento (etapa 2).
- Receber e aplicar mudanças de outro aparelho, e as regras de conflito na prática
  (etapa 2). Esta etapa só garante que os dados necessários para isso existem.
- Qualquer tela ou texto novo.
- Bytes de anexos e imagens: só os metadados ganham versão.
- Apagar tombstones antigos (fica para a etapa 2, que sabe quando todos os aparelhos já
  os receberam).

## Decisões (de Luis, 2026-10-30)

- Arquitetura local-first com Cloudflare, cifra de ponta a ponta, três aparelhos
  (Windows de casa, Linux do trabalho, Android). Veja o roteiro.
- Começar pela base do sync, porque o app Android depende dela.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **As versões ficam numa tabela à parte, não em colunas novas nas tabelas atuais.**
  `persistAll` e `persistDiff` apagam e reinserem linhas; uma coluna de versão nas
  tabelas de dados seria perdida ou reescrita nesse caminho. Uma tabela própria
  (`sync_records`, chave `kind + id`) não é tocada por eles, e as tabelas existentes não
  mudam.
- **A mudança é detectada pela impressão do conteúdo, não pelo retrato da sessão.** A
  cada salvamento, o main calcula um hash de cada registro sincronizável e compara com o
  guardado em `sync_records`. Isso funciona igual no primeiro salvamento (`persistAll`,
  sem retrato anterior), no `persistDiff`, numa importação de backup e se um registro
  anterior tiver falhado: o próximo salvamento sempre se corrige sozinho.
- **Relógio híbrido (HLC)** como versão: horário em milissegundos + contador + id do
  aparelho, numa string que ordena corretamente por comparação simples. Se o relógio do
  computador voltar no tempo, o contador garante que a versão nova continua maior que a
  anterior. É o desempate que a etapa 2 usará ("a edição mais recente vence").
- **O id do aparelho fica num arquivo próprio**, `userData/sync-device.json`, fora do
  SQLite (o `persistAll` apaga a tabela `settings`, o mesmo motivo do
  `legacy-chat-state.json`) e fora de qualquer backup (um backup restaurado em outro PC
  não pode clonar a identidade). Em build de desenvolvimento o arquivo é
  `sync-device-dev.json`, como o banco `kanban-dev.db`, para que dados de teste nunca se
  passem pelo aparelho real.
- **Uma falha no registro de versões não impede o salvamento.** Ele roda num savepoint
  dentro da transação do salvamento; se falhar, só esse trecho é desfeito, o erro vai
  para o log e o salvamento dos dados segue. Como a detecção é por hash, o próximo
  salvamento registra o que faltou.
- **Os campos locais ficam fora do hash.** Mudar só um deles não gera versão nova (veja
  "O que é do aparelho" abaixo).
- **Tombstones são guardados sem prazo nesta etapa.** São linhas pequenas; a limpeza
  depende de saber o que os outros aparelhos já receberam, que só existe na etapa 2.
- **A tabela `tombstones` atual não muda** e continua sendo escrita como hoje, para
  versões antigas do app e backups.

## Comportamento

### Unidades sincronizáveis

Cada linha abaixo é um `kind`. O conteúdo do hash é o registro sem os campos marcados
como locais e sem os filhos que são `kind` próprio.

| kind | Origem | Fica fora do conteúdo |
|---|---|---|
| `project` | `projects[]` | `columns`, `links`, `codePaths`, `activeCodePathIds`, `activeCodePathId` |
| `project_column` | `projects[].columns[]` (leva `projectId`) | — |
| `project_link` | `projects[].links[]` (leva `projectId`) | — |
| `task` | `tasks[]`, com tags e metadados das imagens | — |
| `sprint` | `sprints[]` | — |
| `note` | `notes[]`, com conexões | — |
| `goal` | `goals[]` | `entries` |
| `goal_entry` | `goals[].entries[]` (leva `goalId`) | — |
| `habit` | `habits[]` | `completions` |
| `habit_completion` | `habits[].completions[]`; id = `<habitId>:<data>` | — |
| `financial_profile` | `financialProfiles[]` | — |
| `financial_table` | `lists[]`, com `profileId`, `provider`, `actualBalance*`, `legacyFinancialMetadata` | `items`, `transactions`, `goals`, `yieldSources`, `yieldEntries`, `debts` |
| `financial_debt` | `lists[].debts[]` (leva `tableId`) | — |
| `transaction` | `lists[].transactions[]`, com `details` (leva `tableId`) | — |
| `shopping_item` | `lists[].items[]` (leva `tableId`) | — |
| `financial_goal` | `lists[].goals[]` (leva `tableId`) | — |
| `yield_source` | `lists[].yieldSources[]` (leva `tableId`) | — |
| `yield_entry` | `lists[].yieldEntries[]` (leva `tableId`) | — |
| `file` | `files[]` (metadados; os bytes não) | — |
| `time_block` | `timeBlocks[]` | — |
| `routine` | `routines[]` | — |
| `memory` | tabela `memory` | `access_count`, `last_accessed_at`, `source_conversation_id` |

### O que é do aparelho (nunca ganha versão)

Caminhos de código e a seleção deles, timers rodando (`activeTimers`/`activeTimer`),
`uiPreferences`, `featurePreferences`, `activeFinancialProfileId`, `entity_events`,
`file_search_content`, o índice FTS, `ai-config.json`, runs do Fleet, skills, logs e a
senha do app. Mudar só esses itens não altera nenhuma linha de `sync_records`.

### Regras

- **Criação:** um registro novo recebe uma linha em `sync_records` com o HLC atual, o
  aparelho local, o hash e `deleted = 0`.
- **Alteração:** se o hash mudou, a linha recebe um HLC novo, o aparelho local e o hash
  novo. Se o hash é o mesmo (por exemplo, o renderer reenviou o mesmo estado), nada
  muda.
- **Exclusão:** um registro que tem versão viva e sumiu do estado vira tombstone: HLC
  novo, aparelho local, `deleted = 1`. Excluir um pai (tabela financeira, projeto,
  meta, hábito) gera tombstone também para cada filho que sumiu junto.
- **Volta de um registro excluído** (por exemplo, por backup importado): a linha volta a
  `deleted = 0` com HLC novo.
- **Memórias:** `upsertMemory`, `archiveMemories`, `deleteMemory` e `replaceMemories`
  atualizam `kind = memory` pela mesma regra. `touchMemories` e a passagem de decaimento
  que só mexe em `access_count`/`last_accessed_at` não geram versão; arquivar por
  decaimento gera, porque muda `archived_at`.
- **Backup importado:** é tratado como uma edição deste aparelho. Os registros que
  mudaram ganham versão nova e os que sumiram viram tombstone. A etapa 2 decide se isso
  propaga para os outros aparelhos.
- **Ordem das versões:** cada HLC emitido é maior que todos os já existentes em
  `sync_records`, mesmo que o relógio do sistema tenha voltado.
- **Primeira abertura depois da atualização:** se `sync_records` está vazia e há dados,
  todo registro sincronizável e toda memória recebem uma versão inicial com o aparelho
  local, numa única transação. Um registro sem dados não gera nada. Se a carga inicial
  for interrompida, a próxima abertura completa o que faltou, porque a detecção é por
  hash.
- **Falha:** se o registro de versões falhar num salvamento, os dados são salvos assim
  mesmo, o log recebe `sync` / `capture_failed` (só ids e contagens) e o próximo
  salvamento registra o que faltou.

### O que não muda

O que o usuário vê, os tempos de salvamento perceptíveis, o backup, a exportação Excel,
o MCP e o Fleet. Nenhum texto novo.

## Dados

Mudança **aditiva**: nenhuma tabela, coluna ou formato existente é alterado, e versões
antigas do app continuam abrindo o banco (elas ignoram a tabela nova). Não é uma
breaking schema change.

- **Tabela nova `sync_records`** em `kanban.db`:
  `kind TEXT`, `id TEXT`, `hlc TEXT`, `device_id TEXT`, `hash TEXT`, `deleted INTEGER`,
  `seq INTEGER`, chave primária `(kind, id)`, índice em `seq`. `seq` é um contador
  local que cresce a cada mudança de versão; a etapa 2 usa-o para saber o que ainda não
  foi enviado.
- **Arquivo novo `userData/sync-device.json`** (`sync-device-dev.json` em dev):
  `{ deviceId, createdAt }`, com `deviceId` aleatório de 128 bits. Fora de todo backup.
  Ilegível ou ausente: um id novo é gerado e o log registra `sync` / `device_id_reset`;
  as versões antigas continuam válidas com o id antigo como origem.
- **Backup:** `sync_records` e `sync-device.json` **não** entram no backup. Um backup
  restaurado é versionado como edição local (veja Regras).
- **`persistAll`/`persistDiff`:** não apagam nem reescrevem `sync_records`.
- **Migração:** criação idempotente da tabela (`CREATE TABLE IF NOT EXISTS`) e carga
  inicial descrita em Regras. A carga inicial só insere linhas em `sync_records`;
  nenhum dado existente é lido para escrita, alterado ou apagado.

## Telas

Nenhuma.

## Testes

- Funções puras em `src/main/modules/sync/` (sem Electron nem SQL): extrair os registros
  sincronizáveis de um `SaveData`, calcular o hash sem os campos locais, comparar com as
  versões guardadas e produzir criações, alterações e tombstones, gerar HLC monotônico.
- Casos que precisam de teste: adicionar uma transação gera versão só para ela, não
  para a tabela; mudar caminho de código, timer, tema ou perfil ativo não gera versão;
  excluir uma tabela financeira gera tombstone para ela e para cada filho; marcar um
  hábito num dia gera só aquele `habit_completion`; reenviar o mesmo estado não gera
  nada; relógio voltando no tempo continua gerando HLC maior; carga inicial interrompida
  completa na próxima; tocar uma memória não gera versão, arquivá-la gera.
- O SQL em `store.ts` não roda no vitest (`better-sqlite3` é compilado para o Electron):
  é verificado no app, abrindo uma cópia de um banco real e conferindo as contagens em
  `sync_records`.

## Documentação

`CLAUDE.md`: a tabela de `userData` ganha `sync-device.json`; a seção do `store.ts`
explica `sync_records` e que ela fica fora de `persistAll`. `GUIDE.md`: uma linha em
"Regras que quebram dados" dizendo que `sync_records` não pode ser apagada pelo
salvamento e que o id do aparelho nunca vai para backup. `README.md`: sem mudança
(nada visível).

## Perguntas em aberto
