# Acesso remoto: parear pelo celular e MCP externo total

Status: approved by Luis on 2026-11-03
Branch: feature/acesso-remoto

## Por quê

Duas coisas travam o Luis quando ele está longe do PC (outra cidade):

1. **Parear um aparelho novo só é possível pelo PC.** O app Android só entra num
   sync existente (`PairScreen`); o botão que gera o código de pareamento existe
   só em Configurações → Sincronização no desktop. Longe de casa não dá para
   ligar um notebook novo ou outro celular.
2. **O token MCP externo vence em 30 dias e tem escopo fechado.** Renovar exige
   estar no PC (Configurações → Acesso MCP externo) e refazer o comando do Claude
   Code. Além disso, ao gerar é preciso escolher um projeto padrão e um perfil
   financeiro, e as escritas arriscadas (excluir, dinheiro…) são recusadas. O
   Luis quer um acesso que dure e libere leitura e escrita de tudo.

O core e o Worker já permitem a parte 1: `engine.createInvite()` está em
`@sagyou/core/sync/engine` e `POST /invites` aceita o token de qualquer aparelho
pareado. Falta a tela no celular.

## Objetivos

1. No celular, Ajustes → **Parear outro aparelho** mostra um código de
   pareamento (QR + texto copiável) que um PC ou outro celular usa para entrar
   no sync, igual ao do desktop.
2. O token MCP externo **não vence**: vale até ser revogado ou trocado no PC.
3. O token libera **leitura e escrita de tudo**: todos os projetos, todos os
   perfis financeiros e todas as ferramentas, inclusive as arriscadas, **sem
   cartão de aprovação**.
4. O token que já existe hoje continua valendo, agora sem prazo e com acesso
   total, sem precisar gerar outro.
5. Uma opção **"Funcionar com o Sagyou bloqueado"**: ligada, o token externo
   continua lendo e escrevendo enquanto a tela do Sagyou está na senha.

## Fora do escopo

- Mudança no Worker (`sync-server/`) ou no formato do código de pareamento.
- Exigir o autenticador (TOTP) para gerar convite.
- Revogar o token MCP externo pelo celular ou por outro aparelho (continua só no
  PC que tem o token).
- Acesso ao broker MCP pela rede: continua só em `127.0.0.1`.
- Vários tokens externos ao mesmo tempo.
- Mudar o comportamento das sessões do Fleet (cartões, perfil capturado,
  cronômetros): só o token externo muda.
- Acordar ou ligar o PC à distância (Wake-on-LAN, ESP32): é configuração da
  máquina, não do app.
- Destravar a senha do Sagyou à distância.

## Decisões (de Luis, 2026-11-03)

- Escritas arriscadas pelo token externo: **liberadas, sem cartão**.
- O token atual vira **permanente e total** na atualização, mesmo se já tiver
  vencido.
- Gerar convite no celular **não** exige o autenticador (igual ao PC hoje).
- Incluir a opção "Funcionar com o Sagyou bloqueado" (aceitando que a proteção
  do token passa a ser a senha do Windows, porque o token fica em texto em
  `~/.claude.json` no mesmo PC).

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Uma spec para as duas partes**, porque têm o mesmo motivo; o plano as separa
  em tasks independentes.
- **QR no celular sem dependência nativa nova:** o pacote `qrcode` (JS puro, já
  usado no desktop) gera a matriz com `QRCode.create`, desenhada com
  `react-native-svg` (já instalado) num componente `QrCode` em
  `apps/mobile/src/components/`. A atualização é só JS, mas vai num APK novo
  como sempre.
- **Proteção do token permanente:** o que segura o token é: só `127.0.0.1`, o
  hash em `mcp-external.json` (0600), o app desbloqueado, o desafio HMAC da ponte
  e o **Revogar** no PC. O apagar à distância (wipe) do PC continua apagando
  `mcp-external.json`, o que dá um corte remoto em caso de perda do PC.
- **Finanças sem perfil fixo:** o escopo do token externo passa a ter
  `financialProfileId: null` = todos os perfis. Só o token externo usa `null`;
  as runs do Fleet continuam presas ao perfil capturado.
- **Escrita bloqueada:** a gravação feita durante o bloqueio passa pelo mesmo
  `store:save` de sempre; o main aceita esse save com o app bloqueado **só**
  enquanto ele mesmo pediu um `apply` do token externo (e só desse renderer),
  nunca um save qualquer. Detalhe no plano.
- **Arquivo novo do token:** `{ hash, createdAt, lastUsedAt }`. Um arquivo antigo
  com `expiresAt`/`projectId`/`financialProfileId`/`mode` é lido normalmente e
  esses campos são **ignorados**; na primeira gravação (último uso) somem.
- **Remover:** `EXTERNAL_TOKEN_TTL_MS`, `EXPIRY_NOTICE_DAYS`, a notificação de
  vencimento, `EXTERNAL_EXPIRED_MESSAGE`, `EXTERNAL_RISKY_MESSAGE`,
  `isExternalRisky`, o modo `read`/`read-write` e o motivo `expired`/`risky`/
  `readonly` do log. `external_refused` fica só com `revoked`.

## Comportamento

### Parte 1 — Parear outro aparelho pelo celular

- Ajustes → seção **Sincronização** ganha a linha **Parear outro aparelho**
  (abaixo de "Como funciona"). Desabilitada quando `readOnly` (sessão perdida,
  401) ou sem sync ativo.
- Tocar abre uma tela (stack raiz `ParearAparelho`) que chama
  `engine.createInvite()` e mostra:
  - o QR do código, grande, centralizado;
  - o texto "Escaneie no outro aparelho, ou cole o código em Configurações →
    Sincronização → Entrar com código.";
  - o botão **Copiar código** (copia o texto `sagyou-sync:1:…`; snackbar
    "Código copiado.");
  - "Vale uma vez só e expira em M:SS" com contagem regressiva a partir do
    `expiresAt` devolvido;
  - expirado: o QR some, aparece "O código expirou." e o botão **Gerar outro**.
- Gerando: `Skeleton` no lugar do QR. Erro de rede: "Não foi possível gerar o
  código. Verifique a conexão." + **Tentar de novo**. Erro do Worker: a mensagem
  do engine (`SyncUserError`), como nas outras telas.
- O código nunca vai para log, SQLite, prefs ou snapshot; sai da memória ao
  fechar a tela. A tela fecha (e o código some) quando `useLockState.hidden`
  fica ativo, como os `BottomSheet`. `FLAG_SECURE` já impede captura de tela.
- O aparelho novo entra pelo caminho que já existe: desktop em "Entrar com
  código", celular na `PairScreen` (QR ou colar). Ele aparece na lista de
  aparelhos de todos, e pode ser revogado de qualquer PC como hoje.

### Parte 2 — Token MCP externo permanente e total

- **Validade:** nenhuma. O token vale até **Revogar** ou **Gerar novo token** no
  PC, ou até um apagar à distância do PC.
- **Ferramentas:** todas as do broker aparecem e funcionam (as mesmas de uma
  sessão do Fleet: `CODE_EXECUTOR_MCP_PERMISSIONS`), incluindo `save_memory`.
  Nenhuma passa por cartão: o token externo nunca pede aprovação. Continuam
  passando pela fila por run (`external`) e pela validação do renderer.
- **Projetos:** leituras sem `projectId` leem todos os projetos (como sessão
  geral); escritas recebem o projeto pelo argumento, como hoje.
- **Finanças:**
  - `read_financial_data`/`ler_financeiro` sem filtro devolvem as tabelas de
    **todos** os perfis, cada uma com `profileId` e o nome do perfil; aceitam um
    `profileId` opcional para filtrar.
  - Escritas que apontam para uma tabela (`tableId`) usam o perfil **da tabela**.
  - Escritas que criam no nível do perfil (`create_financial_table`,
    `add_financial_category`, `remove_financial_category`) aceitam `profileId`
    opcional; sem ele, usam o perfil financeiro ativo no PC.
  - As regras de vínculo continuam: espelho de fatura e transferência entre
    moedas só entre tabelas do **mesmo** perfil.
- **App bloqueado:** depende da opção abaixo.
- **Continua igual:** token desconhecido/revogado → "Sessão MCP inválida ou
  expirada."; cronômetros do token não param sozinhos; sem handoff; Fleet com
  `--disallowedTools mcp__sagyou-externo`.

### Parte 3 — Funcionar com o Sagyou bloqueado

- Interruptor **Funcionar com o Sagyou bloqueado** na seção Acesso MCP
  externo, **desligado por padrão**, com o texto: "Com isto ligado, o Claude
  continua lendo e editando o Sagyou mesmo com a tela na senha. Quem usar sua
  conta do Windows consegue usar o token (ele fica salvo na configuração do
  Claude Code), então a proteção passa a ser a senha do Windows." Só aparece
  quando o app tem senha.
- Desligado: igual a hoje, "O Sagyou está bloqueado. Desbloqueie no PC para
  continuar." para o token externo e para o Fleet.
- Ligado, só para o token externo (o Fleet continua recusando, e o bloqueio
  continua rejeitando a fila das runs do Fleet):
  - **Leituras** funcionam bloqueado, inclusive logo depois de abrir o PC sem
    nunca desbloquear (o main lê do SQLite).
  - **Escritas** funcionam quando os dados já estão carregados no app (ele foi
    desbloqueado ao menos uma vez desde que abriu e depois se bloqueou). São
    gravadas no banco na hora, mesmo com a tela na senha; a tela continua
    sem mostrar nada até a senha.
  - Abriu bloqueado e nunca foi desbloqueado: escrita responde "O Sagyou abriu
    bloqueado: as escritas voltam depois do primeiro desbloqueio no PC. Leituras
    funcionam." (os dados não podem ser carregados sem a senha, e carregar sem
    ela abriria a porta para gravar um estado vazio por cima do banco).
  - Bloquear deixa de rejeitar a fila do token externo.
- O valor fica em `mcp-external.json` (`allowWhileLocked`), fora do backup e do
  sync; revogar o token apaga junto; gerar novo token mantém a escolha.
- Log: `mcp`/`external_locked_call` com `kind` `read`|`write` (sem nome de
  ferramenta nem argumentos), para saber depois que algo rodou bloqueado.

### Tela no PC (Configurações → Acesso MCP externo)

- Sem token: "Nenhum acesso externo.", o aviso "O token dá leitura e escrita de
  tudo no Sagyou, inclusive excluir e mexer em dinheiro, sem pedir aprovação.
  Não vence: vale até você revogar." e o botão **Gerar acesso** (sem formulário).
- Ativo: "Ativo desde <data>", "Último uso: <data>" (ou "Nunca usado"),
  "Acesso total, sem prazo", **Gerar novo token** e **Revogar**.
- Gerar novo token: confirmação "Gerar um token novo? O atual para de valer na
  hora e o comando do Claude Code precisa ser trocado." → mostra token e comando
  uma vez, como hoje.
- Revogar: como hoje.
- O comando pronto para copiar não muda.

## Dados

- Sem mudança no SQLite, no backup ou no sync.
- `userData/mcp-external.json` passa a `{ hash, createdAt, lastUsedAt,
  allowWhileLocked }` (`allowWhileLocked` ausente = `false`);
  arquivos antigos continuam válidos (campos extras ignorados, sem checar
  `expiresAt`). Um build antigo que leia o arquivo novo o trata como ilegível
  (sem token) — só acontece em downgrade, aceitável.
- Mobile: nada persistido pela parte 1.

## Telas

- Celular: linha "Parear outro aparelho" em Ajustes e a tela `ParearAparelho`
  (QR, Copiar código, contagem, Gerar outro), com os componentes do design
  system mobile e alvos de 48 dp; entra na varredura de `a11y.test.tsx`.
- PC: seção Acesso MCP externo simplificada (sem formulário, sem validade),
  com o interruptor "Funcionar com o Sagyou bloqueado".
- Guia "Como funciona": o artigo do MCP externo (`guide/content.ts`) e o de
  pareamento (`guide/sync-content.ts` e `packages/core/src/sync/guide.ts`, se
  citar só o PC) passam a dizer o comportamento novo.

## Perguntas em aberto

(nenhuma)
