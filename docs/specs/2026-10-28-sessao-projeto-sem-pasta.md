# Sessão de projeto sem pasta de código

Status: approved by Luis on 2026-10-28
Branch: feature/sessao-projeto-sem-pasta

## Por quê

Hoje o Fleet impede abrir uma sessão de projeto quando nenhuma pasta de código está autorizada. O mesmo app já consegue abrir sessão geral num espaço privado, mas a sessão geral perde o projeto padrão do MCP.

## Objetivos

- Abrir sessão vinculada a projeto mesmo sem pasta de código.
- Manter o projeto escolhido como escopo padrão do MCP para tarefas, notas, metas e memória.
- Usar um worktree destacado no espaço privado já usado pela sessão geral.

## Fora do escopo

- Conceder acesso a pastas de código não autorizadas.
- Aplicar alterações de código do espaço privado a um projeto.
- Mudar o comportamento de sessão com pasta autorizada.
- Criar nova pasta de dados persistidos ou mudar o formato de projeto.

## Decisões de Luis

- O espaço privado da sessão geral já existe e deve ser reutilizado.
- O main monta o worktree mesmo sem pasta; o projeto continua no MCP.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- O seletor **Pasta de código** mostra `Sem pasta de código` como opção de valor vazio mesmo quando o projeto tem raízes autorizadas. Ao escolher um projeto, uma raiz ativa continua pré-selecionada como hoje; o usuário pode optar pelo espaço privado.
- Sem raiz ativa, o painel mostra o aviso `Sem pasta de código: o agente usará um espaço privado. O MCP continuará vinculado a este projeto.` no lugar do aviso que hoje pede autorização de pasta.
- O main resolve o diretório privado quando `request.path === ''`, independentemente de `projectId`. Com caminho preenchido, valida a raiz ativa do projeto como hoje. Um caminho arbitrário recebido do renderer continua recusado.
- O espaço privado é `userData/general-agent-workspace` e seu worktree destacado é criado pela mesma rotina da sessão geral. Sessões geral e de projeto podem coexistir sem compartilhar worktree de execução.

## Comportamento

- Projeto sem raiz ativa: botão **Abrir sessão** permanece habilitado quando executor está disponível; `onStart` recebe `{ projectId, rootPath: '', harnessId }`.
- Projeto com raiz ativa: a raiz escolhida continua no seletor, e a sessão segue nela. A opção `Sem pasta de código` permite usar o espaço privado quando o usuário a selecionar.
- O main confirma que o projeto existe antes de iniciar. Um projeto removido ou inacessível gera o erro atual de projeto indisponível, sem abrir terminal.
- O main cria o espaço privado se faltar, cria worktree destacado, inicia PTY e MCP com o `projectId` capturado. O MCP continua usando esse projeto como padrão; o perfil financeiro capturado continua o mesmo.
- Uma sessão sem pasta pode produzir diff no worktree privado. O diff é apenas arquivado para revisão e não é aplicado em nenhuma pasta do usuário, como já ocorre com sessões interativas.
- Falha em criar workspace, worktree, PTY ou MCP encerra sem executor e limpa os recursos criados pela run.

## Dados

Sem alteração de schema ou backup. O workspace privado já existe em `userData`; novos arquivos nele são de trabalho do agente. Dados do projeto no SQLite permanecem no projeto original e são acessados pelo MCP com o mesmo `projectId` capturado da sessão. O renderer não decide o caminho privado.

## Telas

Somente o painel **Nova sessão de código** muda: botão disponível sem raiz e aviso curto. Nenhuma alteração de layout ou visual do terminal.

## Perguntas em aberto

(nenhuma)
