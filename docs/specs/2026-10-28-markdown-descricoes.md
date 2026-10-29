# Markdown nas descrições e anotações

Status: approved by Luis on 2026-10-28
Branch: feature/markdown-descricoes

## Por quê

Descrições de tarefas e conteúdo das notas são texto simples, sem formatação de leitura. Hábitos ainda não possuem campo de anotação. O usuário quer escrever listas, links e trechos de código sem perder o texto original.

## Objetivos

- Escrever e ler Markdown em descrições de tarefas, notas do canvas e anotações de hábitos.
- Oferecer alternância entre leitura e edição com toolbar curta.
- Renderizar GFM (checkboxes e tabelas) sem executar HTML bruto nem abrir links inseguros.

## Fora do escopo

- Editor rico WYSIWYG.
- Syntax highlighting de código na primeira versão.
- Imagens Markdown; imagens de tarefas continuam nos anexos existentes.
- Conversão automática de texto antigo para outro formato.

## Decisões de Luis

- Reaproveitar `react-markdown` e `remark-gfm`, já instalados.
- O texto de descrições e notas continua salvo como string, sem mudança de formato.
- Links externos passam pelo caminho existente de `safeExternalUrl`; HTML bruto não é habilitado.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- A task abre em **Leitura** quando já há descrição, e em **Edição** quando está vazia. O botão **Editar descrição** alterna para textarea; **Prévia** volta à renderização sem gravar automaticamente. Salvar a task mantém o fluxo atual.
- Notas do canvas renderizam Markdown na visualização da nota, com edição no fluxo já existente do card/modal. Notas `type: 'text'` também renderizam, mas preservam o tamanho de fonte e a largura configurados. A edição continua em texto bruto.
- Hábito ganha um campo opcional `notes?: string` com padrão vazio na UI. O formulário **Novo/Editar hábito** mostra **Anotações** e usa o mesmo editor e visualizador; a anotação aparece no detalhe do hábito, sem ocupar o card compacto.
- A toolbar insere os marcadores no cursor ou envolve a seleção para **Negrito**, **Itálico**, **Código**, **Link**, **Lista** e **Checklist**. Ela não altera o valor salvo até o usuário salvar a entidade.
- Links aceitam apenas `http:` e `https:` sem credenciais. O componente renderiza âncoras com abertura externa via `target="_blank"` e `rel="noopener noreferrer"`; o handler `setWindowOpenHandler` no main aplica `safeExternalUrl` e nega a janela. Links `file:`, `javascript:`, `data:` ou com credenciais aparecem como texto sem navegação.
- Código inline, blocos de código, citações e tabelas recebem estilos do tema atual. Checkboxes de GFM são somente leitura na prévia; o usuário edita o texto para marcá-las.

## Comportamento

- Markdown válido renderiza negrito, itálico, links, listas, checklist, citação, tabela e código. Quebras de linha preservam a leitura adequada sem reescrever a string.
- Markdown incompleto fica editável como texto; a prévia mostra o que a biblioteca conseguir interpretar, sem descartar conteúdo.
- Texto antigo sem Markdown aparece como antes, incluindo caracteres especiais escapados corretamente. HTML digitado não vira elemento executável.
- Links externos usam o navegador padrão; clicar não navega a janela do Sagyou. Link recusado não produz navegação.
- Salvar e reabrir task, nota ou hábito mantém a string original. Exportar/importar backup mantém o mesmo texto.

## Dados

Task `description` e StickyNote `content` não mudam de tipo nem de formato. Habit recebe `notes?: string` opcional no modelo, coluna nullable no SQLite com migração idempotente e inclusão no backup. Hábito antigo sem a coluna/campo carrega com anotação vazia; o normalizador, a validação e o reparo de backup aceitam ausência do campo. Nenhum registro existente é removido ou renomeado. O round-trip de backup e a leitura de banco antigo precisam de testes.

## Telas

TaskModal, card/modal de nota no Canvas e edição/detalhe do hábito. Toolbar usa botões com rótulos acessíveis. A prévia segue o tema existente e tem estilo para tabelas e blockquotes.

## Perguntas em aberto

(nenhuma)
