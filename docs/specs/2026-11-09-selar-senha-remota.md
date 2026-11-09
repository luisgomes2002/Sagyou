# Selar a senha do "Estou longe do PC" para a chave do PC

Status: approved by Luis on 2026-11-09
Branch: feature/selar-senha-remota

Origem: dívida registrada em `docs/seguranca/2026-11-04-ameacas-acesso-remoto.md` (seção 7)
e em "Fora do escopo" de `docs/specs/2026-11-07-endurecer-acesso-remoto.md`. Tarefa no
Sagyou: "Selar a senha do "Estou longe do PC" para a chave do PC" (sprint "Acesso remoto 3").

## Por quê

No "Estou longe do PC" (`authorize-remote`), o celular manda a **senha do Sagyou** dentro de
uma mensagem cifrada só com a subchave de controle, derivada da **chave de sync**. Todo
aparelho pareado tem essa chave: o PC do trabalho, um aparelho já revogado (se guardou a
chave) ou quem copiou um código de pareamento. Somado à leitura das mensagens no Worker,
qualquer um deles lê a senha em claro, por até 1 h (o tempo que o pedido fica no Worker).

A senha precisa ir selada para algo que **só o PC de casa** consegue abrir: a chave dele.
O obstáculo é que um celular novo, pedindo de longe, ainda não conhece essa chave.

## Objetivos

- A senha do `authorize-remote` vai **selada para a chave do PC**. Quem tem só a chave de
  sync (e o que está no Worker) não consegue mais lê-la.
- O celular novo obtém a chave do PC **pelo Worker**. A chave fica lá registrada pelo
  aparelho que tem o papel de PC, e esse papel só se ganha com o autenticador.
- O PC atualizado **recusa** uma senha que não venha selada.

## Fora do escopo

- Conferir a chave do PC no papel (impressão digital): decidido que não (Luis, 2026-11-09).
- Proteger contra quem controla a conta Cloudflare (pode trocar a chave no D1) ou quem tem
  a chave de sync **e** o autenticador (pode virar "o PC"). Isso continua sendo risco
  registrado no documento de segurança.
- Trocar a forma de pareamento em casa (código de 6 dígitos): não muda.
- Rotação periódica da chave do PC.

## Decisões (de Luis, 2026-11-09)

1. **Origem da chave para um celular novo: o Worker.** O PC publica a chave pública dele, e
   o Worker só aceita essa publicação do aparelho que tem o papel `pc`. Ganhar o papel
   `pc` já exige prova da chave + autenticador (`POST /roles/pc`).
2. **Sem compatibilidade:** o PC atualizado recusa a senha sem selo. Desktop, celular e
   Worker saem juntos.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

1. **Selo:** o PC já tem um par Ed25519 (`pcKeys` em `remote-control.json`). Para cifrar,
   a chave é convertida para X25519 (`edwardsToMontgomeryPub` /
   `edwardsToMontgomeryPriv` do `@noble/curves`, que o core já usa), sem criar uma segunda
   chave nem mudar o arquivo. O celular gera um par X25519 efêmero por pedido; o segredo
   ECDH passa por HKDF-SHA256 (info `sagyou-remote-password-v1`) e cifra a senha com
   XChaCha20-Poly1305. O AAD amarra o selo ao pedido:
   `sagyou-remote-password|1|<chave pública Ed25519 do celular>|<chave pública do PC>`.
   Um selo copiado para outro pedido (outra chave de celular) não abre. Fica em
   `packages/core/src/control/crypto.ts` (`sealToPc`/`openFromPc`), com vetores fixos no
   teste.
2. **Corpo do `authorize-remote`:** `password` sai, entra `sealedPassword` (base64 de
   `chave efêmera || nonce || cifra`). Um corpo com `password` é recusado com o motivo
   novo `outdated`, sem testar a senha e **sem contar** para a suspensão (não prova nada
   sobre quem mandou).
3. **Worker:** `GET /roles/pc` passa a responder `{ pc, publicKey }` (`publicKey` null se
   o PC ainda não publicou). Rota nova `PUT /roles/pc/key { publicKey }`: só o aparelho que
   é o `pc` atual (403 para qualquer outro), 32 bytes em base64. `setPc` (outro aparelho
   vira o PC) apaga a chave antiga. Um D1 sem a coluna nova responde
   `501 {error:'control not deployed'}` nessa rota, como as outras de controle.
4. **Quando o PC publica:** a cada heartbeat (30 s) do controle remoto, se ele é o `pc`
   no Worker e a chave lá for diferente da
   dele. Falha de rede tenta de novo no ciclo seguinte. Não pede autenticador.
5. **No celular:** antes de mandar, ele lê `GET /roles/pc`. Se já conhece uma chave do PC
   (de um pareamento anterior, guardada em `sagyou.control.pcpub`) e a do Worker for
   diferente, **usa a que já conhece** e não manda nada se elas não baterem (mostra o texto
   "chave mudou" abaixo). A chave do Worker só é usada por quem não conhece nenhuma.
6. **Resposta `authorized`:** num pedido de longe, o celular só aceita o `authorized`
   assinado pela **mesma chave** para a qual selou a senha. Hoje ele aceita qualquer chave
   nessa fase.

## Comportamento

**Celular, "Estou longe do PC" → Enviar:**
1. Busca a chave do PC no Worker (decisão 5).
2. Se não há chave, nada é enviado e aparece: **"O PC ainda não publicou a chave dele.
   Atualize o Sagyou no PC e tente de novo."**
3. Se a chave do Worker não bate com a que este celular já conhecia, nada é enviado e
   aparece: **"A chave do PC mudou. Autorize este celular em casa, comparando o código."**
4. Senão, sela a senha, assina e manda, como hoje (autenticador, `/roles/remote`, 1 h).

**PC, ao ler um `authorize-remote`:**
- `sealedPassword` válido → abre com a chave privada e confere a senha. O resto é como
  hoje: senha errada conta e remove o papel, certa autoriza.
- Selo que não abre (cifra adulterada, outra chave, AAD diferente) → `shape`. Trata como
  hoje um corpo malformado: não conta para a suspensão.
- Corpo antigo com `password` → `outdated`, não conta. O celular atualizado mostra
  **"Atualize o Sagyou no celular."** (o antigo mostra a mensagem genérica dele).
- A senha aberta nunca vai para log, estado ou arquivo, igual a hoje.

**Bordas:**
- PC trocado (outro aparelho virou o PC com o autenticador): a chave antiga sai do Worker.
  Um celular que conhecia o PC antigo vê "A chave do PC mudou…".
- Worker antigo (sem a coluna): o PC loga `remote`/`pc_key_publish_failed` e segue. O
  celular vê "O PC ainda não publicou a chave…".
- Celular sem rede: o erro de conexão de hoje.

## Dados

- **D1 (Worker):** coluna nova `public_key TEXT` (nullable) na linha `pc` de `device_roles`,
  ou tabela `pc_key (id INTEGER PRIMARY KEY CHECK (id = 1), device_id, public_key,
  updated_at)`. A escolha fica para o plano, via `sagyou-migration`. Migração aditiva em
  `schema.sql` mais um comando `wrangler d1 execute` no README, igual às anteriores.
- **Desktop:** sem mudança de dados. `remote-control.json` mantém `pcKeys` como está.
- **Celular:** chave nova `sagyou.control.pcpin` no secure store (decisão do construtor, da
  revisão de segurança): a chave do PC em que o celular confia, gravada quando o PC o
  autoriza. Sobrevive a recusa, "Cancelar" e "Remover este celular"; só o wipe ou
  "Desconectar" a apagam, e só comparar o código em casa a troca. `sagyou.control.pcpub`
  passa também a ser gravada a partir do Worker no pedido de longe.
- Backup e sync: não mudam.

## Telas

- Celular, `ControlSetupScreen`: só os três textos novos acima, no mesmo lugar de erro de
  hoje. Os textos ficam em `apps/mobile/src/remote/texts.ts` (`REMOTE_TEXT`, só o celular os mostra).
- Desktop: nenhuma tela muda.
- Guia (Como funciona) e `docs/seguranca`: o artigo do controle remoto diz que a senha vai
  selada para o PC, e a dívida sai da seção 7 e vira "resolvido em 2026-11-09".

## Perguntas em aberto

(nenhuma)
