# Sagyou

**Seu espaço de trabalho pessoal, offline e no seu computador.** Tarefas, hábitos, metas, finanças e notas em um só app, com sessões de agentes de código (Codex, Claude Code, OpenCode) rodando ao lado, em terminais isolados.

![Electron](https://img.shields.io/badge/Electron-47848F?style=flat&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)
![Offline](https://img.shields.io/badge/100%25-Offline-brightgreen?style=flat)

- **Local de verdade.** Tudo fica em um banco SQLite na sua máquina. Sem conta, sem nuvem, sem telemetria.
- **Um app, várias áreas.** Kanban, planejamento, hábitos, metas, finanças, canvas, grafo e arquivos compartilham os mesmos projetos.
- **IA do jeito que você já usa.** Em vez de um chat próprio, o Sagyou abre o CLI que você já tem instalado, numa worktree Git isolada, e dá a ele acesso controlado aos seus dados por MCP.

---

## Instalação

Baixe o instalador da sua plataforma na página de [Releases](https://github.com/luisgomes2002/Sagyou/releases):

| Plataforma | Formato             |
| ---------- | ------------------- |
| Windows    | instalador `.exe`   |
| macOS      | `.dmg`              |
| Linux      | `.AppImage`, `.deb` |

Depois de instalado, o Sagyou procura uma versão nova toda vez que abre, baixa em segundo plano e mostra **"Reiniciar e instalar"** quando ela estiver pronta. Seus dados ficam onde estão. O app procura a maior versão `vX.Y.Z` publicada nos Releases (o selo "Latest" e os releases do celular não interferem). A primeira versão com esse recurso precisa ser instalada à mão. No macOS, enquanto o app não tem assinatura da Apple, ele só avisa e abre a página do Release. Com a sincronização ligada, ela espera a atualização terminar antes de falar com a nuvem.

Não é preciso instalar Python, Node nem nada além do app. Para usar as sessões de código, tenha ao menos um dos CLIs (Codex, Claude Code ou OpenCode) instalado e autenticado.

---

## O que tem dentro

### Organização

| Área             | O que faz                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| **Início**       | Painel com o resumo do dia: tarefas, hábitos, metas e saldo                                                   |
| **Board**        | Kanban por projeto com colunas próprias, sprints, prioridades, tags, imagens e vários cronômetros simultâneos |
| **Próximas**     | Tarefas com prazo, em ordem de vencimento                                                                     |
| **Concluídas**   | Histórico do que já foi entregue                                                                              |
| **Planejamento** | Agenda semanal com blocos de horário ligados a tarefas e hábitos                                              |
| **Canvas**       | Notas adesivas livres, conectáveis e ligadas a tarefas, mais blocos de texto para títulos e anotações         |
| **Grafo**        | Mapa interativo das relações entre projetos, tarefas, notas, metas, hábitos e memórias                        |
| **Arquivos**     | Anexos por projeto, guardados localmente e pesquisáveis pelo conteúdo (PDF, DOCX, planilhas e mais)           |

### Vida pessoal

| Área           | O que faz                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------- |
| **Hábitos**    | Registro diário com histórico e sequência                                                           |
| **Metas**      | Metas de quantidade (progresso acumulado) ou de conclusão única, opcionalmente ligadas a um projeto |
| **Relatórios** | Visão geral da sua produtividade                                                                    |

### Financeiro

- Tabelas de transações em **BRL, USD e JPY**, com valores guardados como decimais exatos (nada de erro de arredondamento).
- **Perfis financeiros** separados (ex.: pessoal e empresa), cada um com suas tabelas e categorias.
- **Detalhamento de lançamentos**: divida uma fatura de cartão em itens com categoria própria, sem contar o valor duas vezes. O que não foi detalhado aparece como "Cartão não detalhado".
- Faturas espelhadas entre tabelas, transferências entre moedas, dívidas com pagamentos parciais, metas financeiras, listas de compras e análises por categoria.
- Comprovantes anexados, histórico de alterações e marcação de conciliação bancária.
- Visão **consolidada** que mantém cada moeda separada e mostra a conversão só como referência.

### Ferramentas

- **Busca global (Ctrl+K)** em tudo: tarefas, notas, metas, transações, arquivos e memórias, com filtros por área e projeto.
- **Exportação para Excel** de projetos, tarefas, hábitos, metas e finanças.
- **Importação via IA**: o botão "Copiar tudo" gera um prompt com schema e tags; cole o JSON que o modelo devolver para criar tarefas.
- **Backup completo** em um único `.json`, com anexos, imagens e memórias. Snapshots automáticos ao abrir e a cada hora (os sete mais recentes ficam guardados).
- **Senha opcional** para bloquear o app (menu **Opções → Segurança**), com bloqueio automático depois de um tempo sem usar o computador (5 min a 1 h) e quando o Windows bloqueia a tela ou suspende.
- **Fica na bandeja**: no Windows, o X esconde a janela e o Sagyou continua rodando (sessões de código, MCP e sincronização); **Sair** no ícone encerra. Opção de **iniciar com o Windows** já escondido na bandeja. Abrir o Sagyou de novo mostra a janela que já está aberta.
- Tema, escala de texto e opções de acessibilidade.

---

## Sessões de código

Em **Sessões de código** (seção IA da barra lateral) você abre um terminal com **Codex**, **Claude Code** ou **OpenCode**, exatamente como rodaria `codex` ou `claude` à mão. Cada CLI usa a própria conta e guarda o próprio histórico. O Sagyou não chama modelo por API, não guarda chaves e não mede gasto de tokens.

As sessões abertas aparecem em abas acima do terminal. Se houver muitas, role a faixa de abas; **Nova sessão** continua disponível ao lado dela.

**Isolamento.** Cada sessão roda em uma worktree Git separada, então vários agentes podem trabalhar no mesmo repositório ao mesmo tempo sem tocar nos seus arquivos. Funciona até em uma pasta sem Git ou só com `git init`, sem criar commits na sua branch. Ao sair do CLI, o Sagyou valida todos os caminhos alterados (inclusive renames e symlinks) e arquiva o diff para revisão. Nada é aplicado ao projeto original automaticamente.

**Acesso aos seus dados por MCP.** O agente consulta e altera tarefas, projetos, notas, metas, finanças e memórias por um servidor MCP local, com credencial temporária limitada àquela sessão, ao projeto e ao perfil financeiro escolhidos.

**Acesso MCP externo.** Para um Claude Code fora das Sessões de código (como o Remote Control pelo celular), **Configurações → Acesso MCP externo** gera um token **sem prazo e com acesso total** — todos os projetos, todos os perfis financeiros e todas as ações; excluir, mexer em dinheiro e em tabelas ou perfis financeiros pede aprovação no PC ou no celular — e um comando `claude mcp add sagyou-externo …` pronto para copiar. O token aparece uma vez, só o hash fica no PC (fora do banco e do backup), **Gerar novo token** troca na hora e **Revogar** corta o acesso. Só funciona neste PC (`127.0.0.1`), com o Sagyou aberto. Com senha no app, o token para quando a tela bloqueia, a não ser que você ligue **Ler com o Sagyou bloqueado** (aí ele só lê; para escrever, desbloqueie no PC ou pelo celular). Para usar de longe, deixe o PC sem suspender.

Ao lançar ou editar uma transação, o agente também preenche os detalhes da fatura (item, valor, categoria e data da compra), a origem, a contraparte e a referência bancária. Valem as mesmas regras do app: a soma dos detalhes nunca passa do valor, e a edição entra na auditoria.

| Sem aprovação                                          | Pede sua aprovação                                   | Só você faz                         |
| ------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------- |
| criar/editar projetos, colunas, tarefas, notas e metas | qualquer exclusão                                    | definir as pastas de código         |
| mover, concluir e reabrir tarefas                      | lançamentos de dinheiro                              | trocar a moeda de uma tabela        |
| editar e arquivar memórias                             | arquivar projeto, criar tabelas e perfis financeiros | escrever em outro perfil financeiro |

Aprovar uma ação de dados não aprova o patch de código.

**Configurando um projeto.** Edite o projeto (salvo) e, em **Caminhos de código**, clique em **Adicionar pasta** se quiser que o agente trabalhe no código. Também dá para abrir uma sessão vinculada ao projeto sem pasta de código: ela usa um espaço privado e mantém o projeto como padrão no MCP. A sessão geral continua disponível.

### Memória

Decisões, tradeoffs e contexto que os agentes gravam e consultam entre sessões. Na tela **Memória** você lista, fixa, restaura e apaga. Memórias pouco usadas são arquivadas com o tempo (nunca apagadas sozinhas); as fixadas ficam para sempre. Ao fim de cada sessão, um resumo curto do que aconteceu é salvo para a próxima.

> **Vindo de uma versão antiga?** O chat por API foi removido. Na primeira abertura, as conversas são copiadas para `backups/pre-remocao-chat-<data>/` e depois apagadas, junto com as chaves de API, que não podem ser recuperadas. Detalhes em [`docs/data-migrations.md`](docs/data-migrations.md).

---

## Seus dados

Tudo fica no diretório de dados do app (`userData`):

| Caminho                  | Conteúdo                                                                  |
| ------------------------ | ------------------------------------------------------------------------- |
| `kanban.db`              | banco SQLite com todos os registros, memórias e o índice de busca         |
| `files/`, `task-images/` | anexos e imagens de tarefas                                               |
| `backups/`               | snapshots automáticos e de antes de cada importação                       |
| `agent-runs/`            | log e diff congelados de cada sessão de código (expiram em 24 horas)      |
| `ai-config.json`         | preferências dos agentes; sem chaves, fora dos backups                    |
| `password-security.json` | derivação da senha opcional (não a senha em si); fora dos backups         |
| `desktop-prefs.json`     | bandeja e bloqueio automático deste computador; fora dos backups e do sync |
| `remote-control.json`    | controle remoto deste PC (celulares autorizados, chaves cifradas); fora dos backups e do sync |
| `logs/`                  | logs de diagnóstico por dia (14 dias), sem conteúdo seu; fora dos backups |

O Sagyou não envia nada a lugar nenhum por conta própria. Os CLIs de código são programas externos, com a própria conta e política de dados.

---

## Servidor de sincronização

A sincronização entre dois PCs usa um servidor seu: um Worker da Cloudflare com um banco D1, no plano gratuito. O código fica em [`sync-server/`](sync-server/). O servidor só guarda lotes cifrados antes de sair do seu PC, ids opacos de aparelho e números; a chave nunca sai dos aparelhos.

Para publicar (precisa de uma conta Cloudflare e do Node):

```bash
cd sync-server
npm install                                   # instala o wrangler
npx wrangler login
npx wrangler d1 create sagyou-sync            # copie o database_id para o wrangler.toml
npx wrangler d1 execute sagyou-sync --remote --file schema.sql
npx wrangler secret put SETUP_TOKEN           # um segredo longo, usado só para registrar o primeiro aparelho
npx wrangler secret put TOTP_ENC_KEY          # 32 bytes aleatórios em base64url; guarde fora do repositório
npx wrangler deploy                           # mostra a URL do Worker
```

O `SETUP_TOKEN` registra o primeiro aparelho. Para recuperar um aparelho com o código de recuperação quando ainda há aparelhos ativos, também são exigidos a prova da chave e o código do autenticador. Os demais entram por convite, gerado num aparelho já pareado. O segredo `TOTP_ENC_KEY` deve ser uma chave nova de 32 bytes, codificada em base64url (por exemplo, gerada com `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`). Sem ele, o cadastro do autenticador não funciona.

O app traz este passo a passo, com os comandos para copiar, em **Como funciona → Sincronização e celular** (atalho em **Configurações → Sincronização → Como funciona a sincronização**).

Para parear, no app, em **Configurações → Sincronização**:

1. No primeiro PC, preencha a URL do Worker e o `SETUP_TOKEN` e clique em **Ativar**. Guarde o código de recuperação que aparece: ele é a única forma de recuperar a chave se você perder todos os aparelhos (em **Configurações → Sincronização → Perdi todos os aparelhos**, que troca os dados do PC pelos da nuvem com um backup antes; no celular, **Entrar com código de recuperação**).
2. Ainda no primeiro PC, cadastre o autenticador (Google Authenticator ou outro app TOTP) e guarde os códigos reserva. Ele é pedido para apagar os dados de um aparelho perdido.
3. Clique em **Parear novo aparelho**. Aparecem um texto e um QR que valem por 10 minutos. Um celular já pareado também gera esse código, em **Ajustes → Parear outro aparelho** (útil longe do PC).
4. No segundo PC, use **Entrar com código** e cole o texto. Se esse PC já tiver dados, escolha **Juntar** (fica tudo dos dois lados) ou **Substituir** (fica só o que está na nuvem, com um backup antes).

Quando a mesma coisa é editada nos dois PCs sem conexão, a versão mais recente vale e a outra aparece em **Conflitos**, com **Usar esta** para trocar. Escolher num aparelho (inclusive manter a versão atual) avisa os outros, e o mesmo conflito fecha sozinho neles na próxima sincronização. Uma dívida editada nos dois lados nunca muda sozinha: ela fica marcada como "conflito: escolha a versão" até você escolher.

### Controle remoto pelo celular

Com a sincronização ativa e a senha do Sagyou configurada, um celular autorizado controla o PC de casa (Windows): ver se ele está **Pronto**, ligar, desligar (com 60 s para cancelar), desbloquear e bloquear o Sagyou, instalar uma atualização e aprovar os cartões das Sessões de código. No PC, ligue **Configurações → Controle remoto**; no celular, **Ajustes → Controlar o PC → Pedir autorização** e confira o código de 6 dígitos nas duas telas. Longe do PC, **Estou longe do PC** autoriza com a senha do Sagyou e o autenticador (o pedido espera o PC por 1 hora); a senha vai selada para a chave do PC, que ele publica no seu Worker, e nenhum outro aparelho pareado consegue lê-la. A aba **PC** aparece no celular depois da autorização. Em caso de emergência, **Cortar acesso** na aba PC para o acesso MCP externo, encerra os servidores de Remote Control e bloqueia o Sagyou, com o PC ligado; **Restaurar acesso** volta, pelo celular (com o autenticador) ou no PC. Parear um aparelho novo também pede o código do autenticador. Os pedidos passam cifrados e assinados pelo seu Worker, valem 60 s e não podem ser repetidos.

Quem já publicou o Worker antes precisa aplicar o `schema.sql` de novo (ele só cria as tabelas novas) e publicar outra vez. Na versão 1.7 (celular 0.4), atualize o Worker **junto** com os dois apps: o convite passa a pedir o autenticador e o pedido "Estou longe do PC" vale 1 hora. Na versão 1.9 (celular 0.5), de novo junto: a senha do "Estou longe do PC" passa a ir selada para a chave do PC, e o PC recusa a de um celular sem a atualização (o celular antigo mostra só que o PC recusou). Sem isso, o app avisa "Atualize o Worker para usar o controle remoto." e a sincronização continua normal:

```bash
cd sync-server
npx wrangler d1 execute sagyou-sync --remote --file schema.sql
npx wrangler deploy
```

**Notificações (opcional).** Para o celular receber "PC pronto.", "Aprovação pendente no Sagyou." e "O PC não foi desligado.", crie um projeto no [Firebase](https://console.firebase.google.com/) com um app Android de pacote `com.sagyou.mobile`, e então:

1. Baixe a chave de uma conta de serviço (Configurações do projeto → Contas de serviço → Gerar nova chave privada) e guarde-a no Worker: `npx wrangler secret put FCM_SERVICE_ACCOUNT` (cole o JSON inteiro).
2. Baixe o `google-services.json` do app Android e cadastre o conteúdo dele como o secret `GOOGLE_SERVICES_JSON` no ambiente `mobile-release` (veja App Android). Gere o APK de novo.

Sem esses dois, tudo funciona, só sem notificações. As notificações levam só esses textos fixos: o conteúdo dos cartões é lido no app, decifrado no celular.

**Ligar o PC desligado** exige um ESP32 na mesma rede, com Wake-on-LAN configurado no PC. Em **Configurações → Controle remoto → Token do ESP32**, gere o token e a chave para o `secrets.h` do firmware. O firmware está em [`firmware/esp32/`](firmware/esp32/) (PlatformIO; como gravar no README de lá), o contrato em [`docs/esp32-api.md`](docs/esp32-api.md), e `node sync-server/scripts/esp32-sim.mjs --url … --token … --key …` simula o ESP32 para testar sem o hardware.

---

## App Android

O app do celular (em [`apps/mobile/`](apps/mobile/)) entra na mesma sincronização como mais um aparelho. Na v1 ele tem tarefas (com **Próximas**), hábitos, gastos e receitas, notas dos projetos e busca. Tudo funciona sem internet e sincroniza quando o app está aberto. Ele abre com biometria, ou com o PIN/padrão/senha do Android, e pede de novo depois de 5 minutos fora. Para usar, o Android precisa ter um bloqueio de tela configurado.

O visual segue o do PC (tema escuro ou claro, conforme o sistema). O botão **(+)** cria uma tarefa, um gasto, uma receita ou uma nota com um toque, já no último projeto ou tabela usado. Tarefas mostram primeiro o que vence hoje, e deslizar uma tarefa para a direita a conclui (com **Desfazer** por 5 segundos). Hábitos têm um botão **Hoje**, e Finanças abrem com o saldo, as entradas e as saídas do mês. O app respeita o tamanho de fonte do Android, o TalkBack e a opção **Remover animações**.

> Quem já tem uma versão anterior instalada precisa instalar o APK novo por cima: esta versão traz bibliotecas nativas novas (ícones, gestos e o seletor de data).

O APK é gerado pelo GitHub Actions e assinado com uma chave sua. Prepare uma vez:

```bash
# Gera a chave de assinatura (guarde o arquivo e as senhas fora do repositório)
keytool -genkeypair -v -keystore sagyou.jks -alias sagyou -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 sagyou.jks > sagyou.jks.b64       # no macOS: base64 -i sagyou.jks -o sagyou.jks.b64
```

Em **Settings → Environments** do repositório, crie o ambiente **`mobile-release`**. É recomendável limitá-lo às tags `mobile-v*` ou exigir sua aprovação, para que nenhuma execução a partir de outra branch leia a chave. Nesse ambiente, cadastre os secrets:

| Secret                      | Valor                          |
| --------------------------- | ------------------------------ |
| `ANDROID_KEYSTORE_BASE64`   | o conteúdo de `sagyou.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | a senha do keystore            |
| `ANDROID_KEY_ALIAS`         | `sagyou` (o alias usado acima) |
| `ANDROID_KEY_PASSWORD`      | a senha da chave               |
| `GOOGLE_SERVICES_JSON`      | opcional: o conteúdo do `google-services.json` do Firebase, para as notificações do controle remoto |

Depois, rode o workflow **Android APK** (aba Actions → Run workflow, ou empurre uma tag `mobile-v*`) e baixe o artefato `sagyou-mobile-apk`. Para instalar, copie o `.apk` para o celular, abra-o e permita a instalação de apps dessa origem quando o Android pedir.

### Lançar uma versão do celular

1. Suba a versão do app seguindo a regra de [`docs/workflow.md`](docs/workflow.md) (SemVer): `expo.version` e `android.versionCode` no `apps/mobile/app.json`, a versão no `apps/mobile/package.json` e no `package-lock.json`. Faça o merge.
2. Crie e envie a tag: `git tag mobile-vX.Y.Z && git push origin mobile-vX.Y.Z`. O workflow confere que a tag bate com o `app.json`, gera o APK e cria um Release **rascunho** com `sagyou-mobile-X.Y.Z.apk`.
3. Confira o rascunho, troque a linha **"✍️ Antes de publicar"** por um resumo do que mudou no app (a lista abaixo dela já traz só os PRs que mexeram no celular) e publique-o, de preferência sem marcar "Latest" (que fica para o desktop; marcar por engano não quebra nada). O Release do desktop (tag `vX.Y.Z`) funciona igual, com os PRs do desktop.

O celular procura uma versão nova ao abrir (no máximo uma vez por dia) e mostra a faixa **"Versão X.Y.Z disponível"**: **Baixar** abre o APK no navegador e o Android pede para instalar por cima, sem perder o pareamento; **Agora não** esconde aquela versão. Em **Ajustes → Versão do app** aparecem a versão instalada e o botão **Procurar atualização**.

> ⚠️ **Não perca o keystore.** Um APK assinado com outra chave não instala por cima do anterior: seria preciso desinstalar o app (e parear de novo).

Para parear, no PC, abra **Configurações → Sincronização → Parear novo aparelho**. No celular, toque em **Escanear QR** (ou cole o texto em **Colar código**). O celular baixa tudo da nuvem e passa a sincronizar. Conflitos detectados no celular se resolvem nele mesmo: **Ajustes → N conflitos** mostra as duas versões, com **Usar esta** (ou **Dispensar**, quando o item de origem foi apagado). Ao sair do app, o celular envia na hora o que estava esperando, em vez de deixar para a próxima abertura. **Ajustes → Como funciona a sincronização** (também no pareamento) explica quando cada aparelho sincroniza, como evitar conflitos e para que serve cada chave, com o mesmo texto do Como funciona do PC. Em **Ajustes**, **Desconectar este aparelho** apaga os dados do celular, que continuam na nuvem e nos PCs.

---

## Desenvolvimento

Requisitos: **Node 24** e **Python 3** (usado só no build para empacotar o leitor de documentos; o usuário final não precisa dele).

```bash
npm install
npm run dev          # app em modo desenvolvimento, com HMR
npm test             # testes (Vitest)
npm run typecheck    # TypeScript do main e do renderer
npm run lint         # ESLint

npm run build:win    # instaladores
npm run build:mac
npm run build:linux
```

**Estrutura.** `src/main` é o processo principal do Electron (SQLite, IPC, terminais dos agentes, MCP), `src/preload` expõe a ponte IPC tipada e `src/renderer/src` é a interface em React com estado em Zustand.

**Stack.** Electron + electron-vite, React, TypeScript, Zustand, better-sqlite3, Tailwind CSS, dnd kit, D3 Force, decimal.js, SheetJS, node-pty + xterm.js e Vitest.

### Contribuindo

Toda mudança segue **spec → plano → build → review → PR**, com aprovação humana na spec, no plano e no merge. Branches `feature/`, `fix/` ou `chore/`, commits em Conventional Commits, nunca direto na `main`. Quem usa Claude Code tem uma skill por etapa (`/sagyou-spec`, `/sagyou-plan`, `/sagyou-build`, `/sagyou-review`, `/sagyou-pr`, `/sagyou-fix`).

- [`docs/workflow.md`](docs/workflow.md): o fluxo completo
- [`GUIDE.md`](GUIDE.md): orientação para agentes de código
- [`CLAUDE.md`](CLAUDE.md): arquitetura detalhada e regras de dados

---

## Licença

[Sagyou Noncommercial License](LICENSE): uso, modificação e redistribuição livres para fins **não comerciais**, mantendo a atribuição. Dependências de terceiros em [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md).

## Agradecimentos

- [AI Memory](https://github.com/akitaonrails/ai-memory), de [Fabio Akita](https://github.com/akitaonrails), que inspirou a arquitetura de memória do Sagyou.
