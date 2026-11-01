# Motor na bandeja

Status: approved by Luis on 2026-11-01
Branch: feature/motor-bandeja

Etapa 4 do roteiro `docs/specs/2026-10-30-sync-mobile-roteiro.md`.

## Por quê

O PC de casa vai virar o "motor" do Sagyou: ligado de longe (etapa 6), com o Claude
trabalhando pelo Remote Control (etapa 5) e o celular sincronizando com ele. Hoje isso
não funciona porque:

- fechar a janela encerra o app (`window-all-closed` chama `app.quit`), então o MCP, o
  sync e as sessões do Fleet morrem junto;
- depois de ligar o PC alguém precisa abrir o Sagyou à mão;
- desbloqueado uma vez, o Sagyou fica desbloqueado até fechar — ninguém tranca quando o
  PC fica sozinho ou quando o Windows bloqueia a tela;
- o sync só começa depois do desbloqueio, então um PC que ligou sozinho e está na tela
  de senha não recebe nem envia nada (nem uma ordem de "apagar dados" de um aparelho
  perdido).

## Objetivos

- O X da janela esconde o Sagyou na bandeja; ele continua rodando (MCP, sync, Fleet).
- Opção de iniciar com o Windows, já escondido na bandeja.
- Bloqueio automático por inatividade e quando a tela do Windows bloqueia.
- Com o Sagyou bloqueado, o MCP e as escritas param, mas o sync cifrado continua e o
  aparelho segue aparecendo como online para os outros.
- Sair (pelo menu da bandeja) e desligar o Windows não perdem dados.

## Fora do escopo

- Desbloquear pelo celular, "PC pronto", ligar/desligar pelo app: etapa 6.
- Token de MCP externo: etapa 5.
- Rota nova no Worker para sinal de vida: o "visto por último" que o Worker já grava a
  cada requisição autenticada basta nesta etapa.
- "Lembrar neste PC" (decisão do roteiro: desligado).
- Iniciar com o sistema no Linux e no macOS.

## Decisões (de Luis, no roteiro de 2026-10-30)

- Desbloqueio pela senha no PC (A); pelo celular (B) fica para a etapa 6.
- Bloqueio automático por inatividade e quando a tela do Windows bloqueia.
- Sem "lembrar neste PC".
- Com o app bloqueado o sync continua; nada de dados aparece na tela nem no MCP até
  desbloquear.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

1. **Inatividade = sem teclado/mouse no PC inteiro** (`powerMonitor.getSystemIdleTime`),
   não só na janela do Sagyou. Quem está programando no VS Code com o Sagyou na bandeja
   não é bloqueado; quem saiu de casa é. Verificado a cada 30 s.
2. **Tempo padrão: 15 min.** Opções: Nunca, 5, 15, 30 e 60 min.
3. **Bloquear também quando o sistema suspende** (sleep), junto com o bloqueio de tela.
4. **Bloqueio automático só existe com senha ativada.** Sem senha, as opções aparecem
   desabilitadas com a dica "Ative uma senha para usar o bloqueio automático."
5. **Bloquear = tela de senha no lugar do app, sem recarregar a página.** O renderer
   salva o que está pendente e troca a árvore inteira pela `UnlockScreen`. Os terminais
   do Fleet ficam vivos (o xterm de cada PTY já mora fora do React, em
   `liveTerminals.ts`) e voltam intactos ao desbloquear. Recarregar a página perderia o
   que está na tela de cada terminal.
6. **O Claude no terminal continua rodando** com o app bloqueado; só as chamadas MCP
   são recusadas. Cartões de aprovação pendentes são negados na hora do bloqueio
   (falha fechada), em vez de esperar os 5 min.
7. **Fechar esconde: ligado por padrão no Windows, desligado no Linux e no macOS.** No
   Linux muitos desktops (GNOME) não mostram ícone de bandeja, e o app sumiria sem
   como voltar.
8. **Uma só instância.** Abrir o Sagyou de novo (atalho, menu Iniciar) mostra a janela
   que já existe em vez de abrir outra sobre o mesmo banco. É também o caminho de volta
   se a bandeja não aparecer.
9. **Aviso único na primeira vez que o X esconde:** notificação do sistema "O Sagyou
   continua rodando na bandeja. Use Sair no ícone para encerrar."
10. **"Bloquear agora" no menu da bandeja** (só com senha ativada e app desbloqueado).
11. **Sinal de vida = o motor de sync continua puxando a cada 60 s** com o app
    bloqueado; o Worker já atualiza o "visto por último" do aparelho (no máximo uma vez
    por minuto).
12. **Desligar o Windows:** no aviso de fim de sessão do Windows o Sagyou pede ao
    renderer para salvar e para os cronômetros das runs, como no Sair. É o melhor
    esforço que o Windows permite (alguns segundos).

## Comportamento

### Bandeja e fechar

- Com "fechar esconde" ligado, o X (e Alt+F4) esconde a janela. O app, o MCP, o sync e
  as sessões do Fleet continuam.
- Ícone na bandeja, dica "Sagyou". Clique (ou duplo clique) mostra e foca a janela.
- Menu do ícone: **Abrir Sagyou**, **Bloquear agora** (quando aplicável), separador,
  **Sair**.
- **Sair** faz o fechamento de hoje: para os cronômetros das runs (até 3 s), pede ao
  renderer para salvar (`app:flush-before-close`) e só então encerra.
- Com "fechar esconde" desligado, o X encerra como hoje (com o mesmo salvamento). O
  ícone da bandeja aparece mesmo assim, para "Bloquear agora" e "Sair".
- A instalação de uma atualização (`update:install`) continua encerrando de verdade:
  esconder nunca segura o `quitAndInstall`.
- Abrir o Sagyou de novo com ele já rodando mostra e foca a janela existente.

### Iniciar com o Windows

- Opção "Iniciar com o Windows" (só no Windows), via `app.setLoginItemSettings` com um
  argumento `--hidden`. O estado mostrado vem do próprio sistema
  (`getLoginItemSettings`), então desligar pelo Gerenciador de Tarefas aparece aqui.
- Iniciado com `--hidden`, o app carrega tudo com a janela oculta: renderer vivo (o MCP
  depende dele), sync rodando, tela de senha por trás se houver senha.
- Iniciado à mão, abre a janela como hoje.

### Bloqueio

- Só com senha ativada. Gatilhos: inatividade do sistema ≥ tempo escolhido; tela do
  Windows bloqueada (`powerMonitor` `lock-screen`); sistema suspenso (`suspend`), estes
  dois quando "Bloquear quando o Windows bloquear a tela" estiver ligado (padrão
  ligado); "Bloquear agora" na bandeja.
- Ordem ao bloquear: o main avisa o renderer (`security:lock-request`); o renderer salva o
  que está pendente e responde; o main marca bloqueado (o mesmo `passwordUnlocked` de
  hoje, que já fecha todo IPC de dados) e nega os cartões MCP pendentes. Se o renderer
  não responder em 5 s, o main bloqueia assim mesmo.
- Bloqueado: a janela (visível ou não) mostra a `UnlockScreen` de hoje. Todo IPC de
  dados é recusado, como na abertura. Toda chamada MCP responde "O Sagyou está
  bloqueado. Desbloqueie no PC para continuar." sem ler nada.
- Desbloquear com a senha volta ao app no mesmo ponto (mesma tela, terminais intactos).
- Já bloqueado, um novo gatilho não faz nada.

### Sync com o app bloqueado

- O motor de sync passa a iniciar na abertura do app, não no primeiro `store:load`:
  envia, recebe, aplica no SQLite e obedece a "apagar dados" mesmo na tela de senha.
- Mudanças recebidas com o app bloqueado depois de um desbloqueio continuam indo ao
  renderer (que não mostra nada por trás da tela de senha); recebidas antes do primeiro
  desbloqueio, já estão no banco quando o `store:load` rodar.
- O "aguardando atualização" (sync em espera durante a checagem de versão) continua
  valendo igual.

### Desligar o Windows

- No fim de sessão do Windows (`session-end`), o app para os cronômetros das runs e
  pede o salvamento ao renderer, sem esconder nem perguntar nada.

## Dados

Sem mudança no SQLite, no backup ou no sync. Um arquivo novo, do aparelho:

| Arquivo | Conteúdo |
| --- | --- |
| `userData/desktop-prefs.json` (`desktop-prefs-dev.json` em dev) | `closeToTray` (bool), `idleLockMinutes` (0 = nunca, 5/15/30/60), `lockOnSystemLock` (bool), `trayNoticeShown` (bool) |

Fora do SQLite (o `persistAll` apaga `settings` no primeiro save) e fora de todo backup
e sync: são preferências desta máquina. Arquivo ausente ou ilegível = padrões (decisões
2, 3 e 7). Gravado com `.tmp` + rename. "Iniciar com o Windows" não é guardado aqui:
mora no próprio Windows.

## Telas

Em Configurações (segue `UI_DESIGN.md`):

- **Seção nova "Janela e inicialização"**:
  - Interruptor "Fechar a janela mantém o Sagyou na bandeja" — dica: "Use Sair no ícone
    da bandeja para encerrar."
  - Interruptor "Iniciar com o Windows (na bandeja)" — só no Windows.
- **Seção "Senha"**, abaixo do que já existe:
  - "Bloquear automaticamente após" — seletor Nunca / 5 min / 15 min / 30 min / 1 h.
  - Interruptor "Bloquear quando o Windows bloquear a tela".
  - Sem senha ativada: os dois desabilitados, com "Ative uma senha para usar o bloqueio
    automático."
- **Tela de bloqueio**: a `UnlockScreen` de hoje, sem mudança visual.
- **Bandeja**: ícone do app, dica "Sagyou", menu descrito acima.

## Perguntas em aberto

