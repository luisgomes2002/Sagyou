# Remover o histórico de chat e a conexão por API

Status: approved by Luis on 2026-10-24
Branch: feature/remover-historico-chat

## Por quê

O Sagyou passa a trabalhar só com agentes de código (Codex CLI, Claude Code, OpenCode)
em terminal, como rodar `claude` ou `codex` direto. O chat genérico via API e o
histórico de conversas deixam de ter uso: ninguém mais conversa com o assistente por API,
e cada CLI guarda o próprio histórico. Manter o histórico, as imagens, as chaves de API e
os logs de custo é peso morto, e uma superfície de dados antigos que o autosave pode
corromper.

Esta é a **Spec A** de duas. A **Spec B** (memória no estilo
[ai-memory](https://github.com/akitaonrails/ai-memory): páginas markdown como fonte,
SQLite só como índice, consulta por MCP) fica para depois e **não** faz parte desta.

## Objetivos

1. Remover o chat genérico e o histórico de conversas. A tela passa a ser o terminal do agente (Fleet).
2. Na primeira abertura da versão nova, tirar um snapshot de backup e apagar sozinho todas as conversas e imagens de chat.
3. Remover as chaves e perfis de API do `ai-config.json`, mantendo a configuração dos agentes.
4. Apagar o log de gastos e as métricas de execução.
5. Manter `agent-runs/`, ligando cada execução a projeto e sessão em vez de conversa.
6. Desacoplar a memória das conversas, sem perder nenhuma memória.
7. Backups antigos continuam importáveis.

## Fora do escopo

- A memória nova no estilo ai-memory (Spec B): markdown como fonte, hooks, `memory_query`, novo decay.
- Resumo de sessão virar página de memória (Spec B).
- Mudanças em tarefas, finanças, hábitos, metas, notas, arquivos ou planner.
- Mudanças no fluxo de worktree, MCP, entrega de patch ou sandbox.
- Qualquer tentativa de preservar ou exportar o histórico além do snapshot.

## Decisões (de Luis)

- A tela de Chat some. O Fleet é a única porta de entrada, e funciona como `claude`/`codex` no terminal. Cada CLI cuida do próprio histórico.
- A migração roda sozinha na primeira abertura, **sem perguntar**, depois de um snapshot automático.
- Apagar todas as conversas, sem prazo nem exceção (inclui conversas citadas por memória).
- Apagar as chaves e os perfis de API do `ai-config.json`. Mantém só a configuração dos agentes (`codeHarness`, sandbox e afins).
- Apagar `ai-usage-log.json` e `ai-run-metrics.json`.
- Manter `agent-runs/` como evidência de auditoria (log e diff), ligado a projeto e sessão.
- A memória não guarda mais referência a conversa. A memória nova (Spec B) fica para depois.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- A importação de backup antigo **ignora** `conversations` e `chatImages` em vez de falhar. Restaurar um backup velho não traz o chat de volta.
- As memórias existentes ficam. `sourceConversationId` passa a nulo, e o trecho `(conversa completa: id=… — use ler_conversa…)` é removido do corpo dos handoffs antigos.
- A migração é idempotente e deixa uma marca em `settings` (`legacyChatRemovedAt`). Roda uma única vez.
- **Se o snapshot falhar, nada é apagado**, e a migração tenta de novo na abertura seguinte.
- Saem as ferramentas `buscar_conversas` e `ler_conversa`, e os canais `ai:conversations:*`, `ai:images:*`, `ai:usage:summary` e `ai:run-metrics:*`.
- O índice de busca global (FTS5) deixa de indexar conversas. Como é descartável, ele é reconstruído na migração.
- A regra de retenção de conversas por memória (`referencedConversationIds`, `retainReferencedConversations`) é removida junto com o histórico.
- As chaves de API só são apagadas depois que o snapshot e a limpeza de conversas terminam com sucesso.

## Comportamento

**Primeira abertura da versão nova**
1. Se a marca `legacyChatRemovedAt` existe, não faz nada.
2. Cria o snapshot em `userData/backups/` com nome `pre-remocao-chat-<timestamp>.json` (mesmo formato do snapshot pré-importação). Se falhar, aborta sem apagar nada e registra o erro.
3. Apaga `ai-conversations.json` e `chat-images/`.
4. Remove de `ai-config.json` as chaves de API e `providerProfiles`, o `baseUrl`/`apiKey`/`model` antigos, `modelComplex`, os preços de token e `codeAgent` (agente nativo). Preserva `codeHarness`, as flags de sandbox/ai-jail e **qualquer chave desconhecida**.
5. Apaga `ai-usage-log.json` e `ai-run-metrics.json`.
6. Limpa `sourceConversationId` e o ponteiro de conversa nos handoffs, em memórias ativas e arquivadas.
7. Reconstrói o índice de busca global.
8. Grava a marca `legacyChatRemovedAt`.

A migração é pensada para ser retomada: cada passo é idempotente, e a marca só é gravada no fim. A falha de um passo posterior não desfaz o anterior, mas a próxima abertura continua de onde parou.

**Depois da migração**
- Não existe tela de Chat nem histórico. Nada de conversa é salvo em disco.
- A barra lateral mantém o acesso a Agentes (Fleet), onde o usuário escolhe projeto/escopo, executor e abre o terminal.
- `codeHarness: 'sagyou'` (nativo) continua sendo lido como `codex`.

**Execuções (`agent-runs/`)**
- `AgentRunMeta` troca o vínculo `conversationId` por `projectId` (ou nulo para sessão geral) e `sessionId`.
- Execuções antigas, que só têm `conversationId`, continuam listáveis. O campo antigo é preservado e a lista não depende mais dele.
- O prazo de 24h para execuções arquivadas não muda.

**Backup**
- Exportar não inclui mais `conversations` nem `chatImages`.
- Importar um backup que os contenha ignora esses campos e restaura o resto normalmente. O mesmo vale para `memories` com `sourceConversationId`: o campo é descartado.
- A versão do formato do backup não muda de número. Os campos removidos são apenas opcionais.

**Casos de borda**
- App aberto sem `ai-conversations.json`: segue sem erro.
- Arquivo de conversas corrompido: é apagado do mesmo jeito, depois do snapshot. O snapshot guarda o que o app conseguiu ler.
- `ai-config.json` ilegível: não é sobrescrito nem apagado. A migração pula o passo 4 e registra o aviso, para não destruir um arquivo que ainda poderia ser recuperado.
- Sem espaço em disco para o snapshot: aborta sem apagar nada.
- Abrir o app duas vezes ao mesmo tempo: a marca e a escrita atômica evitam migração duplicada.

## Dados

⚠️ Breaking schema change — existing data may be affected. Esta feature **apaga dados do usuário de forma definitiva**.

- **Apagados:** `ai-conversations.json`, `chat-images/`, `ai-usage-log.json`, `ai-run-metrics.json`, e em `ai-config.json` as chaves e perfis de API.
- **Recuperável via snapshot:** conversas e imagens de chat. O snapshot é um backup v5, e a importação ignora esses campos, então **restaurar o snapshot não traz as conversas de volta pelo app**. O arquivo continua legível à mão.
- **Irrecuperável:** as chaves de API. O `ai-config.json` fica fora de qualquer backup, e a spec não cria cópia, porque guardar credenciais em um arquivo de backup seria um risco novo.
- **Preservado:** `kanban.db` inteiro (projetos, tasks, finanças, memória, etc.), `agent-runs/`, `files/`, `task-images/`, `skills/`, a configuração dos agentes e chaves desconhecidas do `ai-config.json`.
- **Novo:** a chave `legacyChatRemovedAt` em `settings` (aditiva, sem migração de schema).
- **Memória:** a coluna `source_conversation_id` deixa de ser lida e escrita e fica nula nas linhas existentes. A coluna não é removida do SQLite, para não exigir reconstrução de tabela.
- **Compatibilidade:** versão antiga do app abrindo os dados da nova ainda funciona, pois só faltam arquivos e chaves opcionais.

## Telas

- Remove a tela de Chat e seus painéis (histórico, configuração de API, gasto de tokens, Gerar Tasks).
- Mantém Agentes (Fleet), com o seletor de escopo, executor e terminal.
- A barra lateral perde o item Chat e mantém Agentes. Os textos seguem `UI_DESIGN.md`.
- Sem tela nova. A migração roda sem diálogo, mas o Fleet mostra, na primeira abertura depois dela, um aviso único e dispensável: "O histórico de conversas foi removido. Um backup foi salvo em <caminho>."

## Perguntas em aberto

(nenhuma)
