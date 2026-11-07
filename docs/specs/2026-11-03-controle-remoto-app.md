# Controle remoto do PC pelo app

Status: approved by Luis on 2026-11-03
Branch: feature/controle-remoto-app

Adendo aprovado por Luis em 2026-11-03 (durante o build): **chave do PC antes de autorizar**
e **instalar a atualização do Sagyou pelo celular** (seções "Autorizar o celular" e
"Atualizar o Sagyou pelo celular").

Etapa 6 do roteiro `docs/specs/2026-10-30-sync-mobile-roteiro.md`. Depende das etapas 3
(app Android), 4 (motor na bandeja) e 5 (MCP externo / acesso remoto), todas entregues.

## Por quê

Fora de casa, Luis quer pelo celular: ligar o PC de casa, saber quando ele está pronto
para o Claude trabalhar (Sagyou de pé **e** os servidores de Remote Control rodando),
desbloquear e bloquear o Sagyou, aprovar as escritas arriscadas das sessões do Fleet e
desligar o PC sem perder nada. Hoje isso depende do RustDesk ou de estar na frente do PC.

## Objetivos

- Ligar o PC pelo app (Worker → ESP32 → Wake-on-LAN).
- Ver o estado do PC: Desligado / Ligando / Ligado, aguardando o Sagyou / Remote Control
  fora do ar / Pronto.
- Desligar com segurança pelo Sagyou (salva tudo antes) e, com o Sagyou fora do ar,
  forçar pelo ESP32.
- Desbloquear e bloquear o Sagyou do PC com a biometria do celular.
- Aprovar ou recusar pelo celular os cartões de escrita arriscada das sessões do Fleet.
- Notificação push "PC pronto" e "Aprovação pendente", com o app fechado.
- Trocar de celular estando longe do PC (outro país), sem ninguém em casa.
- Nada disso abre porta no roteador nem deixa o Worker ler conteúdo.

## Fora do escopo

- Firmware do ESP32 (task 6.6, repositório privado `ESP32-PC-BOOT`). Esta spec só define
  as rotas que ele consome.
- Montagem física: comprar o ESP32, Wake-on-LAN na BIOS, script `ouvir-esp32.ps1`,
  autologon, servidores de Remote Control no logon, projeto no Firebase (tasks de
  "PC remoto — montagem").
- PC controlado em Linux ou macOS: só Windows (os comandos de desligar e a detecção dos
  servidores são do Windows).
- Mais de um PC controlado por grupo de sync.
- Fleet remoto, chat, ver o terminal pelo celular.
- O token MCP externo: ele já não pede cartão, então não gera nada para aprovar.

## Decisões (de Luis, 2026-11-03)

- **Aprovar pelo celular (6.4) entra nesta etapa.**
- **"PC pronto" usa uma lista configurada no Sagyou** dos servidores de Remote Control
  que precisam estar rodando; o app diz quais faltam.
- **Constrói sem o hardware**: rotas do Worker, token do ESP32 e botões no app entram
  agora, testados com um ESP32 simulado (script). Teste real quando o ESP32 chegar.
- **Desligar: Sagyou primeiro, ESP32 de reserva.** Com o Sagyou vivo, ele desliga com
  segurança; sem sinal de vida, o app oferece "Forçar pelo ESP32".
- **Desbloquear só com a biometria do celular** (sem digitar a senha do Sagyou).
- **O PC autoriza o celular uma vez, com a senha do Sagyou**, em Configurações; só
  celulares autorizados controlam o PC. Revogável no PC.
- **Push com Firebase Cloud Messaging**, texto genérico; o conteúdo só aparece no app.
- **Lista do "PC pronto" por nome do `--name`** (aceito a proposta do construtor).
- **Só Windows, um PC controlado, aba "PC" só no celular autorizado** (aceito).
- **Trocar de celular à distância entra nesta etapa** (ver Comportamento): entrar no
  sync com o código de recuperação, autorizar à distância com a senha do Sagyou + código
  do autenticador ou reserva, revogando sozinho os celulares autorizados antes, e a chave
  do ESP32 guardada no Worker cifrada com a chave de sync para ligar com o PC desligado.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

1. **A lista do "PC pronto" é por nome do servidor**, não por pasta. O Windows não expõe
   com facilidade a pasta de trabalho de outro processo, mas a linha de comando sim, e
   cada servidor já sobe com `--name "<projeto>"`. A lista em Configurações sugere os
   nomes dos projetos que têm pasta de código; o Sagyou procura um processo
   `claude … remote-control … --name "<nome>"` (via `Get-CimInstance Win32_Process`, a
   cada 30 s, só no PC controlado).
2. **Chave de assinatura própria do celular.** O celular gera um par Ed25519
   (`@noble/curves`, já compatível com Hermes) e guarda a chave privada no
   `expo-secure-store` com `requireAuthentication: true`: ler a chave pede a biometria
   (ou o bloqueio de tela do Android, como o `LockGate`). Cada pedido de controle é
   assinado por ela. A chave de sync sozinha não basta para nada desta spec.
3. **O PC também tem um par Ed25519** (cifrado com `safeStorage`), e assina o que manda
   ao celular (estado e cartões). O celular só aceita mensagens assinadas pelo PC que o
   autorizou. Isso impede que outro aparelho com a chave de sync mostre um cartão falso.
4. **Tudo que tem conteúdo vai cifrado** com uma subchave HKDF nova da chave de sync
   (`sagyou-control|1`), XChaCha20-Poly1305, como os lotes. O Worker vê só ids opacos,
   tamanhos, horários e o tipo do comando de energia (ver item 6).
5. **Papéis no Worker.** Um aparelho vira "PC controlado" e outro vira "controle" por uma
   tabela de papéis no D1. Marcar papéis exige a prova da chave **e** o código do
   autenticador (TOTP), como revogar apagando dados. Só aparelhos com papel "controle"
   podem pedir ligar/desligar ao ESP32; só o "PC controlado" pode enviar sinal de vida.
6. **O comando de energia é assinado com uma chave do ESP32** (proposto depois de Luis
   perguntar, em 2026-11-03, se valia proteger o comando). O PC gera a "chave do ESP32"
   (32 bytes aleatórios) junto com o token; os dois aparecem uma vez para colar no
   `secrets.h`. O PC manda a chave, cifrada pela caixa de controle, a cada celular
   autorizado, que a guarda no secure store. Cada comando vai como
   `{ cmd, contador, emitidoEm, expiraEm }` + HMAC-SHA256 com essa chave. O ESP32 só
   executa se o HMAC confere, o horário (NTP) está dentro do prazo e o contador é maior
   que o último executado (guardado na flash): nem o Worker nem quem dominar a conta
   Cloudflare consegue forjar ou repetir um comando. O ESP32 assina do mesmo jeito o
   estado que informa (`pcPing`), então o app não mostra "Desligado" forjado. O comando
   não é cifrado: o Worker vê se foi `wake`, `shutdown` ou `abort-shutdown`, o que não
   revela dados. Gerar uma chave nova no PC invalida a antiga (reflash do `secrets.h`).
   Revogar um celular não troca a chave sozinho; a tela sugere "Gerar nova chave do
   ESP32" ao revogar.
7. **Frequências** (plano gratuito: 100 mil requisições/dia): sinal de vida do PC a cada
   30 s; o PC busca a caixa de comandos a cada 5 s; o ESP32 consulta a cada 10 s; o app
   consulta a cada 5 s só com a tela "PC" aberta. Soma ~30 mil/dia, além do sync.
8. **Nova aba "PC" no celular**, só visível num celular autorizado.
9. **Uma seção nova "Controle remoto"** em Configurações do desktop (a oitava).
10. **Bloqueio remoto usa o mesmo caminho do "Bloquear agora" da bandeja**
    (`createAppLock.lock('remote')`), com o flush do renderer.
11. **Um cartão do Fleet vale nos dois lugares**: a primeira resposta (PC ou celular)
    vence e o outro lado fecha o cartão. Com o Sagyou bloqueado o Fleet continua sem
    cartões (regra de hoje), então não há o que aprovar até desbloquear.

## Comportamento

### Autorizar o celular

1. No celular: Ajustes → "Controlar o PC" → **Pedir autorização**. Gera o par Ed25519
   (pede a biometria), envia ao PC pelo Worker a chave pública e o nome do aparelho, e
   mostra um código de conferência de 6 dígitos (derivado das duas chaves públicas).
2. No PC: Configurações → Controle remoto. Para isso aparecer, este PC precisa estar
   ligado como **PC controlado** ("Controlar este PC pelo celular", só Windows, com
   sync ativo e senha do Sagyou configurada; pede o código do autenticador).
3. O pedido aparece como "Pixel 8 quer controlar este PC — código 482 913". Botões
   **Autorizar** (confirma com a senha do Sagyou) e **Recusar**. O mesmo código de 6
   dígitos aparece no celular, para comparar.
4. Autorizado: o PC registra o papel "controle" no Worker e manda ao celular a própria
   chave pública. O celular mostra a aba "PC".
5. O PC lista os celulares autorizados com **Revogar**. Revogar o aparelho no sync
   também tira a autorização. Trocar ou formatar o celular exige autorizar de novo.
6. Pedido de autorização vale 10 min; depois some.

**Chave do PC antes de autorizar (adendo).** Ao receber o pedido de autorização, o PC
responde ao celular com a própria chave pública (mensagem `pc-key`, assinada por ela). O
celular só a aceita vinda do aparelho que o Worker marca como PC controlado
(`GET /roles/pc`), calcula o código de 6 dígitos com ela e, depois do `authorized`, só
aceita mensagens assinadas por essa mesma chave (o `authorized` precisa trazer a mesma
chave). Quem trocasse a chave no caminho mudaria o código, e Luis recusaria. No pedido à
distância não há código: a chave vem no `authorized`, e as mensagens já vão cifradas com a
chave de sync, que o Worker não tem.

### Trocar de celular à distância

Para quando o celular autorizado foi perdido, roubado ou trocado e Luis está longe do
PC. Requisito, dito na tela e no guia: guardar **fora do celular** o código de
recuperação, a senha de configuração do Worker e os códigos reserva do autenticador
(o Google Authenticator perdido junto com o celular só volta se tinha backup na conta
Google).

1. **Entrar no sync com o código de recuperação.** Na tela de pareamento do celular, além
   de "Escanear QR" e "Colar código", entra **"Entrar com código de recuperação"**:
   código de recuperação (texto colado; o endereço do Worker vem nele), senha de
   configuração do Worker e código do autenticador ou reserva. Usa o
   `engine.recover(...)` que o core já tem; o fator é conferido pelo Worker. Mesmas
   mensagens de erro do desktop (recuperação inválida, fator errado, bloqueio de 15 min).
2. **Pedir controle à distância.** Em Ajustes → Controlar o PC, ao lado de "Pedir
   autorização", **"Estou longe do PC"**: digita a senha do Sagyou e um código do
   autenticador ou reserva, e confirma com a biometria (que cria o par Ed25519).
   - O **Worker** confere o código do autenticador (`checkFactor`, prova da chave) e só
     então marca o aparelho como "controle" e guarda o pedido para o PC.
   - O **PC** confere a senha pelo scrypt (pedido cifrado, assinado pela chave nova, uso
     único, vale 10 min) e autoriza sem ninguém clicar.
   - Erro de senha conta para o mesmo limite de 5 erros / 15 min do desbloqueio remoto;
     erro de código conta no limite do autenticador do Worker.
3. **Revoga sozinho os celulares autorizados antes**, no PC e no Worker (papel
   "controle" removido). O celular novo mostra: "Celulares anteriores perderam o
   controle do PC. Revogue também o aparelho perdido na sincronização, apagando os dados
   dele." com atalho para a lista de aparelhos (revogar com apagar dados pede o código do
   autenticador).
4. **Ligar com o PC desligado.** O PC guarda no Worker a chave do ESP32 cifrada com a
   subchave de controle (`esp32_key_cipher`, só ciphertext). Assim que o Worker marca o
   celular novo como "controle" (passo 2), ele já pode buscar a chave, decifrar com a
   chave de sync e **ligar o PC**. Desbloquear, desligar pelo Sagyou e aprovar cartões
   esperam o PC ligado concluir a autorização (o app mostra "Aguardando o PC concluir a
   autorização").

Consequência aceita: quem tiver o código de recuperação, a senha do Worker e um código do
autenticador consegue ligar o PC; para desbloquear o Sagyou ainda precisa da senha dele.

### Estado do PC (tela "PC")

| Estado | Quando |
|---|---|
| **Pronto** | Sinal de vida há < 2 min e todos os servidores da lista rodando |
| **Remote Control fora do ar** | Sinal de vida ok, faltam servidores. Texto: "PC ligado, Remote Control fora do ar: <nomes>." |
| **Ligado, aguardando o Sagyou** | O ESP32 responde ao ping do PC e não há sinal de vida há ≥ 2 min |
| **Ligando** | "Ligar" enviado há < 5 min, sem ping nem sinal de vida |
| **Desligando** | O Sagyou agendou o desligamento; mostra a contagem |
| **Desligado** | Sem ping e sem sinal de vida |
| **ESP32 sem contato** | O ESP32 não consulta o Worker há ≥ 2 min (aparece junto do estado) |

O sinal de vida também diz se o Sagyou está bloqueado ("Sagyou bloqueado" / "Sagyou
desbloqueado") e quantos cartões esperam resposta.

### Ligar

- Botão **Ligar** (só em Desligado). Pede a biometria, assina e envia `wake` ao Worker,
  que guarda o comando por **2 minutos**. O ESP32 busca, envia o pacote mágico e informa
  o resultado do ping. Comando não buscado em 2 min expira: "O ESP32 não respondeu."
- Primeiro sinal de vida "pronto" depois de um `wake`: push **"PC pronto."**

### Desligar

- Com sinal de vida: **Desligar** → biometria → pedido assinado ao PC. O Sagyou salva o
  renderer (mesmo flush do `update:install`), para os cronômetros das runs (como no
  `before-quit`) e roda `shutdown /s /t 60 /c "Sagyou: desligando pelo celular"`. A tela
  mostra "Desligando em 0:58" e **Cancelar** (`shutdown /a`). Se o flush falhar, não
  desliga: "Não foi possível salvar o Sagyou; o PC não foi desligado."
- Sem sinal de vida há ≥ 2 min mas com ping: **Forçar pelo ESP32** com confirmação
  "O Sagyou não está respondendo. Forçar o desligamento pelo ESP32? O que não foi salvo
  no Sagyou pode se perder." → comando `shutdown` ao ESP32 (60 s, cancelável com
  `abort-shutdown`).

### Desbloquear e bloquear o Sagyou

- **Desbloquear** (Sagyou bloqueado) → biometria → pedido `{tipo, nonce, emitidoEm,
  expiraEm = +60 s}` assinado e cifrado. O PC confere: assinatura de um controle
  autorizado, dentro do prazo, nonce nunca visto. Aceito: mesmo efeito de digitar a
  senha certa (`passwordUnlocked = true`, renderer carrega se ainda não carregou).
- Pedido recusado (assinatura, prazo, nonce repetido, controle desconhecido) conta como
  erro; **5 erros seguidos suspendem desbloqueio e desligar remotos por 15 min**. O app
  mostra "O PC recusou o pedido." / "Desbloqueio remoto suspenso até 14:32."
- **Bloquear agora** → mesmo caminho do "Bloquear agora" da bandeja.
- Sem senha configurada no Sagyou não há desbloquear nem bloquear (o PC controlado
  exige senha, então isso só acontece se a senha for removida depois: o PC sai do modo
  controlado).
- Log `remote`/`unlock` e `remote`/`lock` com resultado e motivo, nunca o pedido.

### Aprovar pelo celular

- Quando o Fleet estaciona um cartão (`requestMcpWriteApproval`), o PC também o manda,
  assinado e cifrado, a cada controle autorizado, com `id`, nome da sessão, ferramenta,
  `resumo` e `expiresAt` (os mesmos 5 min). O Worker manda o push **"Aprovação
  pendente no Sagyou."**
- No celular, o cartão aparece na aba "PC" com contagem regressiva, **Aprovar** e
  **Recusar** (biometria em ambos). A resposta volta assinada; o PC só aceita para um
  `id` ainda pendente. Primeira resposta vence; a outra tela fecha o cartão.
- Cartão expirado ou já respondido: "Este cartão já foi respondido ou expirou."
- O auto da run continua não respondendo cartões arriscados.

### Atualizar o Sagyou pelo celular (adendo)

- Uma atualização encontrada segura a sincronização até ser instalada (regra da etapa 4).
  Longe de casa isso parava o celular e o PC de trocarem dados. O controle remoto **não**
  fica segurado: o sinal de vida informa a versão pendente (`updateVersion`).
- Com uma versão pronta para instalar, a aba "PC" mostra "Atualização <versão> pronta" e
  **Instalar atualização** (biometria; pedido assinado `install-update`, conta no limite
  de 5 recusas como desligar). O PC faz o mesmo caminho do `update:install`: para os
  cronômetros das runs, salva o renderer e reinicia na versão nova. Falhou ao salvar ou ao
  instalar: nada muda e o celular mostra "Não foi possível instalar a atualização; o
  Sagyou continua na versão atual."
- Depois de reiniciar, o Sagyou abre bloqueado (se tem senha) e manda o sinal de vida de
  novo; o celular desbloqueia como sempre.

### Push

- `expo-notifications` + FCM. O celular autorizado registra o token FCM no Worker.
- O Worker só manda textos de uma lista fixa ("PC pronto.", "Aprovação pendente no
  Sagyou.", "O PC não foi desligado."), escolhidos por um código, nunca texto vindo do
  PC. Tocar abre a aba "PC".
- Sem Firebase configurado (secret ausente no Worker), tudo funciona sem push.

### Offline e bordas

- Celular sem rede: botões desligados, "Sem conexão com o servidor."
- Celular em modo só leitura (`readOnly`) ou com o app bloqueado: aba "PC" não aparece /
  nada é enviado (`useLockState.hidden`).
- PC sem sync ativo ou com sync pausado: o modo controlado desliga e avisa.
- Wipe remoto do PC ou do celular apaga as chaves e autorizações desta spec.

## Dados

Sem mudança no SQLite nem no formato do backup. Nada desta spec sincroniza.

- **Desktop, `userData/remote-control.json`** (`remote-control-dev.json` em dev; modo
  0600, `.tmp` + rename): ligado/desligado, par Ed25519 do PC (privada cifrada com
  `safeStorage`), controles autorizados (id opaco, nome, chave pública, data), lista de
  servidores de Remote Control, contador de erros e fim da suspensão. Fora do SQLite, de
  todo backup e do sync; apagado pelo wipe remoto (entra na lista de `wipe.ts`).
- **Celular, secure store**: chave privada do controle (`requireAuthentication`) e chave
  pública do PC autorizado. Nunca em SQLite, prefs, Zustand ou log (o teste que varre as
  tabelas passa a cobrir isso). Apagadas no wipe/"Desconectar".
- **D1 (Worker), tabelas novas, todas `CREATE TABLE IF NOT EXISTS`** (schema aditivo,
  basta rodar o `schema.sql` de novo): `device_roles` (id opaco, papel `pc`|`controller`),
  `power_tokens` (hash do token do ESP32), `power_commands` (comando, criado, expira,
  buscado), `power_state` (último ping e última consulta do ESP32), `control_messages`
  (caixa cifrada por destinatário, apagada ao ser buscada ou ao expirar),
  `control_status` (último sinal de vida cifrado do PC), `push_tokens` (token FCM por
  aparelho), `esp32_key_cipher` (a chave do ESP32 cifrada pelo PC; o Worker não lê). Secret novo opcional `FCM_SERVICE_ACCOUNT`.
- **Token e chave do ESP32**: gerados juntos no PC (Configurações → Controle remoto →
  "Gerar token do ESP32"), mostrados uma vez para colar no `secrets.h`. O Worker guarda
  só o hash do token e nunca vê a chave. O PC guarda a chave cifrada com `safeStorage`
  em `remote-control.json` (para reenviar a um celular autorizado depois); o celular, no
  secure store. O token só acessa `/power/next` e `/power/state`.

### Rotas novas do Worker (contrato do firmware incluído)

| Rota | Quem | O quê |
|---|---|---|
| `POST /roles` | PC | marca papéis (prova da chave + TOTP) |
| `POST /roles/remote` | celular novo | vira "controle" à distância e revoga os anteriores (prova da chave + TOTP/reserva) |
| `PUT /esp32-key`, `GET /esp32-key` | PC / controle | chave do ESP32 cifrada pelo PC |
| `POST /control/send`, `GET /control/inbox` | PC, controle | caixa cifrada, uso único |
| `PUT /control/status`, `GET /control/status` | PC / controle | último sinal de vida |
| `POST /power/command` | controle | `wake` \| `shutdown` \| `abort-shutdown` + contador, prazos e HMAC; vale 2 min |
| `GET /power/next` | ESP32 | próximo comando não expirado, repassado como veio (marca como buscado) |
| `POST /power/state` | ESP32 | `{ pcPing, emitidoEm }` + HMAC, repassado ao app como veio |
| `GET /power/state` | controle | ping, última consulta do ESP32, último comando |
| `PUT /push/token` | controle | registra o token FCM |
| `POST /power-token` | PC | gera o token do ESP32 (prova + TOTP) |

Rotas que carregam dados (`/control/*`) seguem o "hold" da atualização do desktop;
`/power/*` não.

## Telas

Seguem `UI_DESIGN.md` (desktop) e o design system do celular (`theme.ts`, `ui.tsx`), sem
cores com opacidade e sem brilho.

- **Desktop, Configurações → Controle remoto**: interruptor "Controlar este PC pelo
  celular" (com explicação e requisitos), pedidos pendentes com código de 6 dígitos,
  celulares autorizados com Revogar, "Servidores de Remote Control" (lista com sugestões
  dos projetos e estado "rodando"/"parado" de cada), "Token do ESP32" (Gerar / Gerar
  novo, mostrado uma vez). Artigo novo no Como funciona e atalho para ele.
- **Celular, Ajustes → Controlar o PC**: pedir autorização, código de conferência,
  estado "Aguardando o PC"; **Estou longe do PC** (senha do Sagyou + código); depois,
  "Autorizado" e **Remover este celular**.
- **Celular, pareamento**: opção nova **Entrar com código de recuperação**.
- **Guia (desktop e celular, `packages/core/src/sync/guide.ts` e `sync-content.ts`)**:
  artigo "Trocar de celular longe de casa" e, na tabela "Perdeu… → Usa…", a linha do
  celular autorizado. O guia diz o que guardar fora do celular.
- **Celular, aba "PC"**: cabeçalho com o estado (ícone + texto), lista de servidores que
  faltam, linha do ESP32, botões grandes Ligar / Desligar / Cancelar / Desbloquear /
  Bloquear agora conforme o estado, e a lista de cartões pendentes. Acessível (rótulos,
  48 dp, TalkBack lê o estado).

## Versões

Desktop MINOR, celular MINOR (`app.json` + `versionCode`), Worker reimplantado com o
`schema.sql` novo (README e guia atualizados). O APK precisa do `google-services.json`
(secret novo no `mobile-apk.yml`).

## Perguntas em aberto

(nenhuma)
