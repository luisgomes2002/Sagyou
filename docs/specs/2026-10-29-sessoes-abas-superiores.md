# Abas superiores nas sessões de código

Status: approved by Luis on 2026-10-29
Branch: feature/sessoes-abas

## Por quê

A lista de sessões ocupa uma coluna fixa à esquerda e reduz a largura do terminal. O usuário quer navegar entre sessões por uma faixa no topo, como em um terminal com abas.

## Objetivos

- Trocar a lista lateral de sessões por abas horizontais acima da área de trabalho.
- Dar mais largura ao terminal sem mudar o funcionamento das sessões.
- Manter visíveis o acesso a uma nova sessão e o estado das sessões abertas.

## Fora do escopo

- Mudar o terminal, o inspetor, as aprovações ou o ciclo de vida dos agentes.
- Alterar a navegação principal do aplicativo ou adicionar fechamento de sessão pela aba.
- Criar histórico de sessões encerradas ou persistir uma nova preferência visual.

## Decisões do usuário

- A navegação das sessões de código deve ficar em cima, com aparência de abas de terminal, em vez de uma barra lateral à esquerda.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- Cada sessão ativa vira uma aba compacta com título abreviado e um pequeno indicador de estado; o título completo e o projeto/executor ficam disponíveis em texto de apoio acessível.
- A faixa de abas rola horizontalmente quando houver muitas sessões, sem criar rolagem horizontal na tela inteira.
- O botão **Nova sessão** fica na mesma faixa, sempre alcançável, inclusive quando a lista estiver vazia.
- A aba selecionada usa superfície grafite sólida e borda neutra; atenção aparece em um indicador pequeno, conforme `UI_DESIGN.md`.

## Comportamento

- Selecionar uma aba mostra a sessão correspondente, preservando o terminal vivo e a seleção ao navegar para outra área e voltar.
- Ao abrir uma sessão, sua aba é selecionada. Quando a sessão termina, sua aba desaparece e a seleção segue o comportamento atual: outra sessão ativa ou o painel **Nova sessão de código**.
- Clicar em **Nova sessão** mostra o formulário existente. Cancelar volta à primeira sessão ativa quando houver alguma.
- Se uma sessão pedir atenção, sua aba mostra o estado; o painel de atenção da sessão continua funcionando como hoje.
- Com nenhuma sessão ativa, a faixa ainda mostra **Nova sessão** e o painel inicial existente.
- As abas são botões acessíveis por teclado, com foco visível e nome que diferencia sessões de mesmo título.

## Dados

Sem mudança de dados persistidos, schema, backup ou IPC.

## Telas

Na área **Sessões de código**, uma faixa horizontal de abas ocupa o topo do conteúdo. O formulário ou terminal usa a largura antes tomada pela lista lateral. O cabeçalho da sessão e o inspetor continuam abaixo da faixa, como hoje. Em janela estreita, apenas a faixa de abas rola na horizontal.

## Perguntas em aberto

(nenhuma)
