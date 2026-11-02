# MCP externo (etapa 5 do roteiro)

Status: approved by Luis on 2026-11-02
Branch: feature/mcp-externo
Roteiro: docs/specs/2026-10-30-sync-mobile-roteiro.md (etapa 5)

## Por quê

Hoje só uma sessão do Fleet fala com os dados do Sagyou: o broker MCP dá a cada
run uma credencial que vive só enquanto o terminal dela existe. Fora de casa, o
Luis conversa com o Claude Code pelo Remote Control (app do Claude no celular),
numa sessão aberta no PC fora do Fleet, e essa sessão não tem como ler ou criar
tarefas no Sagyou. A etapa 5 dá a esse Claude um acesso próprio, com prazo,
escopo e sem as escritas arriscadas, que só voltam com a aprovação pelo celular
na etapa 6.

## Objetivos

1. Um token MCP externo de 30 dias, gerado, renovado e revogado à mão em
   Configurações, que um Claude Code fora do Fleet usa para falar com o Sagyou.
2. Escopo escolhido ao gerar: projeto padrão (ou nenhum), perfil financeiro, e
   "só leitura" ou "leitura e escrita".
3. Escritas arriscadas sempre recusadas pelo token externo, com uma mensagem que
   diz onde fazer.
4. Validade e último uso visíveis; aviso 3 dias antes de vencer.

## Fora do escopo

- Aprovar escritas arriscadas pelo celular (etapa 6).
- Acesso pela rede: o broker continua só em `127.0.0.1`.
- Vários tokens ao mesmo tempo (há um só; gerar outro revoga o anterior).
- Configurar o Codex ou o OpenCode fora do Fleet (o comando pronto é do Claude
  Code; o formato fica documentado para os outros).
- Handoff de terminal: o token externo não tem fim de sessão, então não grava a
  memória `handoff:*`.

## Decisões (de Luis, no roteiro e na task)

- Token de 256 bits, mostrado **uma vez**, válido por **30 dias**, renovado à mão.
- Guardado só como **hash**, num arquivo próprio em `userData`, **fora do SQLite e
  do backup**. Nunca aparece em log.
- Só em `127.0.0.1`.
- Renovar revoga o anterior na hora.
- Token vencido responde: "Token expirado: renove em Configurações → Acesso MCP
  externo".
- Ferramentas de `MCP_APPROVAL_REQUIRED` (excluir, dinheiro, arquivar projeto,
  tabelas e perfis financeiros, apagar memória) e `save_memory`/`criar_task`
  respondem: "Esta ação exige aprovação: faça pelo Sagyou ou por uma sessão do
  Fleet".
- Exceção deliberada à regra "credencial MCP vive só enquanto o terminal" (#28):
  esta credencial tem prazo fixo e vive fora de uma run.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Arquivo do token:** `userData/mcp-external.json` (`mcp-external-dev.json` em
  dev), modo 0600, gravado com `.tmp` + rename: `{ hash, createdAt, expiresAt,
  lastUsedAt, projectId, financialProfileId, mode }`. `hash` = SHA-256 hex do
  token; a conferência usa `timingSafeEqual`. Arquivo ilegível = sem token (o
  acesso fica recusado; gerar de novo sobrescreve).
- **Como o Claude Code se conecta:** uma ponte stdio fixa,
  `userData/mcp-external-bridge.cjs`, gravada pelo app ao gerar o token, rodada
  pelo próprio executável do Sagyou com `ELECTRON_RUN_AS_NODE=1` (não exige Node
  instalado). Como a porta do broker muda a cada abertura, o app grava a porta em
  `userData/mcp-external-port` (só o número, não é segredo) e a ponte lê esse
  arquivo a cada conexão. O token vai na variável `SAGYOU_MCP_TOKEN` da
  configuração do Claude Code.
- **Comando pronto para copiar** (mostrado uma vez, junto com o token):
  `claude mcp add sagyou-externo --scope user -e ELECTRON_RUN_AS_NODE=1 -e SAGYOU_MCP_TOKEN=<token> -e SAGYOU_MCP_PORT_FILE="<userData>/mcp-external-port" -- "<executável do Sagyou>" "<userData>/mcp-external-bridge.cjs"`.
  O nome `sagyou-externo` não colide com o `sagyou` que o Fleet injeta. Aviso na
  tela: o token fica salvo em texto na configuração do Claude Code
  (`~/.claude.json`); revogar aqui o invalida.
- **Ferramentas por modo:** "só leitura" lista só as de leitura (`read_*`, `list_*`,
  `search_memory`, `read_memory`, `check_memories`, `ler_*`, `read_logs`); "leitura
  e escrita" lista também as escritas. As arriscadas **aparecem na lista** e são
  recusadas com a mensagem da decisão acima, para o agente saber onde mandar o
  usuário.
- **Escritas permitidas** passam pela mesma fila por run (`McpWriteQueue`, run
  fixa `external`) e pela validação do renderer; exigem o app desbloqueado e o
  store carregado, como hoje.
- **Cronômetros** iniciados pelo token externo se comportam como os do usuário:
  não são parados sozinhos (não há fim de sessão).
- **Último uso:** atualizado a cada chamada autorizada, gravado no arquivo no
  máximo uma vez por minuto.
- **Aviso de vencimento:** uma notificação do sistema ("O acesso MCP externo vence
  em N dias. Renove em Configurações → Acesso MCP externo.") quando faltam 3 dias
  ou menos, ao abrir o app e a cada 12 h, no máximo uma vez por dia.
- **Log:** área `mcp`, eventos `external_token_created`, `external_token_revoked`,
  `external_refused` (`reason`: `expired` | `revoked` | `risky` | `readonly`),
  sem token, hash ou argumentos. O `tool_call` existente vale também com
  `runId: 'external'`.
- **Tela:** nova seção **Acesso MCP externo** em Configurações (id
  `mcp-externo`), entre Sincronização e Sistema.

## Comportamento

### Gerar

- Sem token: a seção mostra "Nenhum acesso externo." e o formulário: Projeto
  padrão (lista de projetos ativos + "Nenhum"), Perfil financeiro (perfis
  existentes; padrão o ativo), Acesso ("Só leitura" | "Leitura e escrita",
  padrão "Só leitura") e o botão **Gerar acesso**.
- Ao gerar: o token e o comando aparecem uma vez, com **Copiar comando**, o aviso
  "Este é o único momento em que o token aparece. Guarde o comando ou gere outro
  depois." e **Pronto** (some ao sair da seção ou ao clicar Pronto).

### Estado

- Ativo: "Válido até <data>", "Último uso: <data>" (ou "Nunca usado"), o escopo
  ("Projeto: X · Perfil: Y · Leitura e escrita"), **Renovar** e **Revogar**.
- Vencido: "Vencido em <data>" e **Renovar** / **Revogar**.
- Renovar: gera um token novo com o **mesmo escopo** e 30 dias a partir de agora;
  o anterior deixa de valer na hora; mostra o token e o comando de novo.
- Revogar: confirmação "Revogar o acesso MCP externo? O Claude que usa este token
  perde o acesso na hora." → apaga o arquivo; estado "Nenhum acesso externo.".

### Pelo MCP

- Token ausente, revogado ou desconhecido: "Sessão MCP inválida ou expirada."
  (a mesma de hoje).
- Token vencido: "Token expirado: renove em Configurações → Acesso MCP externo".
- App bloqueado: a mensagem de bloqueio de hoje.
- Arriscada (lista da decisão): "Esta ação exige aprovação: faça pelo Sagyou ou
  por uma sessão do Fleet".
- Escrita com token "só leitura": a ferramenta não aparece e, se chamada,
  "Ferramenta indisponível nesta sessão MCP." (a de hoje).
- Leituras sem `projectId` usam o projeto padrão do token; sem projeto padrão,
  leem todos os projetos (como uma sessão geral). Finanças ficam no perfil do
  token, como nas runs.

## Dados

Sem mudança no SQLite nem no backup. Arquivos novos em `userData`, fora de todo
backup: `mcp-external.json` (hash e metadados, 0600), `mcp-external-bridge.cjs`
(fonte da ponte, sem segredo), `mcp-external-port` (número da porta).
`wipeLocalData` (apagar à distância) também apaga `mcp-external.json`.

## Telas

- Configurações → **Acesso MCP externo**, no padrão do UI_DESIGN.md (como a
  seção Sincronização): estado, formulário de geração, bloco do token/comando
  com Copiar, botões Renovar/Revogar e o diálogo de confirmação.
- Notificação do sistema de vencimento.

## Perguntas em aberto

(nenhuma)
