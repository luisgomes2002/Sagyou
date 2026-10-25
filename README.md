# Sagyou

> Kanban pessoal offline construído com Electron, React e TypeScript.

![Electron](https://img.shields.io/badge/Electron-47848F?style=flat&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Offline](https://img.shields.io/badge/100%25-Offline-brightgreen?style=flat)

---

## Capturas de tela

<table>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/eb3a5c35-829f-480a-b1d7-7dbc7e84de14" alt="Board"/></td>
    <td><img src="https://github.com/user-attachments/assets/5bec424d-d8fc-4157-9770-10fb08a85803" alt="Board - modal de tarefa"/></td>
  </tr>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/07afcbc4-6625-415b-bb2a-af5499f485d7" alt="Hábitos"/></td>
    <td><img src="https://github.com/user-attachments/assets/2eb079f9-896c-4853-a1ab-ca13ec3b5721" alt="Metas"/></td>
  </tr>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/c86a7a34-9271-4798-bcb0-54ab6f50d4ed" alt="Canvas"/></td>
    <td><img src="https://github.com/user-attachments/assets/7b1bd2c3-f4c9-4faf-a25a-3b5d9fd2949c" alt="Lista de compras"/></td>
  </tr>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/679efc5c-fd4e-4e76-8bf0-3175ef91a22d" alt="Upcoming"/></td>
    <td><img src="https://github.com/user-attachments/assets/79510096-8e0d-4844-a3a2-9260913d2e0a" alt="Relatórios"/></td>
  </tr>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/05ac6c2e-d5dd-4c82-9d29-855afa538827" alt="Importação via IA"/></td>
    <td><img src="https://github.com/user-attachments/assets/9167dc07-f098-4b53-9241-175d772fdf14" alt="Busca"/></td>
  </tr>
  <tr>
    <td colspan="2"><img src="https://github.com/user-attachments/assets/30fd8017-a4e6-4921-8068-676272ead630" alt="Visão geral"/></td>
  </tr>
</table>

---

## Funcionalidades

|                           |                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kanban**                | Quadros com colunas customizáveis, sprints, prioridades e múltiplos cronômetros por tarefa                                                                                                                                                                                                                           |
| **Hábitos**               | Rastreamento diário com histórico e streak                                                                                                                                                                                                                                                                           |
| **Metas**                 | Acompanhamento de objetivos pessoais                                                                                                                                                                                                                                                                                 |
| **Financeiro**            | Transações, metas financeiras e análises, com listas de compras em múltiplas moedas (BRL, USD, JPY). Detalhe um lançamento em itens e categorias para que a análise reflita como o dinheiro foi gasto, sem duplicar valores nos totais                                                                               |
| **Canvas**                | Notas adesivas livres com conexões e blocos de texto independentes para títulos, subtítulos e anotações, com fonte e largura ajustáveis                                                                                                                                                                             |
| **Grafo**                 | Mapa interativo de projetos, inclusive arquivados, tarefas, notas, metas e hábitos; blocos de texto do canvas não aparecem no grafo                                                                                                                                                                                  |
| **Upcoming**              | Tarefas com data de vencimento próxima                                                                                                                                                                                                                                                                               |
| **Relatórios**            | Visão geral de produtividade                                                                                                                                                                                                                                                                                         |
| **Busca**                 | Busca global (Ctrl+K) por área, tipo e projeto, com trechos e resultados adicionais                                                                                                                                                                                                                                                                                           |
| **Arquivos**              | Anexos por projeto, guardados localmente                                                                                                                                                                                                                                                                             |
| **Agentes de código**     | Abra sessões do Codex, Claude Code ou OpenCode direto no terminal, dentro do Sagyou: cada uma roda em uma worktree isolada, e o patch só chega ao seu projeto depois da sua revisão e aprovação |
| **Memória**               | Decisões, tradeoffs e contexto que os agentes consultam e gravam pelo MCP entre sessões. Painel dedicado para listar, fixar e restaurar memórias |
| **Importação via IA**     | Cole JSON gerado por um LLM — o sidebar tem "Copiar tudo" para gerar um prompt pronto com schema e tags                                                                                                                                                                                                              |
| **Exportação para Excel** | Exporte projetos, tarefas, hábitos, metas e dados financeiros em `.xlsx`                                                                                                                                                                                                                                             |
| **Backup**                | Exportação e restauração de dados em JSON, incluindo anexos, imagens de tarefas e memórias. O app também salva snapshots locais ao abrir e a cada hora em `userData/backups/`, mantendo os sete mais recentes. Abra a pasta pelo menu Backup |

---

## Agentes de código

A IA do Sagyou é o próprio CLI que você já usa. Em **Sessões de código** (barra lateral, seção IA), escolha o projeto e a pasta autorizada, ou uma sessão geral, e o harness: **Codex**, **Claude Code** ou **OpenCode** instalado localmente. A sessão abre direto no terminal, como rodar `claude` ou `codex` à mão: você digita o pedido ao CLI. Cada CLI usa a própria conta e guarda o próprio histórico; o Sagyou não chama modelo por API, não guarda chaves e não registra gasto de tokens.

O CLI lê e altera somente os arquivos de uma **worktree isolada**; vários agentes podem trabalhar ao mesmo tempo no mesmo repositório, e um repositório criado só com `git init` também funciona (o Sagyou cria uma base temporária sem fazer commit na sua branch). Dados do Sagyou — tarefas, projetos, finanças, memórias — chegam ao CLI exclusivamente pelo **MCP local**, com credencial efêmera limitada ao projeto, ao perfil financeiro e às permissões da execução. Pelo MCP o agente lê e também altera seus dados: cria e edita projetos e colunas; edita, move (inclusive entre projetos), conclui, reabre e exclui tarefas; cria, edita e registra progresso de metas; cria e edita notas; lança e edita transações, cria tabelas e categorias no perfil financeiro da sessão; e edita, arquiva ou resolve memórias contraditórias. Exclusões, lançamentos de dinheiro, arquivar projeto e mexer em tabelas ou perfis financeiros pedem sua aprovação; o resto entra direto. Ficam só com você: pastas de código do projeto, trocar a moeda de uma tabela e escrever em outro perfil financeiro. Essas aprovações não aprovam o patch.

Ao sair normalmente do CLI, o Sagyou valida todos os caminhos alterados, inclusive renames e symlinks, e arquiva o diff. A sessão interativa termina sem aplicar nada ao projeto original; o diff arquivado fica disponível para consulta no painel (execuções arquivadas expiram em 24 horas).

Para liberar uma pasta de código a um projeto, abra o projeto para edição e, em **Caminhos de código**, clique em **Adicionar pasta**. O projeto precisa estar salvo antes. A primeira pasta já fica marcada; dá para marcar mais de uma, e uma sessão roda em uma pasta só.

### Remoção do chat por API

Versões anteriores tinham um chat com provedores de API, histórico de conversas e controle de gasto. Isso foi removido. Na primeira abertura da versão nova, o Sagyou copia as conversas e os arquivos do chat para uma pasta `backups/pre-remocao-chat-<data>/` (dentro do diretório de dados do app) e depois apaga as conversas, as imagens e os documentos do chat, o registro de gastos, as métricas e as chaves de API. **As chaves de API não vão para nenhum backup e não podem ser recuperadas.** A pasta com as conversas pode ser lida à mão, mas não é importável pelo app. Detalhes em [`docs/data-migrations.md`](docs/data-migrations.md).

---

## Tecnologias

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
- Ponte IPC tipada a partir do preload — renderer e métodos expostos compartilham o mesmo contrato
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Zustand](https://zustand-demo.pmnd.rs/) — gerenciamento de estado
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — armazenamento local em SQLite
- [decimal.js](https://mikemcl.github.io/decimal.js/) — aritmética monetária exata
- [D3 Force](https://d3js.org/d3-force) — simulação e layout da visão de grafo
- [dnd kit](https://dndkit.com/) — drag and drop
- [Tailwind CSS](https://tailwindcss.com/) — estilização
- [SheetJS](https://sheetjs.com/) — exportação para Excel e leitura de XLSX/ODS
- [pdfjs-dist](https://github.com/mozilla/pdf.js) — extração de texto de PDF
- [mammoth.js](https://github.com/mwilliamson/mammoth.js) — extração de texto de DOCX/ODT
- [Vitest](https://vitest.dev/) — testes
- [node-pty](https://github.com/microsoft/node-pty) + [xterm.js](https://xtermjs.org/) — terminal dos agentes

---

## Desenvolvimento

O código do processo principal fica em `src/main`: `index.ts` registra os fluxos,
`handlers/` expõe o IPC, `store.ts` cuida do SQLite e `modules/` agrupa as
implementações por área (agentes, memória, arquivos, busca, web e finanças).
O renderer fica em `src/renderer/src`, com componentes, estado e utilitários.

```bash
npm install       # instalar dependências
npm run dev       # iniciar servidor de desenvolvimento
npm run typecheck # validar TypeScript de main e renderer
npm test          # rodar os testes
npm run lint      # ESLint
```

Para mudanças na persistência, consulte `GUIDE.md`: a normalização compartilhada da carga e da importação fica em `src/renderer/src/store/normalization.ts`.

### Fluxo de contribuição

Toda mudança segue spec → plano → build → review → PR, com aprovação humana na spec, no plano e no merge; nunca se commita direto na `main`. Branches `feature/`, `fix/` e `chore/`, commits no padrão Conventional Commits e um template de PR em `.github/`. Para quem usa Claude Code há uma skill por estágio (`/sagyou-spec`, `/sagyou-plan`, `/sagyou-build`, `/sagyou-review`, `/sagyou-pr`, `/sagyou-fix`) e subagentes em `.claude/`. Detalhes em [`docs/workflow.md`](docs/workflow.md).

## Build

```bash
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

---

## Financeiro

Além do valor, data, categoria e origem de cada lançamento, você pode **detalhar uma transação** em itens. Cada item pode ter descrição, valor, categoria e data de compra próprios — útil, por exemplo, para separar uma fatura de cartão entre mercado, transporte e lazer. No consolidado, um item da fatura também pode ser vinculado ao lançamento espelho de outra tabela: a fatura continua inteira e a cópia não duplica o total.

Os itens apenas repartem o valor do lançamento principal: a soma deles não pode ultrapassá-lo e eles não são contabilizados novamente nos totais. Nas análises por categoria, a parcela detalhada aparece nas categorias dos itens; se uma transação de categoria **Cartão** ficar parcialmente detalhada, o restante aparece como **Cartão não detalhado** para deixar claro o que ainda falta classificar.

---

## Dados

Tudo fica na sua máquina, no diretório de dados do app (`userData`):

| Arquivo                 | Conteúdo                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `kanban.db`             | banco SQLite com projetos, tarefas, hábitos, metas, finanças (incluindo detalhes de transações) e memórias                |
| `files/`                | anexos enviados                                                                                                          |
| `task-images/`          | imagens anexadas a tarefas                                                                                               |
| `ai-config.json`        | configuração dos agentes (executor padrão, nome de exibição); não guarda chaves de API e não entra em backups              |
| `password-security.json` | derivado com salt da senha opcional do app; não contém a senha e não entra em backups                                  |
| `backups/`              | snapshots locais automáticos, de pré-importação e a pasta única `pre-remocao-chat-*`                                      |
| `agent-runs/`           | execuções arquivadas dos agentes (log + diff congelados), ligadas a projeto e sessão                                       |

O Sagyou não envia seus dados a lugar nenhum por conta própria. Os agentes de código são CLIs externos com a própria conta e a própria política de dados: o que o CLI enviar ao seu provedor depende dele, não do Sagyou.

O `kanban.db` também guarda um índice local de busca FTS5. Ele é derivado dos registros e das memórias e pode ser reconstruído sem alterar os dados originais.

Para bloquear o app, abra o menu **Opções** na barra lateral e escolha **Segurança**. Você pode ativar, alterar ou desativar uma senha; quando ativa, ela é solicitada antes de os dados carregarem.

---

## Agradecimentos

- [AI Memory](https://github.com/akitaonrails/ai-memory) por [Fabio Akita](https://github.com/akitaonrails) — sistema de memória durável para agentes de IA com indexação e busca, que inspirou a arquitetura de memória do Sagyou.
