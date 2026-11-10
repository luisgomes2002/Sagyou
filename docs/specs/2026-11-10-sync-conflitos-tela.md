# Tela de conflitos do sync, campo a campo (PC e celular)

Status: approved by Luis on 2026-11-10
Branch: feature/sync-conflitos-tela
Task: "Refazer a tela de conflitos do sync (PC e celular)"
Antes: `docs/specs/2026-11-02-sync-conflitos-celular.md` (tela do celular, fechar sozinho)

## Por quê

A tela de conflitos (desktop: Configurações → Sincronização → Conflitos; celular:
Ajustes → "N conflitos") é difícil de entender e de decidir. Caso real: a task
"Coletor — Remotive devolve só 12 vagas" mudou neste PC (22:36) e no Dell
(18:43). Só a descrição, o `timeSpent` e a `order` diferiam, mas a tela mostrava:

- campos crus em inglês (`title`, `timeSpent`, `order`, `createdAt`) e valores
  técnicos (ISO, segundos);
- o que é igual misturado com o que mudou, com o mesmo peso;
- a descrição cortada com "…" justamente na parte que difere (`versionLines`
  corta em 80 caracteres e mostra no máximo 6 campos);
- só "Usar esta" para a versão inteira: ficar com a descrição de um lado e o
  tempo do outro era impossível sem editar à mão depois;
- nada dizia qual versão é a mais recente nem o que cada botão faz.

## Objetivos

1. Mostrar primeiro só os campos que diferem, com nome em português e valor
   legível. Os iguais ficam recolhidos em "Igual nos dois".
2. Texto longo aparece inteiro, com o trecho diferente destacado.
3. Escolher campo a campo e salvar uma versão mesclada; atalhos para ficar com
   uma versão inteira.
4. Já vir marcada uma sugestão segura (a mais recente, mas o maior tempo gasto).
5. Mesmos textos e regras no PC e no celular, vindos de `packages/core`.

## Fora do escopo

- Renomear aparelhos ou trocar o nome mostrado ("Dell", hostname): a tela usa o
  nome que o aparelho já tem na lista de aparelhos.
- Mesclar automaticamente sem perguntar (o sync continua decidindo por HLC e
  guardando a perdedora, como hoje).
- Escolher partes de um mesmo texto (metade da descrição de cada lado).
- Sincronizar a lista de conflitos entre aparelhos (continua local; fecha
  sozinha como na spec de 2026-11-02).
- Mudar quanto tempo um conflito fica guardado (30 dias).

## Decisões (de Luis, 2026-11-10)

- **Escolha por campo já nesta spec**, em todos os tipos (com as exceções em
  "Decisões do construtor").
- **Pré-seleção**: cada campo diferente vem marcado com o valor da versão mais
  recente (maior HLC), **exceto o tempo gasto** (`timeSpent`), que vem com o
  maior valor. Quando o maior tempo é da versão mais antiga, a tela avisa.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Unidade de escolha = campo de primeiro nível do payload** do registro
  (`title`, `description`, `tags`, `images`…), na lista de campos que o sync já
  usa por tipo (`extractDataRecords`). Listas (`tags`, `images`, `taskIds`) são
  um campo só: escolhe-se a lista de um lado, nunca item a item.
- **Campos fora da escolha**: `id` (igual nos dois por definição) e `updatedAt`
  (fica fora do hash; a versão mesclada recebe o `updatedAt` de agora). Os
  campos de referência entre registros (`projectId`, `columnId`, `sprintId`,
  `taskId`, `tableId`…) **entram** na escolha (mover de coluna é uma mudança
  real), mostrados pelo nome do item quando o app o encontra, senão
  "(item não encontrado)".
- **Sem escolha por campo** (só a versão inteira, como hoje, com a tela nova de
  leitura):
  - `financial_debt` (conflito `pending_choice`): o saldo restante está amarrado
    às transações de pagamento; misturar campos pode deixar o saldo fora da
    soma dos pagamentos.
  - um lado apagado (`deleted`) e o outro não: não há campos para misturar.
  - conflitos `orphan`: continuam só com "Dispensar".
  - `memory`: a memória tem regras próprias (`buildMemory`, scrub de segredos)
    e é editada fora do store; escolher a versão inteira basta.
- **Destaque de diferença em texto**: diff por palavras feito no core (sem
  dependência nova), só para campos de texto com mais de 80 caracteres ou com
  quebra de linha. Acima de 4000 palavras somadas, não calcula o diff e só
  marca o campo inteiro como diferente.
- **Escrita da versão mesclada**: o engine monta um `WireRecord` com o payload
  escolhido e o grava pelo mesmo caminho de "usar a versão guardada" de hoje
  (`store.adoptSyncVersion`): no desktop vai por `persistDiff` e gera versão
  nova; no celular vai pelo `adoptSyncVersion` de `src/data/sync-store.ts`
  (grava a linha e chama `captureVersions`). Se o resultado for igual a uma das
  versões, o engine trata como a escolha daquela versão inteira (mesmo caminho
  de hoje, mesmo envio aos outros aparelhos).
- **Lugar no desktop**: continua em Configurações → Sincronização →
  Conflitos; cada conflito vira um cartão que abre a comparação.

## Comportamento

### Lista de conflitos (os dois apps)

- Cada conflito mostra o tipo e o nome do item como hoje ("Task: Coletor —
  Remotive devolve só 12 vagas"), mais uma linha:
  "<N> campos diferentes · mais recente: <aparelho>" (`1 campo diferente` no
  singular). Para `orphan`, a linha de hoje: "Removido: o item de origem foi
  apagado em outro aparelho" + **Dispensar**.
- Tocar/clicar no cartão abre a comparação (no celular, tela nova do stack raiz
  `Conflito`; no desktop, o cartão expande no lugar).
- Estado vazio, textos de sucesso e de erro: os de hoje ("Nenhum conflito",
  "Versão escolhida.", "Conflito dispensado.", mensagem do engine).

### Comparação

- Cabeçalho com as duas versões: "Este aparelho · <data e hora local>" e
  "<nome do outro aparelho> · <data e hora local>". A mais recente leva o selo
  **Mais recente**. Hora desconhecida → "hora desconhecida" (texto de hoje).
- **Campos diferentes** primeiro, na ordem da lista de campos do tipo. Cada um
  mostra o nome em português e os dois valores, um embaixo do outro, cada valor
  com seu seletor (rádio) "Este aparelho" / "<outro aparelho>".
- Campo que só existe de um lado (o outro não tem valor): o lado vazio mostra
  "(vazio)" e o outro, o selo "Só em <aparelho>".
- **Igual nos dois**: seção recolhida com o número de campos
  ("Igual nos dois (9)"); ao abrir, lista nome e valor, sem seletor.
- Texto longo: inteiro, sem corte, com as palavras que só existem naquele lado
  destacadas (fundo de destaque do tema + sublinhado, para não depender só da
  cor). Leitor de tela lê o texto inteiro e, antes dele, "Trecho diferente
  destacado".
- Pré-seleção: cada campo diferente vem marcado com a versão mais recente;
  `timeSpent` vem com o maior valor. Se o maior tempo é da versão mais antiga,
  aparece sob o campo: "Marcamos o maior tempo para não perder tempo do
  cronômetro."
- Botões no fim:
  - **Salvar escolha**: grava a combinação marcada. Sucesso → "Versão
    escolhida." e o conflito some da lista.
  - **Ficar com a mais recente** e **Ficar com a deste aparelho** (este último
    some quando este aparelho já é o mais recente; aí o outro botão vira
    **Ficar com a de <outro aparelho>**): marcam todos os campos daquele lado e
    salvam na hora.
- Tipos sem escolha por campo (dívida, um lado apagado, memória): mesma leitura
  (campos em português, diferenças primeiro, texto inteiro), sem rádios; só os
  botões de versão inteira: **Usar a deste aparelho** / **Usar a de
  <aparelho>**. Um lado apagado mostra "Apagado" no lugar dos campos.
- Explicação fixa no topo da comparação (uma linha, `muted`): "O mesmo item
  mudou em dois aparelhos antes de um receber a mudança do outro. Escolha o que
  fica; a escolha vai para todos os aparelhos."

### Regras da gravação

- Salvar sempre cria uma versão nova a partir da versão atual deste aparelho,
  passa pela validação normal do app (no desktop, o mesmo `persistDiff`) e é
  enviada aos outros aparelhos como qualquer edição. O outro aparelho fecha o
  conflito dele sozinho ao recebê-la (regra de 2026-11-02, inalterada).
- Se o conflito fechou sozinho enquanto a comparação estava aberta (chegou uma
  versão nova), **Salvar escolha** responde "Este conflito já foi resolvido em
  outro aparelho." e a comparação fecha sem gravar.
- Se a versão atual do item mudou desde que a comparação abriu (edição local
  ou recebida), a comparação recarrega com os valores novos e avisa "O item
  mudou enquanto você comparava. Confira de novo." sem gravar.
- Campos que só um lado tem nunca somem por omissão: todo campo do item (menos
  `id` e `updatedAt`) aparece na comparação, inclusive `images` ("3 imagens"), e
  só sai da versão mesclada se o lado "(vazio)" for escolhido de propósito.
- Uma escolha que falha (pai apagado, validação) mostra a mensagem do engine
  ("Não foi possível usar esta versão.") e o conflito continua aberto.
- Celular em modo só leitura (`readOnly`) ou bloqueado (`useLockState.hidden`):
  a comparação não abre / fecha, como os outros formulários.

### Nomes e valores (core, `sync/conflict-view.ts`)

- Tabela de rótulos em português por tipo e campo (ex.: task: Título,
  Descrição, Prioridade, Prazo, Sprint, Tempo gasto, Posição na coluna, Coluna,
  Projeto, Criada em, Concluída em, Tags, Imagens). Um campo sem rótulo cai em
  um rótulo genérico a partir do nome (`camelCase` → "Camel case"), nunca some.
  Um teste falha se um campo de `extractDataRecords` não tiver rótulo.
- Valores: tempo em segundos → "2 h 05 min" / "45 min" / "30 s"; datas e
  horários ISO → data/hora local pt-BR; data pura (`AAAA-MM-DD`) → "10/11/2026";
  booleano → "Sim"/"Não"; prioridade pelo rótulo do app (Baixa/Média/Alta/
  Urgente); valores em dinheiro → o texto decimal com vírgula, sem converter
  moeda; listas → itens separados por vírgula, imagens como "3 imagens";
  `order` → "Posição 4" (1-based); vazio → "(vazio)".

## Dados

Sem mudança de dados. Nenhuma tabela, coluna ou arquivo novo; nada novo no
backup. `sync_conflicts` continua igual; a versão mesclada é uma versão comum
em `sync_records` (desktop) / `records` (celular), criada pelo caminho de
adoção que já existe. Os vetores de `sync-vectors.json` não mudam (formato no
fio e hash inalterados). API do engine: `resolve(conflictId, choice)` passa a
aceitar também uma escolha por campo; a forma antiga (`'local' | 'remote'`)
continua valendo.

## Telas

- **Desktop** (`SyncSettings.tsx`, seguindo `UI_DESIGN.md`): cartões na
  subseção Conflitos; o cartão aberto mostra a comparação descrita acima, com
  rádios por campo e os botões no rodapé do cartão. Teclado: Tab percorre os
  rádios, Enter/Espaço escolhe; o cartão aberto recebe foco.
- **Celular**: `ConflictsScreen` vira a lista; tela nova `Conflito` (stack
  raiz) com a comparação, botões fixos no rodapé, alvos de 48 dp, rótulos de
  acessibilidade em cada rádio ("Descrição: usar a de Dell"), sem cor solta
  (`theme.ts`), `a11y.test.tsx` cobrindo a tela nova.
- Versões: desktop MINOR, celular MINOR.

## Perguntas em aberto

(nenhuma)
