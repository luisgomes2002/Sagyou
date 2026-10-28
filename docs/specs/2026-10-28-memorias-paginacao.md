# Paginação da tela de memórias

Status: approved by Luis on 2026-10-28
Branch: feature/memorias-paginacao

## Por quê

A tela **Memória do assistente** carrega e desenha todas as memórias de uma vez, com o corpo inteiro de cada uma. As ativas têm teto de 500 (`MEMORY_MAX`), mas as arquivadas não têm limite e só crescem, porque o decay arquiva e nunca apaga. Task "Adicionar paginação na memória".

## Objetivos

- O main devolve à tela só uma página de memórias, com o total e as contagens.
- A tela mostra 25 por página, com Anterior/Próxima, e o filtro "Ver arquivadas" continua funcionando junto.
- Abrir uma memória pela busca global (Ctrl+K) leva à página onde ela está.

## Fora do escopo

- Campo de busca dentro da tela de memórias. Ela não tem um hoje; a busca é o Ctrl+K.
- Paginar no SQL. Veja Decisões.
- Mudar `ai:memory:list`, usado também pelo grafo e pelo `App.tsx`.
- Mudar o visual dos cartões de memória. Eles já usam fundo com opacidade baixa (`${cor}1a`, `opacity-60`), contra a regra de design; isso fica para outra task.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Canal novo `ai:memory:page`**, em vez de mudar `ai:memory:list`. A paginação é uma função pura (`pageMemories`) sobre `listMemories({ includeArchived: true })` no main. Os testes não carregam o `better-sqlite3`, e o corpus cabe na memória do main. A tela deixa de receber o corpus inteiro.
- **Ordem igual à de hoje:** fixadas primeiro, depois a de acesso mais recente (`listMemories`).
- **25 por página.**
- **Com "Ver arquivadas" desligado**, só as ativas. **Ligado**, ativas e arquivadas juntas, como hoje.
- **A página volta para a 1** ao ligar ou desligar o filtro.
- **Depois de fixar, restaurar ou apagar**, a tela recarrega a mesma página. Se ela ficar vazia (apagou o último item da última página), volta uma.
- **MCP:** nada muda. `search_memory` já devolve no máximo 8, `list_recent_memories` já pagina (até 50) e `read_memory` lê uma por vez.

## Comportamento

- `ai:memory:page({ includeArchived, offset, limit, focusId? })` devolve `{ items, total, offset, activeCount, archivedCount }`.
  - `total` é o total do filtro atual.
  - `activeCount` e `archivedCount` são sempre de todas as memórias, como o texto e o botão da tela mostram hoje.
  - `limit` vai de 1 a 100; um valor fora disso usa 25. Um `offset` negativo vira 0. Um `offset` além do fim vira a última página.
  - `focusId`, quando pertence ao filtro, faz devolver a página que contém essa memória. Se a memória é arquivada e o filtro está desligado, a tela liga o filtro primeiro, para o alvo do Ctrl+K não sumir.
- Na tela, abaixo da lista, aparecem `Página X de Y` e os botões **Anterior** e **Próxima**, desabilitados nas pontas. Com uma página só, a barra não aparece.

## Dados

Sem mudança de dados. Nenhuma tabela, coluna, migração ou campo de backup. Só leitura.

## Telas

Tela Memória do assistente: barra de paginação no fim da lista. Ela segue os botões de texto existentes da tela (`#999999`, hover `#d4d4d4` sobre `#222227`); o desabilitado usa só opacidade, que a regra permite para esse caso.

## Perguntas em aberto

(nenhuma)
