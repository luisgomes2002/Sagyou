# MCP: credencial vale enquanto o terminal estiver aberto

Status: approved by Luis on 2026-10-30
Branch: feature/mcp-sem-expiracao

## Por quê

Toda sessão do Fleet recebe uma credencial MCP que expira 2 horas depois de aberta
(`expiresAt: Date.now() + 2 * 60 * 60 * 1000` em `src/main/index.ts`, conferido em
cada chamada em `modules/agent/sagyou-mcp.ts`). Numa sessão longa, o CLI continua
funcionando, mas toda ferramenta do Sagyou passa a responder `Sessão MCP inválida ou
expirada.` e não há como renovar: o único jeito é abrir outra sessão e perder o fio
do trabalho no CLI.

O prazo fixo não protege muito: a credencial já é revogada em todo caminho que
encerra a sessão (saída do CLI, erro, timeout, fechamento da janela), e o servidor MCP
morre com o app.

## Objetivos

- A credencial MCP de uma sessão vale enquanto o terminal dela estiver aberto, sem
  limite de tempo.
- Ela continua morrendo no instante em que a sessão termina, por qualquer caminho.

## Fora do escopo

- Botão ou comando de "renovar acesso".
- Mudar as permissões, o escopo de projeto/perfil financeiro ou o prazo dos cartões
  de aprovação (`MCP_APPROVAL_TIMEOUT_MS`, 5 min).
- Sessões já abertas antes da atualização (o app reinicia, então não há nenhuma).

## Decisões (de Luis, 2026-10-30)

- "Renovar toda vez até o terminal ser fechado": sem prazo de validade enquanto a
  sessão estiver viva.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Sem prazo nenhum, em vez de renovação deslizante.** Renovar a cada chamada
  ainda deixaria a credencial expirar se o agente ficasse mais de 2 h sem chamar o
  Sagyou (por exemplo, compilando ou esperando você), o que contraria o pedido. O que
  limita a vida da credencial passa a ser só o fim da sessão.
- **Sem teto absoluto** (por exemplo, 24 h). Um teto traria de volta o mesmo
  problema, só que mais tarde.
- **Defesa extra: a credencial só vale se a run ainda estiver viva.** Além da
  revogação que já existe, o broker confere a cada chamada que a run dona do token
  ainda está ativa no main. Se algum caminho de encerramento esquecer de revogar,
  a credencial morre do mesmo jeito. É a mesma checagem (`isRunLive`) que a fila de
  escrita já faz antes de preparar e de executar.
- O campo `expiresAt` da sessão MCP fica opcional. Ausente significa "sem prazo";
  o broker continua respeitando um prazo quando alguém passar um (os testes e
  qualquer uso futuro). As sessões do Fleet deixam de passar prazo.

## Comportamento

- Sessão aberta há mais de 2 h, terminal ainda aberto: toda ferramenta MCP funciona
  normalmente.
- Sessão encerrada (saída do CLI, Ctrl+C até sair, erro, fechamento da janela, app
  fechado): a próxima chamada com aquele token responde
  `Sessão MCP inválida ou expirada.`, como hoje.
- Token cuja run não está mais viva, mesmo sem ter sido revogado: mesma resposta, e
  o token é descartado.
- Nada muda para cartões de aprovação: continuam expirando em 5 min.

## Dados

Sem mudança de dados. O prazo só existe em memória no main; nada é persistido.

## Telas

Nenhuma mudança de tela.

## Documentação

Atualizar a frase "expire after at most two hours" em `CLAUDE.md` (Agent-first
architecture), "expira em no máximo duas horas" em `GUIDE.md` e o trecho
correspondente em `docs/harness-chat-architecture.md`, se houver: a credencial
passa a valer pela vida da sessão e é revogada em todo caminho de encerramento.

## Perguntas em aberto
