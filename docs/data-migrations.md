# Migrações de dados

Configurações e dados antigos são normalizados ao carregar. A gravação preserva campos
desconhecidos de configuração, e nomes antigos de ferramentas ou de executor (por exemplo
`codeHarness: 'sagyou'`, lido como `codex`) são convertidos só na leitura; o arquivo salvo não
é reescrito por essa compatibilidade.

Antes de importar um backup, o Sagyou cria um snapshot automático local. Para reverter uma
importação, importe esse snapshot em **Backup**. Não edite SQLite, arquivos de backup ou a
versão do backup manualmente: qualquer mudança de formato exige uma migração explícita e testes
de importação/exportação.

## Remoção do chat genérico e do histórico de conversas

⚠️ Esta migração **apaga dados do usuário de propósito**. Ela roda sozinha, uma única vez, na
primeira abertura da versão que removeu o chat por API (spec
`docs/specs/2026-10-24-remover-historico-chat.md`). O app não pergunta antes: tira o snapshot e
apaga.

### O que apaga

- `ai-conversations.json` (todo o histórico de conversas, sem prazo nem exceção, inclusive
  conversas citadas por memória);
- `chat-images/` (imagens coladas no chat) e `chat-files/` (texto extraído dos documentos
  anexados ao chat);
- `ai-usage-log.json` (registro de gastos) e `ai-run-metrics.json` (métricas por execução);
- do `ai-config.json`, exatamente estas chaves: `baseUrl`, `apiKey`, `model`,
  `providerProfiles`, `activeProviderProfileId`, `legacyProfileMigrated`, `chatProvider`,
  `modelComplex`, `maxSteps`, `inputPricePer1M`, `outputPricePer1M`, `timeoutMs`,
  `lastConversationId` e `codeAgent`;
- nas memórias (ativas e arquivadas), o vínculo com a conversa: `sourceConversationId` vira nulo
  e o trecho `(conversa completa: id=… — use ler_conversa…)` sai do corpo dos handoffs antigos.
  Nenhuma memória é apagada.

### O que preserva

`kanban.db` (projetos, tasks, finanças, hábitos, metas, memórias e o resto), `files/`,
`task-images/`, `skills/`, `agent-runs/` (log e diff das execuções, agora ligados a projeto e
sessão), `password-security.json`, os backups já existentes em `backups/`, a configuração dos
agentes (`codeHarness`, `userName`, `reasoningEffort`) e **qualquer chave desconhecida** do
`ai-config.json`. A coluna `source_conversation_id` continua na tabela `memory`, sem uso.

### Ordem dos passos

1. Se a chave `legacyChatRemovedAt` existe em `legacy-chat-state.json` (em `userData`), a migração não faz nada. Uma instalação que nunca teve chat (nada para apagar e nenhuma chave de API no `ai-config.json`) só recebe a marca, sem snapshot e sem aviso. Em build de desenvolvimento a migração **não roda** sem `SAGYOU_RUN_LEGACY_CHAT_REMOVAL=1`, porque só o banco tem sufixo de dev e o resto seria apagado dos dados reais. Se uma execução anterior foi interrompida, o snapshot já feito é reaproveitado (o caminho é gravado antes da primeira exclusão), em vez de criar um segundo sem conversas.
2. **Snapshot em pasta.** O processo main copia, sem passar pelo renderer, para
   `<diretório de dados>/backups/pre-remocao-chat-<timestamp>/`: `ai-conversations.json`,
   `chat-images/`, `chat-files/` (os que existirem) e uma cópia consistente do `kanban.db`. O
   `ai-config.json` **não** entra, porque contém as chaves. Se qualquer cópia falhar (inclusive
   por falta de espaço), a pasta incompleta é removida e **nada é apagado**.
3. Apaga as conversas, imagens e documentos de chat, o registro de gastos e as métricas.
4. Limpa o vínculo de conversa nas memórias.
5. O índice de busca global é derivado e já é reconstruído a cada abertura a partir do SQLite, onde conversas deixaram de ser indexadas; a migração não o reconstrói de novo.
6. **Por último**, remove as chaves de API do `ai-config.json`, com escrita atômica. Um arquivo
   ilegível **não é tocado** (a migração registra um aviso): ele ainda poderia ser recuperado.
7. Grava `legacyChatRemovedAt` em `legacy-chat-state.json`.

### Como achar o snapshot

Pelo aviso único do painel **Sessões de código**, que mostra o caminho completo e some quando
dispensado, ou abrindo a pasta de backups pelo menu **Backup**. O Sagyou guarda o caminho em
`legacy-chat-state.json` (`legacyChatSnapshotDir`, sempre o do **primeiro** snapshot) e a dispensa do aviso em
`legacyChatNoticeDismissedAt`. Esse arquivo é separado do banco de propósito: o SQLite esvazia a tabela
`settings` na primeira gravação de cada sessão, e a marca se perderia.

O snapshot é uma pasta de arquivos crus, legível à mão (o JSON de conversas abre em qualquer
editor). **Não é um backup importável**: nada na interface traz as conversas de volta.

### Perda definitiva das chaves de API

As chaves de API ficavam só no `ai-config.json`, que está fora de qualquer backup, e a migração
também não as copia, para não criar um arquivo de credenciais novo. Depois do passo 6 **elas não
podem ser recuperadas**: gere ou copie de novo no painel do provedor, se precisar delas em outra
ferramenta. Os CLIs (Codex, Claude Code, OpenCode) usam a própria conta e não dependem delas.

### Idempotência e retomada

Cada passo depois do snapshot é idempotente e a marca só é gravada no final. Se o app fechar ou um
passo falhar no meio, a próxima abertura executa o que faltou. Se o snapshot falhar, nada foi
apagado e a próxima abertura tenta de novo. Uma falha da migração é registrada no console e nunca
impede o app de abrir. Se a migração precisar rodar de novo depois de já ter apagado as
conversas, o snapshot repetido não terá conversas; por isso o aviso continua apontando o primeiro.

### Backups antigos

A versão do formato (7) não mudou. O backup novo não traz `conversations` nem `chatImages`, e a
importação de um backup antigo **ignora** esses campos (e `sourceConversationId` das memórias) em
vez de falhar: o resto é restaurado normalmente e o chat não volta.

### Regra

Não edite o SQLite, o `ai-config.json` nem os backups à mão para "desfazer" esta migração: o
formato novo não lê conversas, e um arquivo antigo colocado de volta no diretório de dados será
ignorado. Qualquer volta do chat exige uma spec nova.
