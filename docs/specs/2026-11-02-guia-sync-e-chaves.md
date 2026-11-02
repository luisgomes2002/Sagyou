# Guia da sincronização entre aparelhos e das chaves

Status: approved by Luis on 2026-11-02
Branch: feature/sync-conflitos-celular

## Por quê

O Como funciona explica como montar a sincronização, mas não como ela se
comporta no dia a dia: quando cada aparelho envia e busca, quanto tempo leva
para uma mudança aparecer do outro lado, o que é um conflito e como evitá-lo
(por exemplo, com o Claude mexendo no PC pelo MCP enquanto você usa o celular).
Também não explica, de um jeito que dê para reconhecer na tela, para que serve
cada chave (código de recuperação, autenticador, códigos reserva, senha de
configuração, código de pareamento), e o que fazer quando uma delas se perde.
O celular não tem nenhuma ajuda.

## Objetivos

1. Um artigo "Como a sincronização se comporta" e um artigo "As chaves da
   sincronização" no capítulo Sincronização e celular do Como funciona do PC.
2. Os mesmos dois textos no celular, numa tela "Como funciona a sincronização".
3. Exemplos visuais de cada chave com valores falsos, marcados como exemplo.
4. A tabela "Perdeu… → Usa…".
5. Os textos refletem o comportamento novo desta branch (tela de conflitos no
   celular, fechamento automático, envio ao sair do app).

## Fora do escopo

- Tela de recuperar a sincronização com o código de recuperação (o artigo
  "Perdi todos os aparelhos" continua dizendo que ela ainda não existe).
- Mudar o comportamento do sync.
- Central de ajuda completa no celular (só esta tela).

## Decisões (de Luis, na task)

- Exemplos com valores **falsos** e marcados como exemplo; nunca um valor real.
- Uma spec só para as duas partes.
- Onde fica no PC: capítulo "Sincronização e celular" (`guide/sync-content.ts`).
- Versão: celular MINOR; desktop PATCH ou MINOR conforme a spec.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **O texto vive no core** (`packages/core/src/sync/guide.ts`): os dois artigos
  como blocos (`p`, `steps`, `callout`, `keyExample`, `table`). O PC monta os
  artigos a partir deles e o celular renderiza os mesmos blocos, então os dois
  apps nunca dizem coisas diferentes.
- **Celular:** linha "Como funciona a sincronização" em Ajustes → Sincronização,
  que abre a tela **Como funciona** (stack raiz, título "Como funciona") com os
  dois artigos. A tela de pareamento ganha o link "Como funciona a
  sincronização" abaixo dos passos, para quem ainda não pareou.
- **Versão:** desktop vai para **1.3.0** (MINOR: artigos e visuais novos; inclui o
  PATCH 1.2.2 da outra task do mesmo PR); celular fica em **0.1.0** (já MINOR na
  outra task).

## Comportamento

### Artigo 1 — "Como a sincronização se comporta" (id `sync-comportamento`)

Blocos, nesta ordem (texto final pode ter ajuste de redação no build, sem mudar
o sentido nem os números):

1. p: "O Worker é uma caixa de correio: cada aparelho deixa ali as suas mudanças
   cifradas e busca as dos outros. Os aparelhos nunca falam direto entre si nem
   precisam estar na mesma rede."
2. steps (título implícito "Quando cada aparelho sincroniza"):
   - "PC: só com o Sagyou aberto (na bandeja também vale). Envia 5 s depois de
     salvar, envia e busca ao abrir e a cada 60 s. Sem conexão, tenta de novo
     cada vez mais devagar, até a cada 15 min."
   - "Celular: só com o app na tela. Envia e busca ao abrir ou voltar para o
     app, a cada 60 s, 5 s depois de editar e quando a internet volta. Ao sair
     do app, envia na hora o que estava esperando e para."
3. p: "Uma mudança leva de uns 5 s a pouco mais de 1 min para aparecer do outro
   lado, se os dois estiverem abertos e com internet."
4. p: "Conflito é o mesmo item alterado em dois aparelhos antes de um receber a
   mudança do outro. A versão mais recente vale nos dois, e a outra fica
   guardada por 30 dias em Conflitos para você trocar se quiser. A comparação é
   do item inteiro, não campo a campo; itens diferentes nunca conflitam."
5. p: "Cada aparelho mostra os conflitos que ele mesmo viu: no PC em
   Configurações → Sincronização → Conflitos, no celular em Ajustes →
   N conflitos. Escolher num aparelho avisa os outros, e o mesmo conflito
   fecha sozinho neles na próxima sincronização."
6. callout (tip) "Fora de casa com o Claude trabalhando no PC: o Sagyou precisa
   estar aberto no PC para o agente gravar pelo MCP e para a mudança subir.
   O celular recebe em até 1 min."
7. steps (título implícito "Como evitar conflitos"):
   - "Espere sincronizar antes de editar no celular (o status em Ajustes diz há
     quanto tempo)."
   - "Não mexa no item em que o agente está trabalhando, como uma tarefa com o
     cronômetro ligado."
   - "Deixe o Sagyou aberto no PC enquanto estiver fora."

### Artigo 2 — "As chaves da sincronização" (id `sync-chaves`)

Para cada chave, um bloco `keyExample` com: nome, exemplo falso marcado
**"Exemplo"**, e as linhas "Para que serve", "Quando é pedido", "Onde ver de
novo", "Se perder", "Se alguém pegar", "Onde guardar". Valores e textos:

| Chave | Exemplo (falso) | Para que serve | Quando é pedido | Onde ver de novo | Se perder | Se alguém pegar |
| --- | --- | --- | --- | --- | --- | --- |
| Código de recuperação | `ABCD-EFGH-…` 14 grupos de 4 (56 caracteres base32) e, na linha de baixo, `https://exemplo.workers.dev` | É a chave que cifra os dados. Volta à sincronização quando nenhum aparelho pareado sobrou. | Ao ativar (aparece uma vez, com "Guardei o código") | PC: Configurações → Sincronização → Ver código de recuperação (pede a senha do app, se houver) | Com algum aparelho pareado, veja de novo nele. Sem nenhum, os dados na nuvem ficam ilegíveis; o backup local continua valendo. | Lê seus dados se também conseguir os lotes do Worker. Desative e ative de novo num D1 novo. |
| Código do autenticador | `123 456` (6 dígitos) | Confirma ações perigosas no Worker. | Para revogar um aparelho apagando os dados e para trocar o autenticador. | No app autenticador (muda a cada 30 s) | Use um código reserva. | Sozinho não serve: só vale junto com um aparelho pareado. |
| Códigos reserva | 8 códigos como `0A1B2C3D4E5F60718293` (20 caracteres hexadecimais maiúsculos) | Substituem o código de 6 dígitos, uma vez cada. | No lugar do código do autenticador | Não dá: aparecem uma vez só, ao cadastrar o autenticador. | Cadastre o autenticador de novo para gerar outros. | Pode usar um no lugar do autenticador: troque o autenticador. |
| Senha de configuração do Worker | `exemplo-de-senha-de-setup` | Autoriza ativar a sincronização no Worker. | Ao ativar e ao recuperar | Onde você a guardou ao criar o Worker (`wrangler secret`) | Defina outra com `wrangler secret put SETUP_TOKEN`. | Com aparelhos ativos, sozinha não registra aparelho (pede a prova da chave). Troque-a. |
| Código de pareamento / QR | `sagyou-sync:1:https://exemplo.workers.dev:…:…` | Adiciona um aparelho. | Ao parear outro PC ou o celular | Gere outro em Parear novo aparelho | Gere outro; vale 10 min e uma vez só. | Expira em 10 min e serve uma vez; se suspeitar, revogue o aparelho que entrou. |

Depois, callout (warning): "Guarde o código de recuperação e os códigos reserva
fora do celular e em lugares separados: um gerenciador de senhas, ou papel."

Por fim, `table` "Perdeu… → Usa…":

| Perdeu… | Usa… |
| --- | --- |
| Um aparelho | Revogue-o em outro aparelho, apagando os dados se precisar (pede o autenticador). |
| O celular com o autenticador | Um código reserva, depois cadastre o autenticador de novo. |
| Todos os aparelhos | O código de recuperação (a tela de recuperar ainda não existe; enquanto isso, um backup). |
| O código de recuperação | Veja de novo num aparelho pareado. |
| Os códigos reserva | Cadastre o autenticador de novo. |
| A senha de configuração | Defina outra com `wrangler secret put SETUP_TOKEN`. |

### Regras dos exemplos

- Todo exemplo leva o selo "Exemplo" visível e, para leitor de tela, o rótulo
  "Exemplo de <nome da chave>, não é um valor real".
- Os valores de exemplo não passam pela validação real (o código de recuperação
  de exemplo tem checksum inválido), e um teste garante isso, para nunca virar
  um valor utilizável.
- Exemplos não têm botão Copiar.

### Celular

- Em Ajustes → Sincronização, abaixo do status e da linha de conflitos, a linha
  "Como funciona a sincronização" abre a tela **Como funciona**.
- Na tela de pareamento, o link "Como funciona a sincronização" abre a mesma
  tela.
- A tela mostra os dois artigos com títulos como cabeçalho (TalkBack navega por
  cabeçalho), nos dois temas.

## Dados

Sem mudança de dados.

## Telas

- PC: dois artigos novos no capítulo Sincronização e celular, depois de
  "Parear o celular" e antes de "Conflitos"; visual do exemplo de chave (caixa
  com fonte monoespaçada e selo "Exemplo") e tabela, no padrão do UI_DESIGN.md.
  A busca do Como funciona encontra os dois artigos.
- Celular: tela "Como funciona" (ScrollView, cartões por chave, tabela como
  lista de pares "Perdeu → Usa"), alvos de toque ≥ 48 dp.

## Perguntas em aberto

(nenhuma)
