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
| **Kanban** | Quadros com colunas customizáveis, sprints, prioridades e múltiplos cronômetros por tarefa |
| **Hábitos** | Rastreamento diário com histórico e streak |
| **Metas** | Acompanhamento de objetivos pessoais |
| **Financeiro** | Transações, metas financeiras e análises, com listas de compras em múltiplas moedas (BRL, USD, JPY) |
| **Canvas** | Notas adesivas livres em tela infinita, com links para tarefas |
| **Upcoming** | Tarefas com data de vencimento próxima |
| **Relatórios** | Visão geral de produtividade |
| **Busca** | Pesquisa rápida de tarefas |
| **Arquivos** | Anexos por projeto, guardados localmente |
| **Assistente de IA** | Chat com acesso aos seus dados via ferramentas — funciona com qualquer provedor compatível com a API da OpenAI (local ou hospedado). Suporte a imagens (arraste screenshots) e documentos (PDF, DOCX, XLSX, CSV, etc.) — o texto é extraído e enviado inline. Ações que alteram dados pedem aprovação antes de rodar |
| **Agente de código** | Aponte um projeto para um diretório e peça alterações no código — edita arquivos e roda comandos com aprovação por ação. Sandbox obrigatório (ai-jail) confina comandos ao diretório do projeto |
| **Multi-agente** | Vários chats de IA rodando em paralelo — o painel Agentes mostra o que cada um está fazendo, com gasto de tokens por agente |
| **Skills** | Comandos `/skill-name` no chat que injetam system prompts customizados — crie, edite e importe arquivos `.md` |
| **Memória** | Assistente lembra decisões, tradeoffs e contexto entre conversas — você e o modelo gravam fatos que persistem. Painel dedicado para listar, fixar e restaurar memórias |
| **Importação via IA** | Cole JSON gerado por um LLM — o sidebar tem "Copiar tudo" para gerar um prompt pronto com schema e tags |
| **Exportação para Excel** | Exporte projetos, tarefas, hábitos, metas e dados financeiros em `.xlsx` |
| **Backup** | Exportação e restauração de dados em JSON, incluindo anexos, imagens de chat/tarefas e memórias |

---

## Assistente de IA

O assistente é **opcional** e vem desligado — nada é enviado a lugar nenhum até você configurar um provedor.

### Configuração

Abra a view **Assistente IA** e clique na engrenagem. A configuração tem sete grupos de campos:

**1. Provedor**

| Campo | Descrição |
|---|---|
| **Base URL** | Endpoint da API — ex.: `https://api.openai.com/v1`, `http://localhost:11434/v1` (Ollama), `http://localhost:1234/v1` (LM Studio) |
| **API Key** | `sk-...` — deixe qualquer valor se o provedor local não exigir |
| **Model** | Dropdown com os modelos disponíveis no endpoint; use o botão ao lado para carregar a lista |

**2. Modelo p/ código (opcional)**

Dropdown extra que, quando preenchido, roteia perguntas de código (análise, bugs, refatoração) para um modelo diferente do usado no chat geral. Vazio = mesmo modelo para tudo.

**3. Passos máximos**

Quantas rodadas de ferramentas o assistente pode encadear numa execução. O padrão muda conforme o modo: **40 passos no manual** (você aprova cada ação) e **100 no automático**. Aumentar o limite permite tarefas mais longas, mas consome mais tokens.

**4. Timeout (segundos)**

Tempo máximo de espera para o modelo começar a responder cada chamada. Evita que uma conexão lenta trave o app indefinidamente.

**5. Preços (opcional)**

| Campo | Descrição |
|---|---|
| **Input (por 1M tokens)** | Custo de entrada para estimar o gasto da conversa |
| **Output (por 1M tokens)** | Custo de saída para estimar o gasto da conversa |

Os valores informados são usados no rodapé do chat para exibir o custo estimado da sessão. Deixar em branco desabilita o cálculo.

**6. Agente de Código**

Provider separado para o agente de código nativo. Cada campo em branco herda o valor do provedor principal.

| Campo | Descrição |
|---|---|
| **Base URL** | Endpoint exclusivo para o agente (vazio = usa o do chat) |
| **API Key** | Chave exclusiva (vazio = usa a do chat) |
| **Model** | Modelo exclusivo (vazio = usa o do chat) |

**7. Sandbox (ai-jail)**

Toggle que exige o binário [AI Jail](https://github.com/akitaonrails/ai-jail) instalado. Ligado, todo comando do agente de código é confinado à pasta do projeto (bubblewrap no Linux, sandbox-exec no macOS, WSL2 no Windows). Desmarcar roda comandos sem confinamento — o app exibe um aviso antes de permitir.

Serve qualquer provedor compatível com a API da OpenAI. A configuração fica em `ai-config.json` (veja [Dados](#dados)) e a chave **não** é enviada para o renderer.

### Uso

Converse normalmente — o assistente tem ferramentas para ler seus dados (tarefas, hábitos, metas, finanças) e responde com base neles em vez de adivinhar.

O assistente também tem **memória entre conversas**: ele grava decisões, tradeoffs e fatos que você fixar, e os recupera em conversas futuras. Use `salvar_memoria` para registrar algo que não vale a pena reaprender depois. Memórias com dados sensíveis (chaves, senhas) são automaticamente sanitizadas antes de gravar.

Ações que **alteram** dados (criar tarefas, concluir, iniciar cronômetro, criar/atribuir sprint) pedem sua aprovação antes de rodar. O botão no topo liga o **modo automático**, que executa sem perguntar — use com cuidado.

O assistente também suporta **imagens**: arraste ou cole screenshots no chat e o modelo responde sobre elas. As imagens ficam salvas em `chat-images/` e são enviadas ao modelo a cada passo da execução.

O assistente também lê **documentos**: arraste ou cole PDF, DOCX, XLSX, CSV, TXT, MD e outros formatos no chat. O texto é extraído na hora e incluído na mensagem — o modelo lê o conteúdo como parte da conversa. Para documentos salvos nos anexos do projeto (via FilesView), use a ferramenta `ler_documento` — útil para referências de longo prazo como políticas, relatórios ou notas de reunião. Os arquivos ficam em `chat-files/` e são limpos quando a conversa é deletada.

### Multi-agente

Você pode abrir **vários chats em paralelo** — cada um roda como um agente independente. O sidebar ganha uma aba **Agentes** com um painel ao vivo que mostra, para cada agente ativo:
- O projeto em que está trabalhando
- O que está fazendo no momento (texto sendo gerado ou ferramenta em execução)
- O passo atual e o total de passos
- O gasto de tokens acumulado (entrada e saída)
- Se está parado aguardando aprovação

Ações disponíveis: **Abrir chat** (volta para a conversa) e **Parar** (aborta a execução). Um contador no sidebar mostra quantos agentes estão rodando.

Agentes que trabalham no mesmo projeto usam **leases cooperativas**: uma tarefa já atribuída a um agente não pode ser pega por outro. Se você deletar uma conversa que está rodando, o agente é abortado automaticamente.

### Skills

Skills são arquivos `.md` que você cria e usa como system prompts sob demanda. No chat, digite `/` para ver a lista e selecionar — o conteúdo do arquivo é injetado como instrução extra para o modelo naquela conversa.

Gerencie skills pelo menu de configuração do assistente: criar, editar, importar e excluir. Skills ficam salvas em `skills/` no diretório de dados do app.

### Acesso ao código (opcional)

Abra o projeto para edição e, em **Caminhos de código**, clique em **Adicionar pasta**. A partir daí o assistente lê o código-fonte para responder perguntas sobre ele — listar arquivos, ler e buscar. O acesso é **somente leitura** e confinado ao diretório escolhido.

O projeto precisa estar salvo antes (a seção fica desabilitada em projetos novos). A **primeira pasta adicionada já fica marcada automaticamente** — não há nada a fazer no caso simples.

Dá para marcar **mais de uma pasta** (útil para front-end e back-end em repositórios separados, por exemplo): clique na linha da pasta para marcar/desmarcar. As marcadas ganham o selo **Ativo**, e o cabeçalho do Assistente IA mostra o que está em uso. As ferramentas de leitura cobrem todas as pastas marcadas de uma vez.

> O **agente de código** é a exceção: ele roda em uma pasta só. Se você tiver várias marcadas, ele pede para você escolher qual antes de rodar.

### Agente de código

Para **alterar** código, use o agente de código nativo — ele roda com o provedor configurado na seção **Agente de Código** das configurações (cada campo em branco herda o valor do provedor principal) e edita arquivos no diretório do caminho de código ativo.

Cada ação de escrita ou comando passa por aprovação antes de rodar. O agente não faz commit — as mudanças aparecem no painel de diff para você revisar e commitar por conta própria. A saída aparece ao vivo no app.

> O agente usa a mesma Base URL / API Key / Model do chat, ou um provedor separado se você configurar um na seção **Agente de Código** das configurações. Aponte para um repositório com Git e commits em dia — assim dá para revisar o diff e reverter se não gostar.

---

## Tecnologias

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Zustand](https://zustand-demo.pmnd.rs/) — gerenciamento de estado
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — armazenamento local em SQLite
- [decimal.js](https://mikemcl.github.io/decimal.js/) — aritmética monetária exata
- [dnd kit](https://dndkit.com/) — drag and drop
- [Tailwind CSS](https://tailwindcss.com/) — estilização
- [SheetJS](https://sheetjs.com/) — exportação para Excel e leitura de XLSX/ODS
- [pdfjs-dist](https://github.com/mozilla/pdf.js) — extração de texto de PDF
- [mammoth.js](https://github.com/mwilliamson/mammoth.js) — extração de texto de DOCX/ODT
- [Vitest](https://vitest.dev/) — testes
- [OpenAI SDK](https://github.com/openai/openai-node) — cliente para provedores compatíveis

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
| `kanban.db` | banco SQLite com projetos, tarefas, hábitos, metas, finanças e memórias do assistente |
| `files/` | anexos enviados |
| `chat-images/` | imagens enviadas no chat |
| `chat-files/` | documentos enviados no chat (PDF, DOCX, etc.) |
| `task-images/` | imagens anexadas a tarefas |
| `ai-config.json` | configuração do provedor de IA (inclui a chave de API) |
| `ai-conversations.json` | histórico do chat |
| `ai-usage-log.json` | registro de gastos por chamada (hoje, 30 dias, total, por modelo) |
| `ai-run-metrics.json` | métricas de eficiência por execução do agente (modelo, passos, tokens, buscas) |
| `agent-runs/` | arquivo de execuções do agente de código (log + diff congelados) |
| `skills/` | skills customizadas em `.md` — system prompts sob demanda via `/skill-name` |

O assistente de IA é opcional e desligado até você configurar um provedor. Se você apontar para um provedor hospedado, os dados enviados no chat saem da máquina — use um modelo local se preferir manter tudo offline.

---

## Agradecimentos

- [AI Jail](https://github.com/akitaonrails/ai-jail) por [Fabio Akita](https://github.com/akitaonrails) — sandbox multi-OS obrigatório que confina os comandos do agente de código ao diretório do projeto. No Windows roda via WSL2 (sem build nativo). O Sagyou embrulha cada comando com ai-jail; não há código linkado, portanto a licença do Sagyou não é afetada.
- [AI Memory](https://github.com/akitaonrails/ai-memory) por [Fabio Akita](https://github.com/akitaonrails) — sistema de memória durável para agentes de IA com indexação e busca, que inspirou a arquitetura de memória do Sagyou.
