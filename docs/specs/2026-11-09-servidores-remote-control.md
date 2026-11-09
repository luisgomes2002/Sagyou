# O Sagyou gerencia os servidores de Remote Control

Status: approved by Luis on 2026-11-09
Branch: feature/servidores-remote-control

Origem: tarefa "Sagyou gerencia os servidores de Remote Control (ligar/desligar pelo
celular)", sprint "Acesso remoto 3". Substitui a montagem manual "Servidores de Remote
Control por projeto no logon" (roteiro `docs/specs/2026-10-30-sync-mobile-roteiro.md`,
Decisões → "Um servidor de Remote Control por projeto, iniciado no logon").

## Por quê

Hoje cada `claude remote-control --name "<projeto>"` sobe por uma tarefa do Agendador do
Windows, montada à mão, e o Sagyou só **observa** se o servidor está rodando (para o "PC
pronto") e o **encerra** no "Cortar acesso". Longe de casa isso tem dois problemas:

- Para ligar um servidor que caiu ou que foi encerrado, não há caminho: o "Restaurar
  acesso" não sobe nada, e a tarefa do Windows só roda no logon.
- Para ter um servidor só quando precisa (menos tempo com o PC comandável pela conta
  Anthropic), é preciso cortar e restaurar o acesso inteiro, e ainda desbloquear o Sagyou.

## Objetivos

- O Sagyou **sobe e encerra** os servidores de Remote Control, um por projeto, no lugar da
  tarefa manual do Windows.
- O celular autorizado **liga e desliga** cada servidor, com biometria, sem desbloquear o
  Sagyou e sem passar por Cortar/Restaurar.
- Cada servidor pode **iniciar com o Sagyou** e volta sozinho se cair.

## Fora do escopo

- Isolar os servidores (ai-jail, devcontainer): continua experimento à parte.
- Responder pelo usuário às perguntas da primeira vez ("Enable Remote Control?",
  "Trust <pasta>?"). Decidido: só no PC.
- Servidor sem projeto (pasta solta) ou para a sessão geral.
- Escolher o modo de permissão ou o `--spawn` pelo celular.
- Mac e Linux: o recurso só aparece no Windows, como o resto do controle do PC.

## Decisões (de Luis, 2026-11-09)

1. **Origem:** cada **projeto do Sagyou** ganha a opção "Servidor de Remote Control". A
   pasta é o caminho de código ativo do projeto, e o nome do servidor é o nome do projeto
   (o que aparece no app do Claude). Projeto sem caminho de código não pode ter servidor.
2. **Com o Sagyou bloqueado:** o celular pode ligar e desligar um servidor, com biometria
   e pedido assinado. Com o acesso cortado, nunca liga.
3. **Ao abrir o Sagyou:** cada servidor tem "Iniciar com o Sagyou". Se cair, o Sagyou
   tenta de novo, com intervalo crescente.
4. **Primeira vez numa pasta:** o servidor roda num terminal do Sagyou, visível no Fleet
   como "Servidor: <projeto>", e as perguntas são respondidas ali, no PC. O Sagyou nunca
   responde por você. Pelo celular, um projeto ainda não confirmado não liga.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

1. **Comando:** `claude remote-control --name "<projeto>" --spawn worktree --permission-mode
   manual`, com `--spawn same-dir` quando a pasta não tem Git. Roda num PTY do Sagyou
   (o mesmo `agent-pty` do Fleet), com a pasta do projeto como diretório de trabalho e o
   `claude` resolvido como no Fleet. Nada de shell intermediário.
2. **"Confirmado":** um projeto fica confirmado quando o servidor dele, iniciado **no PC**
   (pela tela ou ao abrir o Sagyou), passa 60 s rodando. Fica gravado com a data. Trocar a
   pasta do projeto desfaz a confirmação.
3. **Religar depois de cair** (só com "Iniciar com o Sagyou"): espera 30 s, depois 1, 2, 4,
   8 e 15 min (teto). Depois de 10 min rodando, a espera volta para 30 s. Desligado pelo
   usuário (PC ou celular), não religa até alguém ligar de novo ou o Sagyou reabrir.
4. **Fechar o Sagyou** (Sair, atualização, desligar o PC) encerra os servidores que ele
   subiu. Na atualização, eles voltam quando a versão nova abre, se "Iniciar com o Sagyou".
5. **Servidor de fora** (tarefa antiga do Windows ainda ativa): se já há um processo com o
   mesmo `--name`, o Sagyou não sobe outro. Ele mostra "Rodando (fora do Sagyou)", e
   "Desligar" encerra esse processo com a mesma busca segura do "Cortar acesso"
   (`remoteControlTargets`, só aquele nome).
6. **Cortar acesso:** encerra todos (como hoje) e nada religa enquanto estiver cortado.
   **Restaurar acesso** religa os que têm "Iniciar com o Sagyou".
7. **Suspensão** (5 recusas seguidas): também bloqueia ligar servidor pelo celular.
   Desligar sempre passa.
8. **Mensagens novas do controle:** `server-start` e `server-stop`, corpo `{ projectId }`,
   assinadas pelo celular, válidas 60 s, nonce de uso único, pelo caminho de pedidos de um
   controle (`controllerRequest`). Um pedido para projeto desconhecido é recusado sem contar.
9. **Status:** `PcStatus.servers` ganha `projectId`, `state` (`running`, `stopped`,
   `starting`, `needs-confirm`, `external`) e `autostart`. O campo `up` continua, para o
   celular 0.5 e o "PC pronto". O "PC pronto" passa a exigir só os servidores com
   "Iniciar com o Sagyou".

## Comportamento

**No PC, Configurações → Controle remoto → "Servidores de Remote Control":**
- Uma linha por projeto ativo (não arquivado) com caminho de código. Cada linha tem
  "Servidor de Remote Control" (liga o recurso para o projeto), "Iniciar com o Sagyou",
  o estado e **Ligar**/**Desligar**.
- Estados: `Rodando`, `Parado`, `Iniciando…`, `Confirme no Fleet` (primeira vez, esperando
  as perguntas), `Rodando (fora do Sagyou)`.
- **Ligar** sobe o servidor e abre o terminal no Fleet. Na primeira vez, a linha mostra
  "Responda às perguntas do Claude no Fleet. Depois disso, o celular também liga este
  servidor."
- Projeto sem caminho de código: a linha não aparece. Abaixo da lista: "Só aparecem
  projetos com uma pasta de código."

**No Fleet:** cada servidor do Sagyou é uma aba "Servidor: <projeto>", só com o terminal
(sem diff, inspetor ou entrega). Fechar a aba não encerra o servidor; **Desligar** fica na
própria aba.

**No celular, aba PC → "Servidores":** uma linha por servidor com o estado e
**Ligar**/**Desligar** (biometria antes de mandar). Textos de recusa:
- não confirmado: **"Confirme este projeto uma vez no PC."**
- acesso cortado: **"O acesso está cortado. Restaure antes de ligar um servidor."**
- suspenso: o texto de suspensão de hoje;
- projeto desconhecido ou sem pasta: **"Este servidor não existe mais no PC."**
- falhou ao subir: **"O servidor não subiu. Veja o terminal no PC."**

**Bordas:**
- `claude` não encontrado no PC: estado `Parado` com "Claude Code não encontrado" no PC, e
  o celular recebe "O servidor não subiu. Veja o terminal no PC."
- Projeto arquivado ou excluído: o servidor é encerrado e sai da lista.
- Dois pedidos seguidos de ligar: o segundo responde ok sem subir outro.
- Controle remoto desligado no PC: os servidores continuam sob o Sagyou na tela do PC, mas
  o celular não alcança nada (como hoje).
- Nunca logar o comando inteiro, a pasta ou a saída do terminal. Logs: `remote`/
  `server_start`, `server_stop`, `server_exit` (com `code`), `server_restart`,
  `server_refused` (com `reason`), sempre com o id do projeto.

## Dados

- **Desktop, `remote-control.json`** (fora do SQLite, do backup e do sync; já existe):
  `servers` passa de lista de nomes para `[{ projectId, autostart, confirmedAt, path }]`
  (`path` é a pasta em que a confirmação valeu). Na leitura de um arquivo antigo, cada nome
  vira o projeto de mesmo nome (sem diferenciar maiúsculas), se houver exatamente um, com
  `autostart: true` e `confirmedAt: null`. Nome sem projeto é descartado e logado
  (`server_migrated` com contagem). Uma versão anterior do desktop que leia o arquivo
  novo descarta as entradas que não são texto (lista vazia) e segue funcionando.
- **Projetos:** sem campo novo; a opção fica no `remote-control.json`, porque a pasta e o
  servidor são deste PC.
- **Celular:** sem dado novo.
- **Worker:** sem mudança.

## Telas

- Desktop: a seção "Servidores de Remote Control" de Configurações → Controle remoto é
  refeita (lista de projetos em vez de nomes digitados), e o Fleet ganha a aba de servidor.
  Segue `UI_DESIGN.md`.
- Celular: seção "Servidores" na aba PC, com `ListItem` e `Button`, alvo de 48 dp.
- Guia (Como funciona): o artigo do controle remoto troca "tarefa do Windows" por esta tela.
  O roteiro e o README deixam de mandar criar a tarefa do Agendador.

## Perguntas em aberto

(nenhuma)
