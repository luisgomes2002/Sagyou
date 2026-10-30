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

| Plataforma | Formato           |
| ---------- | ----------------- |
| Windows    | instalador `.exe` |
| macOS      | `.dmg`            |
| Linux      | `.AppImage`, `.deb` |

Não é preciso instalar Python, Node nem nada além do app. Para usar as sessões de código, tenha ao menos um dos CLIs (Codex, Claude Code ou OpenCode) instalado e autenticado.

---

## O que tem dentro

### Organização

| Área             | O que faz                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| **Início**       | Painel com o resumo do dia: tarefas, hábitos, metas e saldo                                            |
| **Board**        | Kanban por projeto com colunas próprias, sprints, prioridades, tags, imagens e vários cronômetros simultâneos |
| **Próximas**     | Tarefas com prazo, em ordem de vencimento                                                              |
| **Concluídas**   | Histórico do que já foi entregue                                                                       |
| **Planejamento** | Agenda semanal com blocos de horário ligados a tarefas e hábitos                                       |
| **Canvas**       | Notas adesivas livres, conectáveis e ligadas a tarefas, mais blocos de texto para títulos e anotações  |
| **Grafo**        | Mapa interativo das relações entre projetos, tarefas, notas, metas, hábitos e memórias                |
| **Arquivos**     | Anexos por projeto, guardados localmente e pesquisáveis pelo conteúdo (PDF, DOCX, planilhas e mais)    |

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
- **Senha opcional** para bloquear o app (menu **Opções → Segurança**).
- Tema, escala de texto e opções de acessibilidade.

---

## Sessões de código

Em **Sessões de código** (seção IA da barra lateral) você abre um terminal com **Codex**, **Claude Code** ou **OpenCode**, exatamente como rodaria `codex` ou `claude` à mão. Cada CLI usa a própria conta e guarda o próprio histórico. O Sagyou não chama modelo por API, não guarda chaves e não mede gasto de tokens.

As sessões abertas aparecem em abas acima do terminal. Se houver muitas, role a faixa de abas; **Nova sessão** continua disponível ao lado dela.

**Isolamento.** Cada sessão roda em uma worktree Git separada, então vários agentes podem trabalhar no mesmo repositório ao mesmo tempo sem tocar nos seus arquivos. Funciona até em uma pasta sem Git ou só com `git init`, sem criar commits na sua branch. Ao sair do CLI, o Sagyou valida todos os caminhos alterados (inclusive renames e symlinks) e arquiva o diff para revisão. Nada é aplicado ao projeto original automaticamente.

**Acesso aos seus dados por MCP.** O agente consulta e altera tarefas, projetos, notas, metas, finanças e memórias por um servidor MCP local, com credencial temporária limitada àquela sessão, ao projeto e ao perfil financeiro escolhidos.

Ao lançar ou editar uma transação, o agente também preenche os detalhes da fatura (item, valor, categoria e data da compra), a origem, a contraparte e a referência bancária. Valem as mesmas regras do app: a soma dos detalhes nunca passa do valor, e a edição entra na auditoria.

| Sem aprovação                                       | Pede sua aprovação                                    | Só você faz                         |
| --------------------------------------------------- | ----------------------------------------------------- | ----------------------------------- |
| criar/editar projetos, colunas, tarefas, notas e metas | qualquer exclusão                                     | definir as pastas de código         |
| mover, concluir e reabrir tarefas                   | lançamentos de dinheiro                               | trocar a moeda de uma tabela        |
| editar e arquivar memórias                          | arquivar projeto, criar tabelas e perfis financeiros  | escrever em outro perfil financeiro |

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
| `logs/`                  | logs de diagnóstico por dia (14 dias), sem conteúdo seu; fora dos backups  |

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
