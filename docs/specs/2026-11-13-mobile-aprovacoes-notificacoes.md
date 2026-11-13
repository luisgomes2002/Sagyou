# Celular: aprovações, notificações e feedback do PC

Status: approved by Luis on 2026-11-13
Branch: feature/mobile-aprovacoes-notificacoes

Fatia da sprint "Mobile 2 — Telas, notificações e aprovações" (task-mãe "Reformular as telas do app mobile e aproximar do desktop", itens 3 e 7). Já entregues: Tarefas/navegação (`2026-11-10-mobile-tarefas-navegacao.md`) e Financeiro (`2026-11-10-mobile-financeiro.md`). Ficam para specs próprias: modal de confirmação único, tarefa abre só para ver, seletor de tarefas e lembretes locais (prazo de tarefa, hábito do dia, dívida/meta).

## Por quê
- Os cartões Aprovar/Recusar do Fleet e do token externo ficam misturados na aba PC, em "Aprovações pendentes". Quem está longe do PC e recebe "Aprovação pendente no Sagyou." precisa achar o cartão (vale 5 min) sem procurar.
- O app não guarda histórico: se a notificação sai da barra do Android, "PC pronto." e "O PC não foi desligado." se perdem.
- Hoje o celular só é avisado de 3 coisas. Fica de fora o que mais importa longe do PC: uma sessão de código que terminou, o PC que caiu sem avisar, um servidor de Remote Control que não subiu e qualquer evento de segurança.
- Ligar/Desligar o PC e os servidores não mostram o que está acontecendo: o botão desabilita e nada mais.

## Objetivos
1. Uma tela **Notificações**, aberta por um sino no cabeçalho de todas as abas, com contador de aprovações pendentes. Ela reúne os cartões de aprovação (Aprovar/Recusar) e o histórico de notificações.
2. Tocar em "Aprovação pendente" abre essa tela direto.
3. Mais tipos de push, em três categorias que o Android deixa silenciar separadamente (canais): **PC e servidores**, **Sessões de código** e **Segurança** (tabela em Comportamento).
4. Feedback por etapas, no próprio botão e numa linha de status, para Ligar PC, Desligar PC, Ligar servidor e Desligar servidor.

## Fora do escopo
- Histórico completo com o app fechado (push só de dados + tarefa em segundo plano): decidido "melhor esforço".
- Modal de confirmação próprio no lugar de `Alert.alert` (`PcScreen` continua com `Alert` por enquanto; a spec do modal único troca todos).
- Lembretes locais agendados no celular (tarefa com prazo, hábito do dia, dívida vencendo, meta perto do prazo): spec própria.
- Atualização do Sagyou pronta e conflitos de sync novos como push: ficam para depois.
- Notificar "acesso restaurado" (é uma ação do próprio celular, que já vê o resultado).
- Nome do projeto, da sessão ou conteúdo de cartão no texto do push (o Worker só envia textos fixos).
- Sincronizar o histórico entre aparelhos.

## Decisões (de Luis)
- **Onde fica:** um sino no cabeçalho (ao lado de Buscar e Ajustes), com contador de pendentes; uma tela única Notificações com cartões no topo e histórico abaixo. Nada de aba nova na barra de baixo.
- **Histórico em melhor esforço:** o Android mostra o push sozinho com o app fechado; o app anota quando está aberto, ao tocar na notificação e ao abrir (lendo as que ainda estão na barra). Limpar a barra com o app fechado pode perder uma entrada; aprovações pendentes nunca se perdem, porque vêm da inbox cifrada do PC.
- **Push do servidor ligado:** só quando o servidor foi ligado pelo celular. Ligar no PC, autostart (já existe "PC pronto.") e reinício após queda não notificam "ligou".
- **Tipos incluídos (2026-11-13):** sessão do Fleet terminou ou esperando resposta; segurança (controle remoto suspenso, acesso cortado, aparelho pareado ou revogado); PC sem sinal; servidor caiu ou não subiu.
- **Preferência por tipo:** passa a existir, porque agora são muitos tipos (ver decisão 4 do construtor).

## Decisões do construtor (o agente decidiu; o humano pode mudar)
1. **O sino só aparece com o celular autorizado** (`authorized === 'yes'`) e fora do `readOnly`, as mesmas condições da aba PC.
2. **Contador:** número vermelho = cartões ainda válidos (não expirados). Sem cartões mas com entradas não lidas no histórico, o sino mostra só um ponto. Abrir a tela marca o histórico como lido.
3. **Leitura da inbox:** os cartões vêm da inbox, que hoje só é lida (a cada 5 s) com a aba PC aberta. Passa a ser lida também (a) a cada 5 s com a tela Notificações aberta, (b) uma vez ao voltar para o primeiro plano e (c) uma vez ao receber um push com o app aberto.
4. **Preferência por categoria = canais do Android**, sem estado no Worker e sem D1: o app cria três canais (`pc`, `sessions`, `security`) ao abrir; o Worker coloca o `channel_id` no push; em Ajustes → "Notificações" há uma linha por categoria que abre a configuração do canal no Android (se o intent falhar, abre as configurações do app). O app não impede silenciar "Segurança": é escolha do Android. Silenciar um canal não afeta o sino nem os cartões (continuam vindo da inbox).
5. **Quem diz o tipo:** o push leva `data.code` (o código da tabela abaixo) além de `open: 'pc'`. `open` continua igual para não quebrar versões antigas do app. Push sem `code` (Worker antigo) entra no histórico com o texto da própria notificação, ou "Notificação do Sagyou".
6. **Texto único:** `NOTIFICATION_TEXT` e a categoria de cada código em `packages/core/src/control/` (junto de `NotifyCode`); um teste do `sync-server` confirma que `PUSH_TEXT` e os canais são iguais.
7. **Histórico:** no máximo 100 entradas e 30 dias, a mais nova primeiro, sem duplicar (chave = identificador da notificação do Android). Entrada de aprovação, se o cartão ainda é válido, mostra "Responder acima"; expirada, "Expirou".
8. **Feedback de ações:** etapas "Enviando pedido…", "Pedido enviado. Aguardando o PC…" e então "Concluído" (some em 3 s) ou erro. O fim de cada espera é observado no estado do PC, não adivinhado: Ligar PC → `ready` (limite 5 min); Desligar PC → `shutting-down` (1 min; depois vale a contagem que já existe); Ligar servidor → `running` (1 min); Desligar servidor → `stopped` (1 min). Esgotado o limite: "O PC não respondeu. Tente de novo." e o botão volta a funcionar. Recusa do PC mostra o motivo que já existe (`REMOTE_TEXT.server*`, `CONTROL_TEXT`).
9. **Sem animação que pisca:** indicador de progresso padrão do Android dentro do botão; com `useReducedMotion` vira só o texto da etapa.
10. **A aba PC mantém um aviso:** onde estavam os cartões, um cartão "N aprovações pendentes" com botão "Ver" que abre a tela Notificações. A aba PC deixa de renderizar cartões.
11. **"PC sem sinal" é detectado no Worker** (o PC caído não consegue avisar e o Worker não abre o estado cifrado). Detalhe em Comportamento e Dados. Limite: 10 min sem heartbeat.
12. **Detecção de aparelho pareado/revogado no PC** compara a lista de aparelhos a cada `checkDevices` (5 min) com a da verificação anterior, só em memória: a primeira verificação depois de abrir o Sagyou só cria a base. Mudanças com o Sagyou fechado não notificam.
13. **Limites contra rajada:** `session-done` e `session-waiting` no máximo 1 por sessão; `server-failed` no máximo 1 por servidor até ele voltar a `running`; `suspended` 1 por suspensão; `pc-silent` 1 por queda (reabilita quando o PC volta a mandar heartbeat).

## Comportamento
### Tipos de notificação
| Código | Categoria (canal) | Texto fixo | Quem dispara | Toque abre |
| --- | --- | --- | --- | --- |
| `ready` | PC e servidores | PC pronto. | já existe | aba PC |
| `shutdown-failed` | PC e servidores | O PC não foi desligado. | já existe | aba PC |
| `server-ready` | PC e servidores | Servidor de Remote Control ligado. | PC, quando um servidor pedido pelo celular fica pronto (`·✔︎· Ready`/`Connected`, origem `phone`) | aba PC |
| `server-failed` | PC e servidores | O servidor de Remote Control não subiu ou caiu. | PC: pedido do celular que termina em `start-failed` ou sai antes do Ready; ou servidor que estava `running` e saiu sem ser parado | aba PC |
| `pc-silent` | PC e servidores | O PC parou de responder. | Worker (agendado), ver abaixo | aba PC |
| `approval` | Sessões de código | Aprovação pendente no Sagyou. | já existe (cartão do Fleet ou do token externo) | tela Notificações |
| `session-done` | Sessões de código | Uma sessão de código terminou. | PC, na saída de uma sessão do Fleet (não quando o usuário a encerrou no PC) | aba PC |
| `session-waiting` | Sessões de código | Uma sessão de código está esperando você. | PC, quando a sessão estaciona uma pergunta do agente (`ai:code-agent:question-response`) | aba PC |
| `suspended` | Segurança | Controle remoto suspenso por tentativas recusadas. | PC, ao suspender (5 recusas, 15 min) | aba PC |
| `access-cut` | Segurança | Acesso remoto cortado. | PC, ao aceitar um `cut-access` (todos os celulares autorizados recebem, o que cortou também) | aba PC |
| `device-paired` | Segurança | Um aparelho foi pareado ao seu sync. | PC, ao ver um aparelho novo na lista | aba PC |
| `device-revoked` | Segurança | Um aparelho do seu sync foi revogado. | PC, ao ver um aparelho passar a revogado | aba PC |

Sem `FCM_SERVICE_ACCOUNT` nada quebra (já é assim). Um Worker antigo responde 400 `invalid notify` a um código novo; o PC ignora o erro.

### PC sem sinal
- O PC, em cada heartbeat, informa ao Worker um bit em claro `watch`: `true` enquanto o Sagyou roda no modo controlado; `false` num desligamento deliberado (pedido do celular, `before-quit`, instalação de atualização, controle remoto desligado). Assim, queda de energia ou travamento (último `watch` = `true`) é distinguível de um PC desligado de propósito.
- Um agendamento do Worker (a cada 5 min) olha `watch = true` com último heartbeat há mais de 10 min e sem aviso já enviado: manda `pc-silent` aos celulares com token e marca como avisado. Um novo heartbeat limpa a marca.
- O Worker nunca vê o estado cifrado: só `watch` e a hora do último heartbeat.

### Sino e tela Notificações
- Sino (ícone `Bell`, rótulo "Notificações", alvo 48 dp) no cabeçalho de cada aba, antes da lupa. Com N cartões válidos, o rótulo acessível é "Notificações, N aprovações pendentes".
- Tela (rota da pilha raiz `Notificacoes`, título "Notificações"):
  1. **Aprovações pendentes (N)**: os cartões de hoje (`resumo`, `sessão · ferramenta · contagem regressiva`, botões **Aprovar** e **Recusar** com `a11yLabel` "Aprovar: <resumo>"). Mesmas regras de hoje: botões desabilitados com o cartão expirado ou `busy`; respondido/expirado some e mostra `CONTROL_TEXT.cardGone`. Vazio: a seção não aparece.
  2. **Histórico**: linha com ícone da categoria, texto, categoria e data e hora ("hoje 14:32", "ontem 09:10", "12/11 14:32"). Não lidas em negrito até a tela abrir. Vazio: "Nenhuma notificação ainda." Com entradas, ação **Limpar histórico** (apaga só o histórico, nunca cartões).
  3. Se não houver nada em nenhuma seção, só o estado vazio.
- Toque numa entrada abre o destino da tabela (`approval` rola até os cartões, que já estão na própria tela).
- Toque na notificação "Aprovação pendente": navega para `Notificacoes` por cima da aba atual; voltar volta para onde estava.
- Ajustes → "Notificações": uma linha por categoria ("PC e servidores", "Sessões de código", "Segurança") que abre a configuração do canal no Android.

### Entradas do histórico
- Notificação recebida com o app aberto → entrada na hora.
- Toque numa notificação (app fechado ou em segundo plano) → entrada e navegação.
- Ao abrir o app e ao voltar ao primeiro plano: as notificações ainda na barra (`getPresentedNotificationsAsync`) entram se ainda não estiverem no histórico.
- Texto da entrada = `NOTIFICATION_TEXT[code]`; só o código e o horário são guardados, nunca o conteúdo de um cartão.

### Aba PC
- Ligar PC, Desligar, Ligar servidor, Desligar servidor: ao tocar, o botão fica desabilitado e mostra o indicador; abaixo (ou na linha do servidor) aparece a etapa atual numa região viva (`accessibilityLiveRegion="polite"`).
- Ligar PC espera até 5 min e diz "Ligando o PC… pode levar alguns minutos." na etapa de espera.
- Concluído: "PC ligado." / "Desligamento iniciado." / "Servidor <nome> ligado." / "Servidor <nome> desligado." por 3 s.
- O estado de uma ação sobrevive a trocar de aba; some ao fechar o app. Duas ações ao mesmo tempo não existem (já é assim: `busy`).
- Mantém o que existe: contagem regressiva do desligamento, "Forçar pelo ESP32", "Cortar acesso" (60 s).

### Bordas
- Sem permissão de notificação: o sino e a tela funcionam; só o histórico fica sem o que viria do push.
- Cartão que expira com a tela aberta: some no próximo relógio de 1 s.
- Celular desconectado/revogado (`readOnly`, 401): sino some; histórico apagado no wipe/"Desconectar".
- Offline: a tela mostra o que tem e o aviso de conexão que a aba PC já usa.
- Vários celulares autorizados: todos recebem os pushes; só quem pediu a ação recebe `server-ready`.

## Dados
- **Celular:** nova preferência do aparelho `notifications.history` na tabela `prefs` (JSON `[{ id, code, at, read }]`, máx. 100, 30 dias). Nunca sincronizada, nunca em backup, apagada pelo wipe/"Desconectar" junto com as demais linhas. Sem tabela nova, sem migração. Nada de conteúdo de cartão, chave ou estado do controle (continuam só no secure store). Três canais de notificação do Android criados no código (`pc`, `sessions`, `security`).
- **Core:** `NotifyCode` ganha os novos códigos; tabela código → texto e categoria. A mensagem assinada não muda de formato (só o campo `notify` do `/control/send`, que o Worker já aceita só do PC).
- **Worker (`sync-server`):** `NotifyCode`/`PUSH_TEXT` ampliados; o payload do FCM ganha `data.code` e `android.notification.channel_id`.
- ⚠️ **Mudança de schema do D1 e de deploy do Worker (aditiva):** uma tabela nova `pc_watch` (`watch`, `last_heartbeat_at`, `notified_at`), idempotente (`CREATE TABLE IF NOT EXISTS` em `schema.sql`), e um `[triggers] crons = ["*/5 * * * *"]` no `wrangler.toml`. Exige rodar o comando do README para aplicar a tabela e `wrangler deploy`. Um D1 sem a tabela responde `501 control not deployed` à parte de `watch` e o resto (sync, controle, push) continua; sem o agendamento, só o `pc-silent` deixa de existir. Nenhum dado existente é alterado.
- **Desktop:** nenhuma mudança de dados persistidos; o PC só passa a enviar mais códigos e o bit `watch`. (A base de aparelhos de `device-paired/revoked` fica em memória.)
- Compatibilidade: app novo com Worker antigo funciona (sem `code`, entrada genérica, sem canais); Worker novo com app antigo funciona (`open: 'pc'` continua; `code` desconhecido ignorado; sem os canais o Android usa o canal padrão); PC antigo não manda `watch`, então o Worker nunca emite `pc-silent` por ele.

## Telas
- Segue `UI_DESIGN.md` e o design system do celular (`theme.ts`, componentes de `ui.tsx`, alvos de 48 dp, `a11y.test`).
- Sino: ícone `Bell` em `components/icons.ts`, selo vermelho com número (`Badge`), ponto quando há só não lidas.
- Notificações: `Header` padrão, seções com título em `FONT.caption` como na aba PC, `Card` para cartões, `ListItem` para histórico, `EmptyState` vazio. Um ícone por categoria em `components/icons.ts`.
- Aba PC: linha de etapa com indicador pequeno, cores sóbrias (`theme.muted` para andamento, `theme.green` para concluído, `theme.red` para erro).
- Ajustes: grupo "Notificações" com as três linhas de categoria.
- Textos exatos: os da tabela de tipos, mais "Notificações", "Aprovações pendentes", "Histórico", "Nenhuma notificação ainda.", "Limpar histórico", "Enviando pedido…", "Pedido enviado. Aguardando o PC…", "Ligando o PC… pode levar alguns minutos.", "O PC não respondeu. Tente de novo.", "N aprovações pendentes", "Ver", "PC e servidores", "Sessões de código", "Segurança".

## Perguntas em aberto
(nenhuma)
