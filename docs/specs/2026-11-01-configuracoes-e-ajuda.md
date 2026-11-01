# Configurações e Como funciona reformulados

Status: approved by Luis on 2026-11-01
Branch: feature/configuracoes-e-ajuda

## Por quê

- **Configurações** é uma coluna comprida de cartões iguais. A Sincronização ocupa metade da tela (874 linhas sozinha), itens sem relação ficam juntos (Senha ao lado de Atualização) e há um cartão que não serve para nada (Criptografia, que só diz que não está ativa). É difícil achar as coisas, e o visual não agrada.
- **Sincronização** não tem nenhuma explicação dentro do app. Para publicar o Worker na Cloudflare, parear o celular, cadastrar o autenticador ou recuperar um aparelho perdido, é preciso ler o README.
- **Como funciona** está desatualizado: ainda explica o chat que foi removido e não fala de Sessões de código, MCP, sincronização, celular nem atualização. É texto corrido, sem busca, sem destaque visual e sem caminho até as telas que descreve.

## Objetivos

1. Configurações com um menu lateral interno: uma seção por vez, agrupadas por assunto, com visual consistente e nada que não sirva para nada.
2. Um capítulo de Sincronização no Como funciona que leve alguém do zero (sem conta Cloudflare) até PC e celular sincronizando, e que cubra perder um aparelho e recuperar a chave.
3. Como funciona virando uma central de ajuda: índice com busca, artigos com passos numerados e avisos destacados, conteúdo atualizado e um botão "Abrir esta tela" em cada artigo.

## Fora do escopo

- Mudar o comportamento de qualquer configuração ou da sincronização. Os controles fazem exatamente o que fazem hoje; só mudam de lugar e de visual.
- Configurações novas e remoção de configurações reais (sai só o cartão informativo de Criptografia).
- O app do celular (`apps/mobile`): nenhuma tela dele muda. O guia apenas explica como parear o celular.
- Capturas de tela e vídeos no guia.
- Tradução para outros idiomas.
- O conteúdo do `README.md` sobre o servidor continua lá; o guia não o substitui para quem lê no GitHub.

## Decisões (de Luis)

- **Ordem do trabalho:** a spec sai agora; a reformulação de Configurações só começa a ser construída **depois que o PR #36 (motor na bandeja) entrar no `main`**, já contando com as seções de bloqueio automático e janela/bandeja que ele adiciona. O Como funciona (itens 2 e 3) pode ser construído antes.
- **Tasks:** uma task por mudança no projeto do Sagyou dentro do próprio app (via MCP), ligada ao plano.
- **Configurações:** menu lateral interno (lista de seções à esquerda, uma seção por vez à direita). Resolver os quatro incômodos: achar as coisas, visual, ordem/agrupamento e itens inúteis.
- **Explicação da sincronização:** fica no Como funciona, como capítulo próprio, com um atalho "Como funciona a sincronização" em Configurações → Sincronização. Profundidade: do zero ao uso, ou seja, conta Cloudflare e publicação do Worker incluídas.
- **Como funciona:** central de ajuda (índice com busca à esquerda, artigo à direita, passos numerados, avisos destacados, "Abrir esta tela"), com o mesmo esqueleto visual das novas Configurações. Resolver conteúdo desatualizado, navegação, visual e falta de atalhos.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Seções de Configurações, nesta ordem:**
  1. **Geral:** nome (Perfil).
  2. **Aparência:** tema, tamanho do texto e opções de acessibilidade.
  3. **Barra lateral:** áreas visíveis.
  4. **Segurança:** senha do app e bloqueio automático (do #36).
  5. **Sincronização:** o conteúdo atual de `SyncSettings`, dividido em blocos com títulos (Este aparelho, Aparelhos, Autenticador, Conflitos, Avançado). Os controles e os textos de cada ação não mudam.
  6. **Sistema:** janela e bandeja (do #36) e atualização do app.
  7. **Sobre:** versão do app e atalho para o Como funciona.
- O cartão **Criptografia** sai. Ele não tinha controle e só dizia que a função não existe.
- Configurações sempre abre em **Geral**. A seção aberta não é lembrada entre aberturas: fica só na memória da tela, sem persistir nada.
- **Capítulos do Como funciona:**
  1. Primeiros passos: o que é o Sagyou, a barra lateral, Ctrl+K e onde ficam os dados.
  2. Projetos e tarefas: board, tarefas, cronômetro, sprints, Próximas e Concluídas.
  3. Organização: Planejamento, Canvas, Grafo e Arquivos.
  4. Metas e hábitos, com Relatórios.
  5. Financeiro: o conteúdo atual, reorganizado.
  6. Sessões de código: CLIs (Codex, Claude Code, OpenCode), pasta isolada, MCP e aprovações, memória e o resumo da sessão.
  7. Sincronização e celular (ver Comportamento).
  8. Dados e segurança: backup, senha, atualização automática e registro de diagnóstico.
- O tópico "Chat e contexto" sai; o que ainda vale (memória) vai para Sessões de código.
- O conteúdo do guia vira dados num módulo próprio, separado do componente, para ser testado (por exemplo, para garantir que todo "Abrir esta tela" aponta para uma tela que existe).
- O capítulo de Sincronização traz um diagrama simples (PC ↔ seu Worker ↔ celular, com o cadeado indicando que tudo trafega cifrado), desenhado em SVG/CSS no próprio app, sem imagem externa.

## Comportamento

### Configurações

- À esquerda, a lista das 7 seções, com ícone e nome; a seção ativa fica destacada. À direita, o título da seção, uma frase dizendo para que ela serve e os controles.
- Teclado: a lista é navegável com Tab e com as setas ↑/↓; Enter ou espaço abre a seção. O foco vai para o título da seção aberta.
- A seção Sincronização ganha, no topo, o link **"Como funciona a sincronização"**, que abre o Como funciona direto no capítulo 7.
- A seção Sobre mostra `Versão <x.y.z>` e o botão **"Abrir o Como funciona"**.
- Todos os controles existentes continuam lá, com os mesmos textos, validações, toasts e estados de carregando/erro. Nenhum controle some além do cartão Criptografia.
- Janela estreita: abaixo da largura em que as duas colunas não cabem, a lista vira uma faixa de seções no topo, com rolagem horizontal.

### Como funciona

- À esquerda: campo **"Buscar no guia"** e a lista de capítulos, cada um com seus artigos. À direita: o artigo aberto.
- Um artigo pode ter parágrafos, **passos numerados**, **avisos** (três tipos: dica, atenção, perigo), **blocos de comando** com botão **Copiar** e o botão **"Abrir esta tela"**.
- **Busca:** filtra artigos pelo título e pelo texto enquanto se digita, sem diferenciar maiúsculas nem acentos ("sincronizacao" acha "Sincronização"). Sem resultado: "Nada encontrado para "<termo>"." e o botão **Limpar busca**. Esc limpa a busca.
- **Copiar:** copia o comando para a área de transferência e mostra "Copiado" por 2 s. Se a cópia falhar: "Não foi possível copiar."
- **"Abrir esta tela":** leva até a tela descrita. Se for uma seção de Configurações, abre direto nela. Se a área estiver oculta na barra lateral, o botão fica desativado, e ao lado aparece "Esta área está oculta na barra lateral." com o link **"Mostrar em Configurações"**, que abre Configurações → Barra lateral.
- O Como funciona abre no primeiro artigo de Primeiros passos, ou no capítulo pedido quando chamado por um atalho (Sincronização, Sobre).

### Capítulo Sincronização e celular (conteúdo mínimo)

1. **O que é e o que o servidor vê:** a sincronização usa um servidor seu (Worker + D1 da Cloudflare, plano gratuito). Tudo sai do aparelho cifrado. O servidor vê só ids opacos, lotes cifrados e números; a chave nunca sai dos aparelhos.
2. **Criar o servidor na Cloudflare:** criar a conta; ter o Node instalado; obter a pasta `sync-server/` do repositório; e os comandos do README, cada um num bloco com Copiar: `npm install`, `npx wrangler login`, `npx wrangler d1 create sagyou-sync` (com o aviso de copiar o `database_id` para o `wrangler.toml`), `npx wrangler d1 execute sagyou-sync --remote --file schema.sql`, `npx wrangler secret put SETUP_TOKEN`, `npx wrangler secret put TOTP_ENC_KEY` (com o comando que gera a chave de 32 bytes) e `npx wrangler deploy`. Aviso de atenção: guarde `SETUP_TOKEN` e `TOTP_ENC_KEY` fora do repositório.
3. **Ativar no primeiro PC:** URL do Worker + `SETUP_TOKEN` → Ativar. Aviso de perigo: o código de recuperação é a única forma de recuperar a chave se todos os aparelhos se perderem.
4. **Cadastrar o autenticador:** Google Authenticator ou outro app TOTP; escanear o QR, confirmar o código e guardar os códigos reserva. Para que serve: apagar os dados de um aparelho perdido e recuperar a chave enquanto outros aparelhos estão ativos. 5 erros seguidos bloqueiam por 15 min.
5. **Parear outro PC:** "Parear novo aparelho" gera um texto e um QR válidos por 10 minutos e de uso único. No outro PC, "Entrar com código". Se esse PC já tem dados, explicar a diferença entre **Juntar** e **Substituir** (backup antes).
6. **Parear o celular:** instalar o APK, escanear o QR ou colar o código; o celular baixa tudo e sincroniza só com o app aberto; precisa de bloqueio de tela no Android; "Desconectar este aparelho" apaga só os dados do celular.
7. **Conflitos:** a versão mais recente vale e a outra fica em Conflitos, com "Usar esta"; dívidas nunca mudam sozinhas; no celular os conflitos aparecem só como aviso.
8. **Perdi um aparelho:** revogar em Aparelhos; com "apagar dados", pede o código do autenticador e o aparelho apaga os próprios dados na próxima vez que se conectar.
9. **Perdi todos os aparelhos:** recuperar com o código de recuperação.
10. **Restaurar um backup com a sincronização ligada:** a pergunta "Restaurar também nos outros aparelhos?" e o que cada resposta faz.
11. **Problemas comuns:** "sem cofre de senhas" (Linux sem keychain), sessão encerrada (401), sincronização pausada aguardando escolha, sincronização em espera durante uma atualização, sem internet.

O texto de cada artigo precisa bater com o comportamento real do código no momento do build. Onde o código e o README divergirem, vale o código, e a divergência é anotada no PR.

## Dados

Sem mudança de dados. Nada novo é persistido: a seção aberta em Configurações, o artigo aberto e a busca do guia vivem só na memória da tela. Nenhum IPC novo; os controles continuam chamando os mesmos canais de hoje.

## Telas

- Segue `UI_DESIGN.md`. Configurações e Como funciona usam o **mesmo esqueleto** (navegação à esquerda com largura fixa, conteúdo à direita com largura máxima de leitura), num componente compartilhado.
- Avisos: dica (neutro/roxo), atenção (âmbar), perigo (vermelho), sempre com ícone e texto, nunca só cor.
- Blocos de comando em fonte monoespaçada, com o botão Copiar com rótulo acessível ("Copiar comando").
- Textos em pt-BR.
- Atualizar `CLAUDE.md`, `GUIDE.md` e `README.md` onde citam "Configurações → Sincronização" ou o Como funciona, se o caminho mudar.

## Perguntas em aberto

(nenhuma)
