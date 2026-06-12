# Sagyou

Kanban pessoal offline construído com Electron, React e TypeScript.

## Funcionalidades

- **Kanban** — quadros com colunas customizáveis, sprints e prioridades
- **Habitos** — rastreamento diário de hábitos com histórico e streak
- **Metas** — acompanhamento de objetivos pessoais
- **Lista de compras** — listas com suporte a múltiplas moedas (BRL, USD, JPY)
- **Canvas** — notas adesivas livres em tela infinita
- **Relatórios** — visão geral de produtividade
- **Upcoming** — tarefas com data de vencimento próxima
- **Busca** — pesquisa rápida em todos os dados
- **Backup** — exportação e importação de dados em JSON
- 100% offline — dados armazenados localmente

## Setup

### Instalar dependências

```bash
npm install
```

### Desenvolvimento

```bash
npm run dev
```

### Testes

```bash
npm test
```

### Build

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

## Tecnologias

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Zustand](https://zustand-demo.pmnd.rs/) — gerenciamento de estado
- [dnd kit](https://dndkit.com/) — drag and drop
- [Tailwind CSS](https://tailwindcss.com/) — estilização
- [Vitest](https://vitest.dev/) — testes
