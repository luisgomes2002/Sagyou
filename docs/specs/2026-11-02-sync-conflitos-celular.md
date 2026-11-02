# Conflitos no celular e envio ao sair do app

Status: approved by Luis on 2026-11-02
Branch: feature/sync-conflitos-celular

## Por quê

O celular mostra "N conflitos — resolva no PC", mas cada aparelho guarda só os
conflitos que ele mesmo detectou (`sync_conflicts` é local). O PC não vê os
conflitos do celular, e resolver no PC não fecha os do celular (`resolved_at` só
é marcado por `engine.resolve` no próprio aparelho). Um conflito de dívida
(`pending_choice`) detectado no celular não tem como ser decidido em lugar
nenhum. Além disso, ao ir para segundo plano o celular chama `engine.stop()`,
que limpa os timers: uma edição feita menos de 5 s antes de sair só é enviada
na próxima abertura — e é justamente isso que gera conflitos com o PC.

## Objetivos

1. O celular lista os conflitos dele e deixa escolher a versão ou dispensar,
   como o PC já faz.
2. Um conflito aberto fecha sozinho quando o mesmo item é resolvido (ou segue
   adiante) em outro aparelho — no celular e no PC.
3. O que está pendente no celular é enviado ao ir para segundo plano.
4. Sai o texto "resolva no PC".

## Fora do escopo

- Juntar campo a campo duas versões (a comparação segue sendo do item inteiro).
- Sincronizar a lista de conflitos entre aparelhos (cada aparelho continua com
  a sua; o fechamento automático é que evita o retrabalho).
- Envio em segundo plano de verdade (tarefa agendada do Android). Se o sistema
  congelar o app antes de o envio terminar, ele sai na próxima abertura, como
  hoje.
- Mudanças no guia "Como funciona" (é a outra task da sprint).

## Decisões (de Luis)

- Resolver **sempre** envia uma versão nova do item, inclusive quando a escolha é
  manter a versão atual (mesmo conteúdo, versão nova por cima da vencedora). O
  outro aparelho fecha o conflito ao recebê-la.
- Uma edição comum feita em outro aparelho por cima da versão vencedora também
  fecha o conflito (o item "seguiu adiante").
- Versão: celular MINOR (0.0.2 → 0.1.0); desktop PATCH (1.2.1 → 1.2.2), porque o
  item 2 muda o comportamento dele também.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- A tela de conflitos do celular é uma tela própria do stack raiz
  (`Conflitos`), aberta pela linha "N conflitos" em Ajustes → Sincronização.
- Os textos copiam os do PC ("Versão deste aparelho", "Versão de <aparelho>",
  "Usar esta", "Dispensar", "Removido: o item de origem foi apagado em outro
  aparelho") para os dois apps falarem igual. Os helpers de exibição já estão no
  core (`syncKindLabel`, `recordName`, `versionLines`).
- Envio ao sair: ao ir para segundo plano, o celular cancela a espera de 5 s e
  roda **um** ciclo (envia e busca) antes de parar os timers; o mesmo vale para
  `dispose`. Não há nova tentativa em segundo plano.
- A regra de fechamento mora no core (`apply.ts`/engine) e cada armazenamento
  (SQLite do PC e do celular) só grava `resolved_at`.

## Comportamento

### Tela de conflitos (celular)

- Em Ajustes → Sincronização, com conflitos abertos, aparece a linha
  "1 conflito" / "N conflitos" com seta; tocar abre a tela **Conflitos**.
  Sem conflitos, a linha não aparece. O app em modo só leitura (desconectado)
  não mostra a linha.
- Cada conflito mostra o tipo e o nome do item (ex.: "Tarefa: Comprar pão") e:
  - `lww` / `pending_choice`: dois cartões, "Versão deste aparelho · <data>" e
    "Versão de <nome do aparelho> · <data>", com as linhas de `versionLines`
    (ou "Apagado") e um botão "Usar esta" em cada.
  - `orphan`: "Removido: o item de origem foi apagado em outro aparelho" e o
    botão "Dispensar".
- Ao escolher, o conflito some da lista e aparece o snackbar "Versão escolhida."
  (ou "Conflito dispensado."). Em erro, o snackbar mostra a mensagem do engine
  (ex.: "Não foi possível usar esta versão.") e o conflito continua na lista.
- Lista vazia (tudo resolvido, ou fechado sozinho enquanto a tela estava aberta):
  estado vazio "Nenhum conflito" com o texto "Quando o mesmo item mudar em dois
  aparelhos, as duas versões aparecem aqui." A lista recarrega quando o status
  do sync muda.
- Enquanto uma escolha está em andamento, os botões ficam desabilitados.

### Resolver envia (core: PC e celular)

- "Usar" a versão guardada: como hoje (adota a versão guardada, que vira uma
  versão nova e é enviada).
- Manter a versão atual (`lww`): agora também cria uma versão nova do item com
  o mesmo conteúdo, por cima da vencedora, e a envia. Antes não enviava nada.
- `pending_choice`: como hoje (manter este lado já reenvia por cima da outra).
- `orphan` / Dispensar: não envia nada (o item não existe mais aqui).

### Fechar sozinho (core: PC e celular)

- Ao receber uma versão de um item que tem conflito aberto, o conflito é
  marcado como resolvido quando essa versão é mais nova que a atual e **não**
  gera conflito novo — ou seja, foi feita por cima da versão atual deste
  aparelho, ou tem o mesmo conteúdo dela.
- Se a versão recebida gerar um conflito novo, o antigo continua aberto e o novo
  entra na lista.
- Conflitos `orphan` não fecham sozinhos (o item não existe aqui).
- O fechamento automático não envia nada (evita eco entre aparelhos).
- O contador ("N conflitos" no celular, a seção Conflitos no PC) atualiza no
  mesmo status que já é publicado depois de cada busca.

### Envio ao sair do app (celular)

- Ao ir para segundo plano, com sync ativo e não pausado: o celular roda um
  ciclo imediato (envia o pendente e busca) e depois para os timers. Sem rede
  ou com erro, só para; o pendente continua na fila.
- Voltar para o app antes de o ciclo terminar não dispara um segundo ciclo em
  paralelo (o engine já serializa).

### Texto

- Sai "resolva no PC". A linha passa a ser "1 conflito" / "N conflitos".

## Dados

Sem mudança de dados. Nenhuma tabela ou coluna nova: o fechamento grava
`resolved_at` na `sync_conflicts` que já existe (PC e celular). A versão a mais
enviada ao manter a versão atual usa o formato de registro de sempre; aparelhos
com a versão antiga a recebem como um "mesmo conteúdo, versão mais nova" e só
adotam a versão (sem conflito). Os vetores de `sync-vectors.json` não mudam.

## Telas

- Celular: linha "N conflitos" tocável em Ajustes → Sincronização; tela nova
  **Conflitos** (cabeçalho "Conflitos", lista de cartões, estado vazio,
  snackbar), nos dois temas, alvo de toque ≥ 48 dp, TalkBack lê cada cartão como
  grupo ("Versão deste aparelho, <data>") e os botões com o nome da versão.
  Segue o design system do app (Card, Button, EmptyState, Snackbar).
- PC: nenhuma tela muda; só passa a ver conflitos fecharem sozinhos.

## Perguntas em aberto

(nenhuma)
