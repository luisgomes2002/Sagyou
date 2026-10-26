# Memórias no grafo e fim dos nós soltos

Status: approved by Luis on 2026-10-26
Branch: feature/grafo-memorias

## Por quê

O grafo (`GraphView` + `utils/graph-layout.ts`) não mostra as memórias salvas, que hoje
são o único contexto durável dos agentes. Ver quais memórias pertencem a cada projeto, e
quais são gerais, exige abrir a tela de Memória e ler uma lista.

Além disso, o grafo deixa nós sem nenhuma ligação: hábitos nunca recebem aresta e
arquivos sem projeto ficam soltos. Metas sem projeto são presas ao **primeiro projeto da
lista**, uma ligação falsa que sugere um vínculo inexistente.

## Objetivos

1. Cada memória ativa aparece como nó, ligada ao seu projeto.
2. Memórias que compartilham tags se ligam entre si.
3. Um nó central **Geral** recebe tudo o que não pertence a nenhum projeto: memórias globais,
   hábitos, arquivos sem projeto e metas sem projeto. Nenhum nó fica sem ligação.
4. A ligação falsa da meta sem projeto ao primeiro projeto deixa de existir.
5. A paleta do grafo inteiro passa a usar tons sóbrios (regras de design do usuário).

## Fora do escopo

- Memórias arquivadas no grafo.
- Criar, editar, fixar ou apagar memória a partir do grafo.
- Qualquer mudança no modelo de memória, nas tags ou no MCP.
- Ligar hábitos ou metas por semelhança de texto/tags.
- Persistir posições dos nós.

## Decisões (de Luis)

- Itens sem projeto se prendem a um nó **Geral**, e memórias também se ligam entre si por
  tags em comum (opção C).
- Entram só as memórias **ativas**, **incluindo** os handoffs (opção A).
- A paleta do grafo inteiro é trocada por tons sóbrios neste mesmo trabalho (opção A).

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- Ligação por tag vale entre **quaisquer** memórias ativas (geral↔geral, geral↔projeto,
  projeto↔projeto), não só entre as gerais.
- Para o grafo não virar novelo, cada memória recebe **no máximo 3** ligações por tag:
  as memórias com mais tags em comum; empate desfeito pela `updatedAt` mais recente e,
  por fim, pelo `id`. Uma ligação conta para os dois lados e nunca é duplicada.
- Tags comparadas sem diferenciar maiúsculas/minúsculas e sem espaços nas pontas.
- Handoffs não participam das ligações por tag (são registros automáticos e repetem
  o mesmo formato em todo projeto); ligam-se só ao projeto ou ao Geral.
- Memória cujo `projectId` não existe mais (projeto removido) liga-se ao **Geral**.
  Memória de projeto arquivado liga-se ao projeto, como as tasks já fazem.
- O nó Geral só existe quando há pelo menos um item ligado a ele.
- Duplo clique numa memória abre a tela Memória com ela destacada (reaproveita o
  `searchTargetId` que `MemoryView` já aceita). Duplo clique no Geral não faz nada.
- As memórias são lidas por `ai:memory:list` (sem arquivadas) quando o grafo abre;
  elas não entram no Zustand. Se a leitura falhar, o grafo aparece sem memórias e mostra
  o aviso "Não foi possível carregar as memórias." no rodapé; o resto do grafo funciona.
- Nova paleta (cores sólidas, dessaturadas):

  | Nó / aresta            | Hoje      | Novo      |
  | ---------------------- | --------- | --------- |
  | Projeto                | `#a78bfa` | `#7d6fc0` |
  | Task                   | `#60a5fa` | `#5b84b8` |
  | Task concluída         | `#3b6f9f` | `#3d5878` |
  | Nota                   | `#fbbf24` | `#c09a4a` |
  | Nota concluída         | `#a87916` | `#7f6732` |
  | Meta                   | `#f472b6` | `#b86a8e` |
  | Hábito                 | `#4ade80` | `#4f9a6c` |
  | Arquivo                | `#fb923c` | `#b87a4a` |
  | Memória (novo)         | —         | `#5a9ea0` |
  | Geral (novo)           | —         | `#8a8a94` |
  | Aresta explícita/seta  | `#7c3aed` | `#6d5bb8` |
  | Aresta por tag (nova)  | —         | `#4a7a7c` |
  | Foco do campo de busca | `#7c3aed` | `#6d5bb8` |

  A seta deixa de usar `opacity`; as transparências restantes (esmaecer o que não está em
  destaque e o anel de hover) são funcionais e ficam.

## Comportamento

- **Nó de memória:** rótulo = título da memória (cortado em 25 caracteres como os demais).
  Tooltip mostra o tipo "Memória" e o título. Raio base 7, crescendo com as conexões como
  os outros nós.
- **Aresta memória → projeto / Geral:** estrutural (tracejada, cinza `#555`).
- **Aresta memória ↔ memória por tag:** tipo novo `tag`, linha contínua fina na cor
  `#4a7a7c`, sem seta, distância de mola entre a explícita e a estrutural.
- **Nó Geral:** rótulo "Geral", raio base de projeto, rótulo sempre visível. Ligam-se a ele,
  com aresta estrutural: memórias globais (e as de projeto removido), todos os hábitos,
  arquivos sem projeto (ou de projeto removido) e metas sem projeto (ou de projeto removido).
  Ele aparece na lista lateral, acima dos projetos, e o clique centraliza nele.
- **Nenhum nó solto:** depois de montado, todo nó tem pelo menos uma aresta. Um teste
  verifica isso para uma base com cada tipo de item, com e sem projeto.
- **Legenda:** ganha "Memória" e "Geral".
- **Busca "Buscar nó...":** encontra memórias e o Geral pelo rótulo, como os demais.
- **Contador do rodapé** ("N nós · M conexões") inclui memórias, Geral e suas arestas.
- **Estado vazio:** o grafo só mostra "Nenhum dado para exibir" quando não há nenhum
  item **e** nenhuma memória. O texto passa a ser "Crie projetos, tasks, notas, adicione
  arquivos ou salve memórias".
- **Atualização:** memórias são relidas cada vez que a tela do grafo é aberta. Mudanças
  feitas por um agente com o grafo aberto aparecem ao reabrir a tela.

## Dados

Sem mudança de dados. Nada novo é persistido; o grafo só lê `ai:memory:list`, canal que já
existe. Backup, SQLite e MCP não mudam.

## Telas

Só a tela do grafo muda: nós e arestas novos, legenda com dois itens a mais, item "Geral"
na lista lateral e paleta sóbria. Segue `UI_DESIGN.md` e as regras pessoais (sem neon, sem
brilho, sem preenchimento com opacidade).

Documentação: atualizar a linha do grafo em `CLAUDE.md`/`GUIDE.md` se houver, e o
`README.md` na parte do grafo.

## Perguntas em aberto

(nenhuma)
