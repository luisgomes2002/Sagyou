# Logs de diagnóstico

Status: approved by Luis on 2026-10-27
Branch: feature/logs-diagnostico

## Por quê

O processo main só tem uns 12 `console.*` (`store.ts`, `index.ts`), que se perdem no app empacotado. Quando algo quebra (migração, backup, PTY, MCP, entrega de patch), não sobra rastro para diagnosticar, nem para a pessoa nem para a IA.

## Objetivos

- Gravar eventos estruturados (JSONL) em `userData/logs/`, um arquivo por dia.
- Dar à IA uma ferramenta MCP somente leitura para consultar esses logs.
- Nunca gravar segredo nem dado pessoal: só IDs, tipo de evento e mensagens técnicas.

## Fora do escopo

- Tela de logs no app (dá para abrir a pasta pelo sistema).
- Logs do renderer (só o main nesta etapa; erros do renderer que passam por IPC já chegam ao main).
- Envio remoto de logs.

## Decisões (de Luis, na task)

- JSONL em `userData/logs/`, um arquivo por dia.
- Eventos: erros, avisos, marcos de migração, backup automático/reparo, PTY/sessões, MCP (chamadas, aprovações, recusas) e entrega de patch.
- `scrubSecrets` antes de gravar; nunca conteúdo de tasks, valores financeiros nem token do MCP.
- Ferramenta MCP somente leitura com filtro por nível/período e saída limitada.
- Fora dos backups.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Retenção de 14 dias** (o limite de cima da task): na inicialização e na virada do dia, apaga `AAAA-MM-DD.jsonl` mais antigos que 14 dias. Arquivo do dia com mais de 5 MB para de receber eventos `info` (só `warn`/`error`), para um loop não encher o disco.
- **Formato da linha:** `{ "ts": ISO, "level": "info"|"warn"|"error", "area": "store"|"backup"|"pty"|"mcp"|"delivery"|"app", "event": "<snake_case>", "msg"?: string, "data"?: { ... } }`. `data` só aceita valores primitivos; strings passam por `scrubSecrets` e são cortadas em 500 caracteres; `msg` idem.
- **Lista de chaves proibidas em `data`** (descartadas mesmo se alguém passar): `token`, `content`, `body`, `title`, `description`, `amount`, `value`, `args`, `arguments`, `password`. MCP registra só o nome da ferramenta, `runId`, resultado (`ok`/`refused`/`error`) e duração.
- Escrita síncrona com `appendFileSync` (eventos são raros e pequenos); qualquer falha de escrita é engolida para o log nunca derrubar o app.
- `process.on('uncaughtException' | 'unhandledRejection')` e `render-process-gone` passam a gerar `error` (sem mudar o comportamento atual do app além de registrar).
- Os `console.*` existentes passam a chamar o logger (que também escreve no console em dev).
- **Ferramenta MCP `read_logs`** concedida a toda sessão de agente (é leitura de diagnóstico, sem dados pessoais): argumentos `level?` (`warn` = warn+error, `error`), `since?` (ISO ou `24h`/`7d`, padrão `24h`), `area?`, `limit?` (1–200, padrão 100). Devolve as linhas mais recentes primeiro, com `truncated` quando houver mais.

## Comportamento

- Abrir o app cria `userData/logs/` e registra `app/started` com versão e plataforma.
- Cada migração de schema que hoje faz `console.log` vira `store/migration` com o nome da migração.
- Backup: `backup/exported`, `backup/imported`, `backup/auto_snapshot`, `backup/repaired` com contagens; falhas como `error`.
- PTY: `pty/started` (runId, harness), `pty/exited` (runId, exitCode).
- MCP: `mcp/tool_call` (runId, tool, outcome, ms), `mcp/approval` (runId, tool, decision: approved/refused/timeout).
- Entrega: `delivery/applied` ou `delivery/failed` (runId, nº de arquivos).
- Pasta de logs ausente ou sem permissão: o app segue normal, sem log.

## Dados

Novo diretório `userData/logs/` com arquivos `AAAA-MM-DD.jsonl`. Não entra no SQLite nem no backup (o backup só copia o que lista explicitamente). Sem mudança em dados existentes.

## Telas

Nenhuma.

## Perguntas em aberto

Nenhuma.
