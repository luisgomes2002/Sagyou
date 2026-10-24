# Chat único por harness

**Status:** decisão de arquitetura.  
**Escopo:** substitui o chat genérico do produto e qualquer segundo chat de
"Agentes". Não substitui o terminal local usado para diagnóstico, nem a revisão
de diff.

## Decisão

O Sagyou terá uma única thread de agente de código por vez na interface principal.
Essa thread é sempre executada por um harness local escolhido pelo usuário:
**Codex**, **Claude Code** ou **OpenCode**. O aplicativo coordena escopo, segurança,
persistência da sessão e entrega do patch; não chama um modelo por API nem mantém
um loop de ferramentas próprio para responder à mesma conversa.

Uma conversa genérica existente é um artefato de migração somente-leitura. Ela não
ganha entrada, streaming, configuração de provedor ou novas runs. Não há fallback
silencioso de um harness para outro e não existe modo "chat por assinatura/API" em
paralelo.

## Limites de responsabilidade

```
Thread única (renderer)
  -> IPC restrito
Main: sessão + worktree + MCP + PTY/protocolo + arquivo de execução
  -> adaptador do harness selecionado
Codex | Claude Code | OpenCode
  -> worktree isolada e MCP com credencial efêmera
```

O renderer nunca escolhe caminho de executável, argumentos arbitrários, diretório
de trabalho ou token. O main escolhe um binário previamente reconhecido e cria a
sessão somente depois de congelar o escopo.

O harness opera arquivos apenas na worktree. Dados do Sagyou só chegam por MCP
escopado; nunca por SQLite, IPC interno, snapshot Zustand, variáveis de ambiente
com segredo ou texto injetado no prompt. A aprovação de uma escrita MCP e a
aprovação final do patch são decisões distintas.

## Contrato comum de sessão

Todo adaptador implementa o contrato abaixo. Campo indisponível permanece
`unsupported`/`unknown`; nunca é inferido, emulado ou convertido em sucesso.

```ts
type HarnessId = 'codex' | 'claude-code' | 'opencode'
type Availability = 'available' | 'unavailable' | 'unknown'

interface HarnessCapabilities {
  interactiveTerminal: Availability
  createSession: Availability
  resumeSession: Availability
  modelSelection: Availability
  modelStatus: Availability
  permissionPrompts: Availability
  cancellation: Availability
  mcp: Availability
  localInstructionDiscovery: Availability
}

interface HarnessSession {
  id: string // id interno do Sagyou; não é o id opaco do fornecedor
  harness: HarnessId
  harnessSessionId: string | null
  projectId: string | null
  financialProfileId: string | null
  root: string
  worktree: string
  allowedPaths: string[]
  state: 'starting' | 'running' | 'awaiting_review' | 'stopped' | 'failed' | 'delivered'
  capabilities: HarnessCapabilities // snapshot obtido no início
  startedAt: string
}

interface HarnessAdapter {
  discover(): Promise<{
    executable: Availability
    version: string | null
    authentication: Availability
    capabilities: HarnessCapabilities
    reason?: string
  }>
  start(session: HarnessSession, brief: string): Promise<void>
  sendInput(sessionId: string, input: string): Promise<void>
  resize(sessionId: string, cols: number, rows: number): Promise<void>
  stop(sessionId: string): Promise<void>
  reconnect(sessionId: string): Promise<{ buffer: string }>
  finalize(sessionId: string): Promise<void>
}
```

`start` recebe uma worktree já criada e um MCP já emitido. `finalize` não entrega
o patch: ele encerra o harness e inicia a validação de escopo, o diff congelado e
a revisão humana. A sessão arquivada conserva eventos, status e capacidades
observadas; não consulta o CLI novamente para reconstruir seu estado.

## Ciclo de vida invariável

1. O usuário escolhe um harness disponível e uma raiz autorizada; o main captura
   projeto, perfil financeiro, permissões e caminhos permitidos.
2. O main cria uma worktree detached, emite MCP limitado à run e grava o snapshot
   de capacidades antes de iniciar o harness.
3. A thread única exibe o transporte nativo disponível (PTY ou protocolo do
   harness), perguntas e aprovações MCP. Navegar não cria outra sessão.
4. Stop, crash, timeout, fechamento ou fim normal revogam MCP e encerram o
   processo/conexão. Nenhum destes caminhos escreve na árvore original.
5. No fim normal, o main valida o conjunto completo de caminhos e congela log e
   patch. Somente uma aprovação manual aplica o patch serialmente; conflito,
   escopo inválido ou recusa preservam a árvore original.

## Matriz de capacidades verificáveis

| Capacidade | Codex | Claude Code | OpenCode | Regra do produto |
| --- | --- | --- | --- | --- |
| Detecção/versão | binário reconhecido + `--version` | binário reconhecido + `--version` | binário reconhecido + `--version` | Não iniciar se não for verificável. |
| Autenticação | status nativo quando o comando estiver disponível | desconhecida sem comando estável | desconhecida sem comando estável | `unknown` não vira autenticada nem abre login. |
| Thread/retomada | id de thread via app-server/SDK quando usado | `--resume` ou `--continue` conforme CLI | `--session`/`--continue`, ou ACP | Guardar o id opaco apenas quando o harness o devolver. |
| Terminal interativo | PTY | PTY | PTY | ANSI, entrada, colagem, Ctrl+C e resize são pass-through validado. |
| Escolha/estado do modelo | só pelo protocolo/CLI que o expuser | `--model` quando aceito pela versão | `--model` e opções de sessão quando expostas | Mostrar somente valor observado. |
| Perguntas/permissões | capacidade do protocolo/TUI | prompt de permissão do CLI | API/ACP quando disponível | A autorização MCP continua exclusivamente do Sagyou. |
| Cancelamento | interrupção documentada pela sessão/PTY | interrupção da sessão/PTY | `session/cancel` em ACP ou PTY | Stop sempre revoga MCP primeiro; sucesso do cancelamento não é presumido. |
| MCP | configuração suportada pelo harness | `claude mcp`/configuração suportada | MCP por sessão/configuração suportada | Injetar só servidor loopback efêmero e token da run. |
| Instruções locais | descoberta nativa observável | descoberta nativa observável | configuração do cwd observável | Somente dentro da raiz/worktree; metadados, nunca secrets. |

A matriz é uma política de interface, não uma alegação de paridade. Versão, ajuda
e resultado real de inicialização são a evidência por sessão. Quando uma versão do
CLI não suporta uma operação, a thread explica a limitação e desabilita o controle.

As referências usadas para a matriz são as documentações oficiais de [Codex e
app-server](https://developers.openai.com/blog/codex-as-a-platform), [Claude Code
CLI](https://docs.anthropic.com/en/docs/claude-code/cli-usage) e [OpenCode
CLI/ACP](https://dev.opencode.ai/v2/docs/cli/acp/). Elas devem ser verificadas de
novo ao atualizar um adaptador, pois flags e protocolos evoluem independentemente.

## O que não faz parte do contrato

- Não há adaptador que execute um endpoint OpenAI-compatível, ChatGPT, Anthropic
  API ou uma chave fornecida pelo usuário como alternativa ao harness.
- Não há seleção de executável, `cwd`, flag de permissões ou servidor MCP livre no
  renderer.
- Não há equivalência inventada entre slash commands, modelos, skills, permissões
  ou formatos de sessão dos três CLIs.
- Não há entrega automática de patch, mesmo que o harness tenha modo auto-approve.

## Migração

1. Introduzir o adaptador e a thread única atrás do contrato, mantendo conversas
   anteriores somente para leitura.
2. Migrar preferências antigas para `HarnessId` apenas quando o valor for válido;
   valor desconhecido exige nova escolha explícita.
3. Remover o launcher separado, a view Fleet como segunda conversa e toda chamada
   `ai:chat*`/configuração de API depois que a thread única estiver coberta por
   testes de migração e backup/restore.
4. Testar cada adaptador com doubles determinísticos; CI não autentica nem inicia
   CLIs reais.
