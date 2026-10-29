# Aviso de encerramento do aplicativo

Status: approved by Luis on 2026-10-29
Branch: feature/animacao-fechamento

## Por quê

Ao pedir para fechar o Sagyou, a janela permanece visível e sem resposta aparente por alguns segundos antes de desaparecer. O processo principal espera o salvamento dos dados e tem um timeout de segurança, mas o renderer ainda não responde ao evento de fechamento. A pessoa não sabe se o clique funcionou.

## Objetivos

- Mostrar imediatamente que o Sagyou está fechando, com uma animação discreta e o texto **Fechando Sagyou…**.
- Concluir o salvamento do estado antes de fechar a janela quando o renderer estiver respondendo.
- Manter um limite de espera para que uma falha do renderer não deixe a janela presa para sempre.

## Fora do escopo

- Mudar o formato dos dados, o banco, o backup ou o comportamento dos timers de agentes.
- Adicionar uma confirmação para fechar ou permitir cancelar o fechamento.
- Adicionar dependência de animação.

## Decisões do usuário

- Ao fechar o app, mostrar uma animação ou aviso de que ele está fechando, pois a janela parece travada antes de desaparecer.
- Criar uma task no Sagyou, abrir um PR e concluir a task com o tempo gasto somente se o PR passar.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- Usar um aviso de tela inteira em grafite, com spinner discreto, sem ocultar ou destruir a janela antes do salvamento.
- O texto informa somente o estado de fechamento; não promete que o salvamento terminou.
- Considerar o PR aprovado para concluir a task apenas quando as verificações obrigatórias do PR estiverem verdes. O merge continua sob decisão humana.

## Comportamento

- O botão de fechar e o fechamento pelo sistema entram no mesmo fluxo.
- No primeiro pedido de fechamento, a janela mostra **Fechando Sagyou…** e bloqueia novas interações. Cliques repetidos em fechar não reiniciam o timeout.
- O renderer descarrega o estado pendente. Depois da confirmação, o processo principal fecha a janela. Se o renderer não responder, o timeout de segurança atual permite o fechamento.
- Se o salvamento falhar, o aviso informa **Não foi possível salvar os dados. Aguarde o fechamento.** O fechamento segue pelo timeout de segurança; a falha não é apresentada como sucesso.
- A animação respeita a preferência de movimento reduzido do sistema.

## Dados

Sem mudança de dados persistidos, schema, backup ou formato de arquivos. O fluxo de fechamento deve preservar o handshake assíncrono do processo principal.

## Telas

Uma camada de tela inteira cobre o conteúdo durante o fechamento. Fundo `#0b0b0f`, texto claro e indicador pequeno em roxo `#a080f0`, conforme `UI_DESIGN.md`. A mensagem de erro usa texto curto e acessível.

## Perguntas em aberto

(nenhuma)
