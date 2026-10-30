# Roteiro: Sagyou em vários aparelhos (sync, app Android e controle remoto)

Status: approved by Luis on 2026-10-30
Branch: feature/sync-registro-mudancas

Este documento é o mapa. Ele não autoriza construir nada sozinho: cada etapa abaixo
vira uma spec própria em `docs/specs/`, com aprovação, plano e PR separados. O que está
aqui são as decisões que valem para todas elas.

## Por quê

Luis usa o Sagyou em três aparelhos: o PC Windows de casa (principal), o PC Linux do
trabalho e um celular Android. Hoje os dados vivem num único `kanban.db` por máquina e
não há como vê-los ou alterá-los fora do PC onde foram criados. Fora de casa, ele quer
lançar um gasto, marcar um hábito ou criar uma tarefa pelo celular, e quer que a IA
(Claude Code) trabalhe no código do PC de casa, com acesso aos dados do Sagyou, a partir
do celular.

## Objetivos

- Os mesmos dados em todos os aparelhos, cada um com o próprio SQLite completo,
  funcionando offline e sincronizando quando há rede.
- Um app Android do Sagyou, sem site.
- Ligar, desligar e desbloquear o PC de casa pelo celular, e aprovar pelo celular as
  escritas arriscadas que a IA pedir.
- Nenhum dado do Sagyou legível fora dos aparelhos do Luis.

## Fora do escopo (de todo o roteiro)

- Vários usuários, compartilhamento ou contas.
- Site ou versão web.
- iPhone.
- Chat com IA dentro do Sagyou: a conversa acontece no app do Claude (Remote Control
  ou Claude Code na nuvem). O Sagyou removeu o chat de propósito.
- Fleet remoto dentro do app: o Remote Control do Claude Code já cobre isso.

## Decisões (de Luis, 2026-10-30)

- **Arquitetura local-first.** Cada aparelho guarda tudo e sincroniza só as mudanças.
- **Servidor:** Cloudflare Workers + D1, no plano gratuito. Ele só repassa mudanças
  cifradas e não consegue ler nada.
- **Criptografia de ponta a ponta** com uma chave de sync aleatória, criada no primeiro
  aparelho, pareada por QR code e com código de recuperação.
- **Aparelhos sincronizados:** PC Windows de casa, PC Linux do trabalho (com todos os
  dados, inclusive finanças) e o Android.
- **App mobile:** Expo / React Native, só Android, instalado por APK.
- **Repositórios:** o app mobile (`apps/mobile`), o código compartilhado (`packages/core`)
  e o Worker (`sync-server/`) ficam no repositório do Sagyou, para que uma mudança no
  protocolo de sync seja um PR só, testado dos dois lados. O código do ESP32 fica num
  repositório privado separado (configuração da casa, outra toolchain); ele se liga ao
  Sagyou só pelas rotas do Worker documentadas na spec da etapa 6. Segredos do ESP32
  ficam num `secrets.h` ignorado pelo git.
- **App v1:** tarefas, hábitos, lançamentos financeiros (gasto e receita), notas e
  busca. Ficam para a v2: finanças completas (dívidas, faturas, transferências entre
  moedas, conciliação), metas, planejamento, lista de compras, anexos e imagens.
- **IA:** Claude Code (plano Pro). Conversa pelo app do Claude, com Remote Control no
  modo `worktree`.
- **Desbloqueio do Sagyou:** (A) senha no PC, sempre disponível; (B) pelo celular,
  com biometria ou senha, cifrado e assinado; bloqueio automático por inatividade e
  quando a tela do Windows bloqueia; "lembrar neste PC" desligado. Até o app existir,
  o desbloqueio remoto é pelo RustDesk.
- **MCP externo:** token de 30 dias, renovado à mão, só em `127.0.0.1`, guardado como
  hash fora do SQLite e do backup. Escritas arriscadas pelo token externo são
  aprovadas pelo app mobile; até o app existir, são recusadas.
- **Ligar o PC:** ESP32 com Wake-on-LAN, alimentado por carregador próprio. **Desligar:**
  o ESP32 envia um comando pela rede local e um script no Windows executa
  `shutdown /s /t 60`, que pode ser cancelado. O comando remoto vem só pelo app, via
  Worker (etapa 6); sem bot do Telegram. Até lá, o ESP32 funciona só na rede local.

## Etapas

| # | Spec | Entrega | Depende de |
|---|---|---|---|
| 1 | `sync-registro-mudancas` | O desktop passa a saber, registro a registro, o que mudou, quando e em qual aparelho. Sem rede. | — |
| 2 | `sync-cloudflare` | Worker + D1, cifra, pareamento por QR, código de recuperação, aplicar mudanças recebidas, conflitos, revogar e apagar aparelho, tela "Sincronização". Dois PCs sincronizando. | 1 |
| 3 | `mobile-app` | `packages/core` compartilhado (tipos, normalização, dinheiro, regras), app Expo Android v1, APK. | 2 |
| 4 | `motor-bandeja` | Fechar a janela esconde; inicia com o Windows já na bandeja; sync e sinal de vida funcionam com o Sagyou bloqueado. | — |
| 5 | `mcp-externo` | Token de 30 dias para um Claude fora do Fleet (Remote Control); escritas arriscadas recusadas até a etapa 6. | 4 |
| 6 | `controle-remoto-app` | Ligar e desligar o PC pelo app (Worker + ESP32), "PC pronto", desbloquear e bloquear o Sagyou, aprovar escritas arriscadas. | 3, 4, 5 e o ESP32 |

As etapas 4 e 5 não dependem do sync e podem entrar antes, se o ESP32 chegar cedo.

## Regras que valem para todas as etapas

- **O servidor nunca vê conteúdo.** Ele conhece só números de sequência, tamanhos,
  horários e identificadores opacos de aparelho.
- **Nada do Sagyou fica acessível pela internet.** Toda conexão sai do aparelho para a
  Cloudflare; nenhuma porta é aberta no roteador.
- **O que é do aparelho não sincroniza:** caminhos de código e a seleção deles,
  timers rodando, tema e acessibilidade, perfil financeiro ativo, configuração dos
  agentes, senha do app, logs, runs do Fleet, skills e índices de busca.
- **Backup continua local e completo.** O sync não substitui o backup, e um backup
  restaurado nunca carrega a identidade de outro aparelho.
- **Dinheiro continua string decimal** em todos os aparelhos, com as mesmas regras
  compartilhadas pelo `packages/core` a partir da etapa 3.

## Fora do código (Luis monta em paralelo)

- Testar `claude remote-control` no Windows de casa (modo `worktree`) e abrir a sessão
  pelo app do Claude.
- Criar a conta gratuita na Cloudflare.
- Wake-on-LAN no Windows: BIOS (Wake on LAN ligado, ErP desligado), placa de rede
  ("pacote mágico"), Inicialização Rápida desligada, IPs fixos para o PC e para o ESP32.
- Comprar o ESP32 (DevKit ou Arduino Nano ESP32) e reservar um carregador USB.
- Firmware básico do ESP32 (Wake-on-LAN e desligar pela rede local); script de escuta
  no Windows (`C:\Program Files\esp32\`, tarefa como SYSTEM, firewall só para o IP do
  ESP32).
- Autologon + tarefa de logon que bloqueia a tela.

## Perguntas em aberto
