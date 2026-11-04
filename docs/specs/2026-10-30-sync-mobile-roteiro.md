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
- **Um servidor de Remote Control por projeto, iniciado no logon** (2026-11-03). O
  `claude remote-control` atende só a pasta onde foi aberto, e o app do Claude não
  escolhe pasta. Então uma tarefa do Agendador do Windows ("ao fazer logon", reiniciar
  se falhar) sobe um `claude remote-control --spawn worktree --name "<projeto>"` em
  cada pasta de projeto usada com frequência (`--spawn same-dir` numa pasta sem git).
  No app do Claude, cada servidor aparece pelo nome; dentro dele se abrem e se
  encerram quantas sessões forem precisas, cada uma no próprio worktree. O
  `sagyou-externo` está no escopo do usuário, então vale em todas. Um projeto sem
  servidor só entra iniciando um no PC. Fleet remoto continua fora do escopo.
- **Desbloqueio do Sagyou:** (A) senha no PC, sempre disponível; (B) pelo celular,
  com biometria ou senha, cifrado e assinado; bloqueio automático por inatividade e
  quando a tela do Windows bloqueia; "lembrar neste PC" desligado. Até o app existir,
  o desbloqueio remoto é pelo RustDesk. Com "Funcionar com o Sagyou bloqueado" ligado
  (spec `acesso-remoto`), o MCP externo lê e escreve sem desbloquear.
- **MCP externo:** decisão original (token de 30 dias, escritas arriscadas recusadas
  até a etapa 6) substituída em 2026-11-03 pela spec `acesso-remoto`: o token não
  vence, dá acesso total (todos os projetos, perfis financeiros e ferramentas) sem
  cartão de aprovação, e pode funcionar com o Sagyou bloqueado. Continua só em
  `127.0.0.1`, guardado como hash fora do SQLite e do backup, revogável no PC.
- **Login do Windows sem ninguém na frente** (aceito por Luis em 2026-11-03): ligado
  pelo ESP32, o PC precisa entrar sozinho na conta para o Sagyou e os servidores de
  Remote Control subirem. Usa o login automático do Windows; a tela pode ser bloqueada
  logo depois por uma tarefa de logon, e os processos continuam rodando. Risco aceito:
  quem estiver na frente do PC entra no Windows; o Sagyou continua protegido pela
  própria senha.
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
| 5 | `mcp-externo` → `acesso-remoto` | Token para um Claude fora do Fleet (Remote Control). Entregue como 30 dias e escopo fechado; a spec `acesso-remoto` o tornou permanente, total, sem cartão e capaz de funcionar com o Sagyou bloqueado, e trouxe parear outro aparelho pelo celular. | 4 |
| 6 | `controle-remoto-app` | Ligar e desligar o PC pelo app (Worker + ESP32), "PC pronto" (Sagyou **e** servidores de Remote Control de pé), desbloquear e bloquear o Sagyou, aprovar pelo celular as escritas arriscadas das sessões do Fleet (o token externo não pede mais cartão). | 3, 4, 5 e o ESP32 |

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
- Tarefa de logon no Agendador do Windows que sobe um `claude remote-control` por
  projeto (ver Decisões). Antes, rodar cada um uma vez à mão para responder ao "Enable
  Remote Control?" e ao "Trust <pasta>?": sem terminal, o comando não consegue perguntar
  e sai. Nunca na pasta do usuário (a confiança ali não fica salva).
- Criar a conta gratuita na Cloudflare.
- Wake-on-LAN no Windows: BIOS (Wake on LAN ligado, ErP desligado), placa de rede
  ("pacote mágico"), Inicialização Rápida desligada, IPs fixos para o PC e para o ESP32.
- Comprar o ESP32 (DevKit ou Arduino Nano ESP32) e reservar um carregador USB.
- Firmware básico do ESP32 (Wake-on-LAN e desligar pela rede local); script de escuta
  no Windows (`C:\Program Files\esp32\`, tarefa como SYSTEM, firewall só para o IP do
  ESP32).
- Autologon + tarefa de logon que bloqueia a tela. Com a tela bloqueada o Sagyou
  também bloqueia (`lockOnSystemLock`), então ligar "Funcionar com o Sagyou bloqueado"
  em Configurações → Acesso MCP externo; e desligar a suspensão do Windows.

## Requisitos para operar do exterior (proposta de 2026-11-04, a debater)

Cenário: o PC fica no Brasil e o Luis passa meses no Japão (UTC−3 × UTC+9), sem
ninguém para tocar no PC. Ainda não aprovado; a análise completa, com os caminhos
de ataque e as alternativas avaliadas (ai-jail, Docker, conta bot no GitHub), está
em [`docs/seguranca/2026-11-04-ameacas-acesso-remoto.md`](../seguranca/2026-11-04-ameacas-acesso-remoto.md).

**Para a spec da etapa 6 (`controle-remoto-app`):**

- Todo comando remoto (ligar, desligar, desbloquear, aprovar) sai assinado pela chave
  do celular e é verificado no destino (ESP32 ou PC), com prazo curto e nonce contra
  replay. O Worker só repassa e nunca é quem autoriza.
- O comando de rede local do ESP32 leva HMAC com segredo compartilhado + nonce
  (filtrar pelo IP de origem não autentica). O script que roda como SYSTEM aceita um
  único comando fixo, sem argumentos. A atualização OTA do ESP32 fica desligada ou
  com senha.
- **Kill switch pelo celular:** revogar o token MCP externo, parar os servidores de
  Remote Control e desligar o PC. Do exterior, é a única defesa.
- Cards no celular para deletes e dinheiro também no token externo, revendo a
  decisão de 2026-11-03 de não pedir cartão.
- TOTP para gerar convite de pareamento, em qualquer aparelho.

**Datas (12 h de fuso):** `todayLocalISO()` usa o relógio de cada aparelho, então o
PC e o celular discordam de qual é o dia de hoje durante metade do dia. Hábitos,
saldo atual, prazos e o "hoje" dos agentes do Remote Control (que rodam no PC) se
deslocam. A spec do MCP de hábitos (e as tools de transação e prazo) deve exigir a
data explícita, ou ao menos devolver a data usada, em vez de assumir o hoje do PC.

**Fora do código (antes de viajar):**

- Conta Windows padrão, sem admin, para o login automático, o Sagyou e os servidores
  de Remote Control. O script do ESP32 fica fora do alcance dela.
- BIOS com "Restore on AC power loss = Power On", IP fixo do ESP32, roteador que se
  religa sozinho (tomada inteligente), nobreak, e um relé no botão de power ou
  tomada inteligente para um PC travado.
- Windows Update sob controle (horário ativo ou pausa).
- 2FA sem SMS (passkey ou TOTP) na Anthropic, no GitHub e na Cloudflare; código de
  recuperação do sync e códigos de backup do TOTP impressos, longe do celular; um
  segundo aparelho pareado e o RustDesk funcionando a partir dele.
- GitHub: conta bot com papel Write no PC dos agentes, ruleset na `main` (PR com
  1 aprovação, checks, sem force-push), tags `v*`/`mobile-v*` só por admin,
  `mobile-release` restrito às tags `mobile-v*` e exigência de actions fixadas por SHA.
- Ensaio: uma semana operando só pelo celular, em 4G, incluindo uma queda de
  energia simulada.

## Perguntas em aberto

- Manter o token MCP externo sem cartão para deletes e dinheiro, ou exigir aprovação
  pelo celular? (ver o documento de ameaças)
- Rodar os servidores de Remote Control isolados (devcontainer com firewall de
  saída ou ai-jail no WSL2)? Falta testar se o MCP do Sagyou funciona de dentro deles.
- O PC Linux do trabalho precisa das finanças? Hoje o sync não tem escopo por aparelho.
