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

| | |
|---|---|
| **Kanban** | Quadros com colunas customizáveis, sprints, prioridades e cronômetro por tarefa |
| **Hábitos** | Rastreamento diário com histórico e streak |
| **Metas** | Acompanhamento de objetivos pessoais |
| **Financeiro** | Transações, metas financeiras e análises, com listas de compras em múltiplas moedas (BRL, USD, JPY) |
| **Canvas** | Notas adesivas livres em tela infinita |
| **Arquivos** | Anexos por projeto, guardados localmente |
| **Relatórios** | Visão geral de produtividade |
| **Upcoming** | Tarefas com data de vencimento próxima |
| **Busca** | Pesquisa rápida em todos os dados |
| **Assistente de IA** | Chat com acesso aos seus dados via ferramentas — funciona com qualquer provedor compatível com a API da OpenAI (local ou hospedado). Ações que alteram dados pedem aprovação antes de rodar |
| **Agente de código** | Aponte um projeto para um diretório e peça alterações no código — executado por `aider` ou `codex` |
| **Importação via IA** | Cole JSON gerado por um LLM — o sidebar tem "Copiar tudo" para gerar um prompt pronto com schema e tags |
| **Exportação para Excel** | Exporte projetos, tarefas, hábitos, metas e dados financeiros em `.xlsx` |
| **Backup** | Exportação e restauração de dados em JSON |

---

## Tecnologias

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Zustand](https://zustand-demo.pmnd.rs/) — gerenciamento de estado
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — armazenamento local em SQLite
- [decimal.js](https://mikemcl.github.io/decimal.js/) — aritmética monetária exata
- [dnd kit](https://dndkit.com/) — drag and drop
- [Tailwind CSS](https://tailwindcss.com/) — estilização
- [SheetJS](https://sheetjs.com/) — exportação para Excel
- [Vitest](https://vitest.dev/) — testes

---

## Desenvolvimento

```bash
npm install       # instalar dependências
npm run dev       # iniciar servidor de desenvolvimento
npm test          # rodar testes
npm run typecheck # verificar tipos
npm run lint      # ESLint
```

## Build

```bash
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

---

## Dados

Tudo fica na sua máquina, no diretório de dados do app (`userData`):

| Arquivo | Conteúdo |
|---|---|
| `kanban.db` | banco SQLite com projetos, tarefas, hábitos, metas e finanças |
| `files/` | anexos enviados |
| `ai-config.json` | configuração do provedor de IA (inclui a chave de API) |
| `ai-conversations.json` | histórico do chat |

O assistente de IA é opcional e desligado até você configurar um provedor. Se você apontar para um provedor hospedado, os dados enviados no chat saem da máquina — use um modelo local se preferir manter tudo offline.
