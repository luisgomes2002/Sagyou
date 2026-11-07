# Endurecer o acesso remoto

Status: approved by Luis on 2026-11-07
Branch: feature/endurecer-acesso-remoto

Origem: debate de segurança `docs/seguranca/2026-11-04-ameacas-acesso-remoto.md`
(seção 6, itens 1, 2, 3 e 6) e o achado M5 da revisão de segurança do PR #44. Decidido por
Luis em 2026-11-07. Os itens 4, 5, 7 e 8 e o M6 ficam fora desta spec (ver "Fora do
escopo").

## Por quê

Com as etapas 1–6 entregues, a cadeia que mais preocupa é: **celular desbloqueado ou
conta Anthropic invadida → shell no PC → chave de sync + convite → acesso permanente**.
Nenhuma etapa dela pede um segundo fator, e longe de casa (PC no Brasil, Luis no Japão)
não existe jeito de cortar o acesso sem desligar o PC. Ao mesmo tempo, o token MCP
externo apaga dados e mexe em dinheiro sem nenhuma confirmação humana, inclusive com o
Sagyou bloqueado.

Esta spec fecha os buracos mais baratos: um segundo fator para parear, uma confirmação
humana nas escritas arriscadas do token externo, o Sagyou bloqueado voltando a proteger
as escritas, e um botão de emergência no celular.

## Objetivos

- **Item 1:** as escritas arriscadas do token externo voltam a pedir cartão, aprovado
  pelo celular (canal de cartões do #44) ou no PC.
- **Item 2:** com o Sagyou bloqueado, o token externo só lê; para escrever, desbloqueie
  (pelo celular ou no PC).
- **Item 3:** **Cortar acesso** no celular: suspende o token externo, encerra os servidores
  de Remote Control e os impede de voltar, e bloqueia o Sagyou, sem desligar o PC.
  **Restaurar acesso** pelo celular exige biometria e código do autenticador.
- **Item 6:** gerar um convite de pareamento (PC ou celular) exige o código do
  autenticador.
- **M5:** o pedido "Estou longe do PC", que leva a senha do Sagyou, fica no Worker por no
  máximo 1 h (hoje 24 h).

## Fora do escopo

- **Item 4** (isolar os servidores de Remote Control): vira um experimento com ai-jail
  v3.2 no WSL2 (`--allow-host`, `forge setup`, `--forward-port` para o MCP). Só ganha
  spec se o MCP funcionar dentro do jail.
- **Item 5** (GitHub): configuração no GitHub, sem código. Rulesets da `main` e das tags e
  o environment `mobile-release` já foram aplicados em 2026-11-07; a exigência de SHA
  entra depois do merge do PR #47; trocar o token do `gh` por um fine-grained PAT é com
  Luis, no navegador.
- **Item 7:** o PC do trabalho continua pareado com tudo; risco aceito por Luis
  (2026-11-07). Fica registrado no documento de segurança.
- **Item 8** (datas e fuso): spec própria ("Spec B").
- **M6** (chave do ESP32 no celular sem `requireAuthentication`): aceito, registrado no
  documento de segurança.
- Selar a senha do "Estou longe do PC" para a chave pública do PC: muda o protocolo e um
  celular novo ainda não conhece essa chave. Fica como dívida no documento de segurança.
- Encerrar sessões do Fleet ao cortar o acesso: elas só nascem no PC, pela tela.
- Proteger contra quem já tem shell no PC: um shell do usuário lê o SQLite e a chave de
  sync direto. Contra isso valem o segundo fator nas contas, a conta Windows sem admin e
  o "Forçar desligamento pelo ESP32", que roda como SYSTEM.

## Decisões (de Luis, 2026-11-07)

- Itens 1, 2, 3 e 6 e o M5 entram, como recomendado no debate.
- **Restaurar acesso** depois de cortar: pelo celular, com biometria **e** código do
  autenticador (ou código reserva), conferido pelo Worker. Também no PC, desbloqueado.
- **Convite sem autenticador cadastrado fica bloqueado**: sem TOTP no grupo, não se gera
  convite.
- O PC do trabalho continua pareado com tudo (item 7, risco aceito).

## Decisões do construtor (o agente decidiu; o humano pode mudar)

1. **Quais escritas do token externo pedem cartão:** exatamente as de
   `MCP_APPROVAL_REQUIRED` (todo delete, arquivar projeto, toda escrita de dinheiro,
   criar tabela financeira e criar ou renomear perfil financeiro), a mesma lista do Fleet.
   `save_memory` e `criar_task` **não** pedem cartão no token externo: no Fleet eles pedem
   por legado, mas o risco deles é o mesmo de `create_task`/`update_memory`, que não
   pedem.
2. **Onde o cartão do token externo aparece:** no celular autorizado (aba "PC", com push
   "Aprovação pendente no Sagyou.", igual ao Fleet) **e** no PC, num diálogo que abre
   sobre qualquer tela ("O Claude externo quer: <resumo>" com Aprovar/Recusar). O nome da
   "sessão" no cartão é **"Acesso externo"**. A primeira resposta vence. Sem celular
   autorizado, só o PC mostra o cartão.
3. **Prazo do cartão:** os mesmos 5 min (`MCP_APPROVAL_TIMEOUT_MS`). Expirou = recusado. O
   Claude Code espera horas por uma tool, então não há o problema de timeout do Codex.
4. **"Funcionar com o Sagyou bloqueado" continua existindo, mas só para leitura.** O
   interruptor e o seu texto mudam; o portão que deixava passar `store:save` com o Sagyou
   bloqueado (`createLockedSaveGate`, `lockedExternal`) sai do código.
5. **Cortar acesso suspende o token, não o revoga.** Revogar obrigaria a gerar um token
   novo e a trocar a configuração do Claude Code no PC, o que longe de casa é impossível.
   Se o token vazou, "Gerar novo token" no PC continua sendo o caminho.
6. **Enquanto o acesso está cortado, o Sagyou encerra qualquer `claude … remote-control`**
   que aparecer (a varredura de 30 s que já existe), com a árvore de processos
   (`taskkill /PID <pid> /T /F`). Isso cobre a tarefa de logon que reinicia o servidor
   quando ele cai. Encerra todos os servidores de Remote Control, não só os da lista do
   "PC pronto".
7. **Cortar acesso nunca é barrado pela suspensão de 15 min** (5 pedidos recusados):
   senão, quem tem o celular poderia mandar pedidos inválidos para impedir o corte. Ele
   também não conta para o limite. Restaurar conta, como desbloquear.
8. **Restaurar pelo celular** é uma rota nova do Worker que confere o fator
   (`checkFactor`, como `/roles/remote`) e só então entrega ao PC o pedido assinado pelo
   celular. O PC só restaura com a assinatura de um controle autorizado **e** a marca de
   fator conferido pelo Worker. Quem domina a conta Cloudflare forja a marca, mas não a
   assinatura do celular, que exige a biometria.
9. **Prazo do "Estou longe do PC": 1 h.** É tempo para o celular novo ligar o PC pelo
   ESP32 e o PC buscar o pedido. A mensagem já é apagada ao ser buscada (regra do #44). Se
   expirar, o celular diz "O pedido expirou. Ligue o PC e peça de novo."
10. **Convite com fator:** a rota `/invites` passa a exigir o código do autenticador ou um
    código reserva (`requireFactor`), e erra com `totp required` se o grupo não tem
    autenticador. Errar o código conta no limite de 5 erros / 15 min do Worker.

## Comportamento

### 1. Cartão para as escritas arriscadas do token externo

- Uma ferramenta de `MCP_APPROVAL_REQUIRED` chamada pelo token externo entra na fila e
  estaciona um cartão (o mesmo `requestMcpWriteApproval` do Fleet, com o run `external`).
- O cartão vai ao celular autorizado (cifrado e assinado pelo PC, como os do Fleet) e
  abre o diálogo no PC.
- Aprovado: a escrita roda como hoje. Recusado, expirado, ou o acesso cortado/token
  revogado enquanto espera: a escrita não acontece e a ferramenta responde com o mesmo
  texto de recusa do Fleet para aquela ferramenta (ex.: "Exclusão não aprovada pelo
  usuário.", "Lançamento não aprovado pelo usuário.").
- Criar e editar (tarefas, notas, metas, memórias, colunas, projetos) continuam sem
  cartão.
- O interruptor de auto da run não existe para o token externo, então nada aprova um
  cartão sozinho.
- Log `mcp`/`approval` com `runId: external`, ferramenta e resultado, nunca os argumentos.

### 2. Sagyou bloqueado = só leitura no token externo

- Com o Sagyou bloqueado e "Funcionar com o Sagyou bloqueado" ligado, as leituras
  funcionam como hoje e toda escrita (inclusive `save_memory`/`criar_task`) responde:
  "O Sagyou está bloqueado: as escritas voltam depois de desbloquear (no PC ou pelo
  celular, aba PC). Leituras funcionam."
- Com o interruptor desligado, nada muda: bloqueado recusa tudo (`MCP_LOCKED_MESSAGE`).
- Bloquear com escritas na fila do token externo rejeita a fila, como no Fleet.
- Novo texto do interruptor em Configurações → Acesso MCP externo:
  **"Ler com o Sagyou bloqueado"**: "Com o Sagyou bloqueado, o Claude externo continua
  lendo seus dados, mas não escreve. Para escrever, desbloqueie no PC ou pelo celular."

### 3. Cortar acesso e restaurar

**Cortar (celular).** Na aba "PC", botão **Cortar acesso** (vermelho, sempre visível
quando o PC tem sinal de vida). Confirmação: "Cortar o acesso remoto? O Claude externo
para de funcionar, os servidores de Remote Control são encerrados e o Sagyou é
bloqueado. O PC continua ligado." → biometria → pedido `cut-access` assinado (prazo de
60 s, nonce de uso único).

O PC, ao aceitar:
1. Suspende o token externo: toda chamada responde "Acesso externo cortado pelo
   celular." e a fila do token é rejeitada.
2. Encerra todo processo `claude … remote-control` com a árvore, e continua encerrando
   enquanto o acesso estiver cortado.
3. Bloqueia o Sagyou (mesmo caminho do "Bloquear agora").
4. Responde ao celular, e o sinal de vida passa a dizer `accessCut: true`.

O celular mostra **"Acesso cortado em 14:32."** no topo da aba "PC". Se o PC não
responder em 60 s: "O PC não respondeu. Forçar o desligamento pelo ESP32?" (o
"Forçar pelo ESP32" de hoje).

**Restaurar (celular).** Com o acesso cortado, a aba "PC" troca o botão por **Restaurar
acesso** → pede o código do autenticador (ou reserva) → biometria → o Worker confere o
fator e entrega o pedido assinado ao PC. O PC tira a suspensão do token e para de
encerrar os servidores (a tarefa de logon os reinicia sozinha). **O Sagyou continua
bloqueado**; desbloquear é o botão de sempre. Erros: "Código do autenticador inválido."
(conta no limite do Worker) / "Muitas tentativas. Tente de novo às 14:47.".

**No PC.** Configurações → Acesso MCP externo e → Controle remoto mostram "Acesso cortado
pelo celular em <data>." e **Restaurar acesso** (o Sagyou já está desbloqueado, porque
você está na frente dele). A bandeja mostra o mesmo aviso.

**Bordas.**
- Cortar com o acesso já cortado: responde ok e não muda nada.
- O estado de corte sobrevive a reiniciar o Sagyou e o PC.
- Sem token externo, cortar ainda encerra os servidores e bloqueia.
- Sem senha no Sagyou não há modo controlado (regra do #44), então não há cortar.
- Log `remote`/`cut` e `remote`/`restore` com resultado e motivo; `remote`/`rc_killed`
  com a quantidade de processos.

### 6. Convite de pareamento com o autenticador

- **PC (Configurações → Sincronização → Parear aparelho)** e **celular (Ajustes → Parear
  outro aparelho)** pedem o código do autenticador (6 dígitos) ou um código reserva antes
  de gerar o código/QR. Campo: "Código do autenticador"; ajuda: "Ou um código reserva."
- Código errado: "Código do autenticador inválido." Bloqueio: "Muitas tentativas. Tente
  de novo às 14:47."
- Grupo sem autenticador: "Cadastre o autenticador em Configurações → Sincronização para
  parear aparelhos." (no celular, o mesmo texto, que aponta para o PC). O botão de gerar
  fica desligado até o código ser digitado.
- O código digitado não fica em estado depois do pedido (é limpo, como o convite) e nunca
  vai a log.
- Um app antigo, sem o campo, recebe "factor required" do Worker atualizado e mostra o
  erro genérico de convite. Por isso o Worker é reimplantado junto com os dois apps.

### M5. Prazo do "Estou longe do PC"

- `REMOTE_REQUEST_TTL_MS` passa de 24 h para 1 h.
- O celular em "Aguardando o PC concluir a autorização" mostra, depois do prazo, "O pedido
  expirou. Ligue o PC e peça de novo." com **Pedir de novo**.

## Dados

Sem mudança no SQLite nem no backup. Nada desta spec sincroniza.

- **`userData/mcp-external.json`:** campo novo opcional `cutAt` (ISO; ausente = acesso
  normal). Um arquivo sem o campo vale como hoje; um build antigo que leia o arquivo
  ignora o campo (a leitura já tolera campos desconhecidos). `allowWhileLocked` mantém o
  nome e passa a significar só leitura.
- **`userData/remote-control.json`:** sem campo novo (o corte mora no `mcp-external.json`,
  junto do token que ele suspende).
- **D1:** sem tabela nova. Se o pedido de restaurar precisar marcar "fator conferido" na
  `control_messages`, é uma coluna aditiva (`ALTER TABLE … ADD COLUMN` com padrão 0, ou
  um `kind` reservado), decidida no plano, sem mexer nas linhas existentes.
- **Celular:** nada novo persistido. O código do autenticador vive só no estado da tela.

## Telas

Seguem `UI_DESIGN.md` (desktop) e o design system do celular (`theme.ts`, `ui.tsx`).

- **Celular, aba "PC":** botão **Cortar acesso** (variante perigo), faixa "Acesso cortado
  em <hora>." e **Restaurar acesso** (com o campo do código); cartões "Acesso externo"
  junto dos do Fleet.
- **Celular, Parear outro aparelho:** campo do código do autenticador antes do QR.
- **Desktop, diálogo de aprovação do acesso externo** (`ModalBase`): título "Aprovar ação
  do acesso externo", o resumo, contagem regressiva, Aprovar / Recusar.
- **Desktop, Configurações → Acesso MCP externo:** interruptor renomeado ("Ler com o
  Sagyou bloqueado") com o texto novo, aviso de cartão ("Excluir, mexer em dinheiro e em
  tabelas ou perfis financeiros pede aprovação no PC ou no celular."), faixa de acesso
  cortado com **Restaurar acesso**.
- **Desktop, Configurações → Sincronização → Parear aparelho:** campo do código do
  autenticador.
- **Guia** (`guide/content.ts`, `guide/sync-content.ts`, `packages/core/src/sync/guide.ts`):
  artigos do acesso MCP externo (cartões, só leitura bloqueado), do controle remoto
  (Cortar/Restaurar) e do pareamento (pede o autenticador), e a linha "Perdeu o celular" da
  tabela "Perdeu… → Usa…" com "Cortar acesso" pelo segundo aparelho.

## Versões

Desktop MINOR, celular MINOR (`app.json` + `versionCode`), Worker reimplantado (README).
O Worker e os apps sobem juntos, por causa do convite com fator.

## Perguntas em aberto

(nenhuma)
