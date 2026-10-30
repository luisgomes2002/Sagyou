# Sync, etapa 2: dois PCs sincronizando pela Cloudflare

Status: approved by Luis on 2026-10-30
Branch: feature/sync-cloudflare

Segunda etapa do roteiro `docs/specs/2026-10-30-sync-mobile-roteiro.md`. Parte da etapa 1
(`docs/specs/2026-10-30-sync-registro-mudancas.md`, PR #29), que já grava em
`sync_records` uma versão (HLC, aparelho, hash) por registro sincronizável. Esta etapa
leva essas versões, cifradas, até um Worker na Cloudflare e aplica as que chegam de
outro aparelho.

## Por quê

Luis usa o PC Windows de casa e o PC Linux do trabalho. Hoje uma tarefa criada num não
existe no outro. Quer os mesmos dados nos dois, cada um funcionando offline, sem que a
Cloudflare ou qualquer outra pessoa consiga ler nada. É também a base do app Android
(etapa 3).

## Objetivos

- Dois PCs pareados ficam com os mesmos dados sincronizáveis em até ~1 minuto, com rede.
- Sem rede, cada PC continua funcionando, e as mudanças vão quando a rede volta.
- O servidor só vê sequência, tamanho, horário e um id opaco de aparelho.
- Editar o mesmo registro nos dois PCs nunca perde uma versão em silêncio.
- Dá para revogar um aparelho perdido e mandar apagar os dados dele.

## Fora do escopo

- App Android, `packages/core` e a reorganização do repositório (etapa 3).
- **Bytes de anexos e de imagens de tarefa.** Só a ficha (`file`, metadados de imagem)
  sincroniza. Os bytes ficam para uma etapa futura, possivelmente com R2.
- Rodar com o Sagyou bloqueado ou na bandeja (etapa 4).
- Vários usuários, compartilhamento, site.
- O que é do aparelho (regra do roteiro): caminhos de código e a seleção deles, timers
  rodando, tema e acessibilidade, perfil financeiro ativo, configuração dos agentes,
  senha do app, logs, runs do Fleet, skills e índices de busca.

## Decisões (de Luis, 2026-10-30)

- **Conflito:** por registro, a edição mais recente (maior HLC) vence, e a versão
  perdedora fica guardada por 30 dias, visível e restaurável. **Exceção: dívida
  (`financial_debt`).** Se a mesma dívida mudou nos dois aparelhos desde a última versão
  que ambos viram, nada é decidido sozinho. A dívida mantém o valor local e fica marcada
  "conflito: escolha a versão" até Luis escolher.
- **Restaurar um backup com o sync ligado** pergunta: "Restaurar também nos outros
  aparelhos?".
  - **Sim:** o estado restaurado vai para todos como edições novas deste aparelho.
  - **Não:** o sync deste aparelho é pausado até Luis escolher, na tela Sincronização,
    entre "este aparelho manda" (sobe o estado local) e "a nuvem manda" (descarta o
    local e baixa tudo).
- **Anexos:** só a ficha sincroniza. No outro aparelho, o arquivo aparece com "Disponível
  só em <nome do aparelho>" e não abre.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Cifra: XChaCha20-Poly1305** com `@noble/ciphers` (JS puro, auditado), nonce
  aleatório de 24 bytes por lote. O mesmo código roda no Electron e, na etapa 3, no Expo,
  sem módulo nativo. AES-GCM foi descartado: o nonce de 12 bytes exige contador por
  aparelho para ser seguro, e o React Native não tem AES-GCM nativo.
- **Chaves:** uma chave de sync aleatória de 256 bits, criada no primeiro aparelho e
  nunca derivada da senha do app. HKDF-SHA256 deriva dela duas subchaves: `enc`, que
  cifra os lotes, e `id`, que gera o id opaco do aparelho
  (`HMAC(id, deviceId)`, 128 bits). O servidor nunca vê o `deviceId` da etapa 1.
- **Lote:**
  - **Conteúdo:** JSON `{v: 1, records: [{kind, id, hlc, deleted, payload}]}`. O
    `payload` é o mesmo da etapa 1 e fica ausente quando `deleted`.
  - **Compressão e cifra:** comprimido com gzip e depois cifrado.
  - **Dados associados:** `v`, o id opaco do remetente e um uuid do lote.
  - **Tamanho:** no máximo 256 KB antes da cifra e no máximo 500 registros. O restante
    vai em lotes seguintes.
- **Servidor (`sync-server/`):** Worker + D1. Tabelas:
  - `devices`: id opaco, hash SHA-256 do token, nome cifrado, `last_seen`, `revoked_at`
    e `wipe`.
  - `changes`: `seq` autoincremento, aparelho, `ciphertext`, tamanho, `created_at`.
  - `invites`: hash, validade de 10 min, uso único.
  - `snapshots`: `seq_until`, `ciphertext`, `created_at`.

  Rotas:

  | Rota | Para quê |
  |---|---|
  | `POST /push` | enviar lotes |
  | `GET /pull?since=N&limit=` | receber lotes |
  | `POST /pair` | trocar um convite por um token |
  | `POST /invites` | criar um convite |
  | `GET /devices` | listar os aparelhos |
  | `POST /devices/:id/revoke` | revogar um aparelho, com ou sem apagar os dados dele |
  | `POST /snapshot` e `GET /snapshot` | etapa 2.7 |

  Todo pedido leva `Authorization: Bearer <token do aparelho>`. Um token revogado
  recebe 401, e o corpo diz se é para apagar os dados.
- **Primeiro aparelho:** o Worker é publicado com `wrangler deploy` e um segredo
  `SETUP_TOKEN` (no painel da Cloudflare). O primeiro aparelho usa esse segredo uma vez
  para se registrar. O mesmo segredo serve para registrar um aparelho novo pelo código de
  recuperação quando nenhum outro existe mais.
- **Guarda local:** a chave de sync e o token do aparelho ficam em
  `userData/sync-config.json`, cifrados com o `safeStorage` do Electron, fora do SQLite e
  do backup. **Se o `safeStorage` não estiver disponível** (Linux sem chaveiro), o sync
  não liga e a tela diz por quê. A chave nunca é gravada em claro.
- **Ritmo:**
  - envio: 5 s depois de um salvamento, ao abrir o app e a cada 60 s;
  - recebimento: ao abrir, a cada 60 s e quando a rede volta;
  - erro de rede: backoff exponencial até 15 min, sem perder a fila.

  São cerca de 3 mil pedidos por dia por aparelho, bem abaixo dos 100 mil grátis.
- **Aplicar o que chega:**
  1. O main aplica o lote no SQLite numa transação e grava em `sync_records` a versão
     recebida (HLC e aparelho de origem).
  2. Avança `lastSnapshot` e envia `sync:remote-changes` ao renderer, que aplica no
     Zustand sem salvar.
  3. Cada aplicação aumenta uma geração. O renderer manda no salvamento a última geração
     que viu.
  4. Para registros mudados remotamente depois dessa geração, o main ignora o valor do
     renderer e mantém o do banco. Isso garante que um salvamento atrasado nunca desfaz
     uma mudança recebida.
  5. Um registro cujo pai ainda não chegou espera em `sync_pending`. Um filho de pai
     apagado vai para os conflitos.
- **Tombstones e limpeza:**
  - Uma linha `deleted = 1` em `sync_records` é apagada depois de 90 dias e depois que
    todo aparelho não revogado puxou além do `seq` dela.
  - No servidor, um aparelho sobe um retrato cifrado completo a cada 5000 mudanças ou 30
    dias. As `changes` com `seq` até o retrato são apagadas quando todos os aparelhos não
    revogados já passaram dele.
  - Um aparelho novo baixa o retrato e depois só as mudanças.
- **Código de recuperação:** a chave de sync em base32, em 13 grupos de 4, mais a URL do
  servidor. É mostrado uma vez no primeiro aparelho, e de novo sob pedido, com a senha do
  app se houver.
- **Memórias sincronizam** (`memory` está em `sync_records`). O handoff de cada terminal
  também. A decadência continua local, porque `accessCount`/`lastAccessedAt` ficam fora
  do hash.

## Comportamento

- **Ligar o sync (primeiro aparelho):**
  1. Configurações → Sincronização → "Ativar". Pede a URL do Worker e o `SETUP_TOKEN`.
  2. Cria a chave, registra o aparelho e mostra o código de recuperação com a caixa
     "Guardei o código" obrigatória.
  3. Sobe o retrato inicial.
- **Parear outro aparelho:**
  1. No aparelho ativo, "Parear novo aparelho" mostra um QR e um texto equivalente com
     URL, chave e convite. O convite vale 10 min e é de uso único.
  2. No aparelho novo, em "Entrar com código", você cola o texto (no PC não há câmera).
  3. Se o aparelho novo já tem dados, a tela pergunta: "Este aparelho já tem dados. Juntar
     com a nuvem ou substituir pelos da nuvem?".
     - **Juntar:** sobe tudo, e os conflitos seguem a regra.
     - **Substituir:** faz um backup local forçado antes.
- **Estado na tela:** "Sincronizado há X min", "N alterações aguardando envio", "Sem
  conexão: as alterações ficam guardadas" ou "Pausado: escolha o que vale".
- **Conflitos:** uma lista na tela Sincronização com o registro, as duas versões, o
  aparelho e a hora de cada uma, e o botão "Usar esta". Os itens somem depois de 30 dias.
  Uma dívida em conflito aparece com o aviso no Financeiro até ser resolvida.
- **Aparelhos:** lista com nome, último contato e "Revogar".
  - A revogação pede confirmação e oferece "Também apagar os dados dele".
  - Na próxima conexão, um aparelho revogado com essa opção apaga o banco, os arquivos e
    os backups locais (`backups/`), **sem fazer backup antes** (decisão de Luis em
    2026-10-30, na aprovação do plano). Os dados continuam na nuvem e nos outros
    aparelhos. O aviso de confirmação diz isso.
- **Restaurar backup com o sync ligado:** a pergunta das Decisões.
- **Erros:** uma falha de rede ou um 5xx do Worker não aparece como erro, só como estado.
  Um 401 mostra "Este aparelho foi desconectado da sincronização". Um lote que não
  decifra é ignorado e registrado no log (`sync`/`decrypt_failed`, sem conteúdo).
- **Logs:** área `sync`, só contagens, tempos, `seq` e resultados. Nunca chave, token,
  payload ou nome de aparelho.

## Dados

Mudança aditiva, sem migração destrutiva.

- **SQLite:**
  - `sync_state`, com o cursor de recebimento, o último `seq` enviado, a geração, a
    pausa e o motivo;
  - `sync_conflicts`, com kind, id, a versão perdedora cifrada em repouso pela chave de
    sync, o aparelho e o HLC de cada lado, o `resolved_at` e o tipo (`lww` ou
    `pending_choice`);
  - `sync_pending`, com os registros esperando o pai.

  Todas ficam fora de `persistAll`/`persistDiff`, como `sync_records`.
- **`userData/sync-config.json`:** URL, chave e token cifrados por `safeStorage`, mais o
  nome do aparelho. Fica fora do backup.
- **Backup:** não muda. Nenhuma tabela `sync_*` nem `sync-config.json` entra.
- **Aplicar no SQLite:** usa as mesmas funções de escrita e normalização de hoje, nunca
  SQL fora do schema. Dinheiro chega e é gravado como string decimal.

## Telas

- **Configurações → Sincronização**, conforme `UI_DESIGN.md`: estado, "Sincronizar
  agora", aparelhos, conflitos, "Parear novo aparelho", "Ver código de recuperação" e
  "Desativar sincronização".
- **Financeiro:** um marcador em dívida com conflito pendente.
- **Arquivos:** um item cujo arquivo não está neste aparelho mostra "Disponível só em
  <aparelho>" e não abre.

## Perguntas em aberto
