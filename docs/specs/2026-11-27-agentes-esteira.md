# Esteira de código no Sagyou (agentes, v1)

Status: approved by Luis on 2026-11-27
Branch: feature/agentes-esteira

## Por quê

A esteira de código (spec → plano → build ou fix → review → PR) e os papéis que ela chama estão copiados no `.claude/` de cada projeto e de cada área. No Murasaki são três áreas, mais 21 arquivos "roteadores" na raiz; o Sagyou tem a própria cópia. Mudar o método exige editar várias cópias, e elas já divergiram: no Murasaki, a skill de `pr` da API manda rodar todos os testes no PC e a de `build` ainda diz que os de integração rodam no CI.

## Objetivos

1. A esteira é definida uma vez no Sagyou e usada por qualquer projeto numa sessão do Claude Code no Fleet, com a assinatura que o CLI já usa.
2. O que muda de um projeto para outro fica num **contrato** do projeto; o que se sabe sobre o código continua no repositório.
3. O uso diário não muda: abrir a sessão, pedir, aprovar a spec e o plano, fazer o merge.
4. Como saber que deu certo: uma mudança real no Sagyou e uma numa área do Murasaki percorrem a esteira do Sagyou até o PR, sem usar as skills de esteira do repositório. Só depois disso as cópias saem.

## Fora do escopo

- Bot: pedido pelo celular, delegar a partir de uma task, gatilhos por agenda ou evento, agentes que chamam outros agentes.
- Criar outros agentes ou outras esteiras. A v1 tem uma só.
- A esteira criar tasks, sprints ou cronômetro por conta própria. Regras de um projeto que pedem isso continuam valendo como texto do repositório.
- Codex e OpenCode com a esteira.
- Telas no celular.
- Reorganizar ou reduzir os `AGENTS.md` existentes.
- O app apagar ou reescrever arquivos de `.claude/` dos repositórios. A remoção das cópias é um PR comum em cada projeto.
- Mudar a regra de testes escrita no `CLAUDE.md` do Sagyou.

## Decisões (de Luis)

1. A esteira sai do `.claude/` dos repositórios, só depois de a v1 funcionar num projeto real.
2. Skills de domínio ficam no repositório e mudam no mesmo PR que o código.
3. A sessão abre no projeto inteiro. Antes do PR, a esteira lista as provas de cada área alterada e diz quais rodaram e quais não.
4. O agente propõe o contrato a partir do repositório; o usuário revisa e salva. Há uma tela para editar depois. Contradições são mostradas com as duas versões, e o usuário escolhe. Nada no contrato salvo muda sem confirmação.
5. Uma esteira padrão, editável numa tela, com "Restaurar padrão". Uma atualização do Sagyou não sobrescreve o que foi editado. Os portões ficam numa parte fixa.
6. A esteira editada e os contratos sincronizam entre os aparelhos.
7. A esteira vem por padrão e pode ser desligada em cada sessão.
8. Regra própria de um projeto: uma ou duas linhas no `AGENTS.md` dizendo quando agir, e os detalhes numa skill de domínio do repositório.
9. Onde rodar os testes é escolha de cada PC, porque varia com os minutos do GitHub Actions e com a força da máquina.
10. O Murasaki é um projeto com três áreas (`api`, `web`, `extension`).
11. A v1 usa só o Claude Code.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

1. O contrato também lista as **skills de domínio de cada área**, porque a sessão abre na raiz e o Sagyou precisa saber quais entregar.
2. A esteira e os contratos entram no backup.
3. "Onde rodar os testes" começa em **Perguntar**.
4. Só o que o usuário editou é guardado. O que não foi editado acompanha o padrão de cada versão do Sagyou.
5. O agente envia a proposta de contrato por uma ferramenta MCP nova, que só cria uma proposta pendente. Salvar é possível apenas na tela. O acesso MCP externo não tem essa ferramenta.
6. O padrão da esteira é escrito em português, generalizando as skills `sagyou-*` e as equivalentes do Murasaki, sem comandos, nomes de projeto ou regras de um projeto só.
7. A configuração de permissões e hooks do repositório (`settings.json`) continua como está e fica fora do contrato.

## Comportamento

### Esteira

- Etapas: `status`, `spec`, `plan`, `build`, `fix`, `review`, `pr`.
- Papéis: implementador, checador de plano, revisor, revisor de segurança, revisor de telas, rodador de testes.
- Cada etapa e cada papel é um texto que o usuário pode editar e restaurar um a um. Não é possível criar, excluir nem renomear etapas e papéis.
- Se o usuário editou um item e uma versão nova do Sagyou muda o padrão dele, o item continua com o texto do usuário e a tela mostra "O padrão mudou desde a sua edição", com **Ver padrão** e **Restaurar padrão**.
- Texto vazio não pode ser salvo.
- A esteira não contém valores de projeto. Usa os do contrato.
- Em cada etapa, a esteira manda ler e cumprir as regras próprias do projeto indicadas no `AGENTS.md`.

### Parte fixa

Visível na tela, sem edição, enviada em toda sessão com a esteira:

- Só o humano aprova a spec e o plano. O agente nunca escreve a aprovação sozinho.
- O agente nunca faz merge, nunca commita na branch base nem na branch principal e nunca força push.
- Commit e push só quando o usuário pediu para entregar.
- O agente nunca diz que testou o que não rodou. Uma prova que não rodou aparece no relatório com o motivo.
- O agente nunca muda a esteira nem o contrato salvo.

São instruções ao modelo, não bloqueios. Os bloqueios que já existem (cartões de aprovação, worktree, permissões do CLI) continuam como estão.

### Contrato do projeto

Um por projeto do Sagyou:

| Campo | Regra |
| --- | --- |
| Branch base | Obrigatório |
| Pasta de progresso | Obrigatório; caminho relativo dentro do repositório |
| Áreas | Pelo menos uma; um projeto simples tem uma área com a pasta `.` |
| Por área: nome e pasta | Nome único; pasta relativa, sem sair do repositório (sem `..` e sem caminho absoluto) |
| Por área: provas | Lista de comandos ou passos, cada um **Automática** ou **Manual**; pode ser vazia, com o aviso "Sem provas: o relatório dirá que nada foi verificado nesta área." |
| Por área: skills de domínio | Pastas relativas que contêm um `SKILL.md` |

- Uma prova **Manual** nunca é marcada como feita pelo agente. Ela aparece como pendente para o usuário.
- Arquivo alterado fora de todas as áreas aparece no relatório como "sem área".
- O contrato não guarda caminhos absolutos. A pasta do projeto continua configurada em cada PC.
- Skill de domínio que não existe no worktree da sessão: a sessão abre e avisa qual faltou. A branch pode ainda não tê-la.

### Proposta de contrato

- Num projeto sem contrato, a tela de nova sessão oferece **Criar contrato**. Isso abre a sessão com o que é preciso para o agente fazer a proposta, e o usuário a pede.
- A proposta fica pendente até o usuário revisar. A tela permite corrigir, **Salvar contrato** ou **Descartar**.
- Quando o repositório se contradiz, o campo chega marcado como "Escolha uma opção", com as versões e o arquivo de onde veio cada uma. Salvar fica desabilitado até resolver.
- Há no máximo uma proposta pendente por projeto; uma nova substitui a anterior.
- Com contrato já salvo, uma proposta nova mostra as diferenças. O contrato salvo continua valendo até a confirmação.
- A proposta fica só no PC onde foi criada.

### Nova sessão no Fleet

| Situação | Comportamento |
| --- | --- |
| Claude Code, projeto com contrato | **Usar esteira** aparece marcado |
| **Usar esteira** desmarcado | A sessão abre como hoje |
| Projeto sem contrato | Sem a opção; aparece **Criar contrato**. Abrir sem contrato continua possível, como hoje |
| Sessão geral | Sem esteira |
| Codex ou OpenCode | Sem esteira, com o aviso "A esteira do Sagyou funciona só com o Claude Code nesta versão." |
| A esteira não pôde ser preparada | A sessão **não abre**: "Não foi possível carregar a esteira: <motivo>". O usuário pode desmarcar e abrir sem ela |

- A sessão continua abrindo em branco: nada é enviado como pedido e nenhum turno roda sozinho.
- As etapas entram como as skills entram hoje: quando o pedido combina com a descrição, ou quando o usuário as chama pelo nome.
- A sessão recebe a esteira, a parte fixa, os valores do contrato, a escolha de testes deste PC e as skills de domínio das áreas.
- Nada disso é gravado dentro do worktree, nem aparece no diff, na entrega do patch ou no repositório original.
- Uma edição na esteira ou no contrato vale para as próximas sessões. Sessões abertas não mudam.
- A tela da sessão indica se ela está com a esteira.

### Onde rodar os testes (neste PC)

- **Neste PC:** roda aqui. O que não puder rodar entra no relatório com o motivo.
- **No CI:** só envia a branch se o usuário pediu para entregar; sem isso, o relatório diz que as provas não rodaram. Sem CI disponível, diz isso e não conta como aprovado.
- **Perguntar:** o agente pergunta antes de rodar as provas.
- Quando uma regra do repositório sobre onde testar contradiz esta escolha, o agente avisa e pergunta.

### Remoção das cópias (depois do objetivo 4)

Um PR por projeto, fora do app. Antes dele:

1. Uma lista com **cada regra própria** das skills e agentes de esteira e o destino dela (`AGENTS.md`, skill de domínio ou descartada), conferida pelo usuário. Exemplos conhecidos no Murasaki: a task de pré-produção (skills de `spec` e `pr` das três áreas) e o limite de complexidade ciclomática (skill de `build` da API).
2. Ajustar as frases do `AGENTS.md`/`CLAUDE.md` que dizem que as skills do repositório vencem skills genéricas de plugins, e as que citam as skills removidas.
3. Decidir o que fazer para quem trabalha fora do Fleet (Claude Code direto no terminal, Codex, OpenCode), que deixa de ter a esteira.

Enquanto as cópias existirem, uma sessão com a esteira pode ver as duas versões de uma etapa. A parte da sessão montada pelo Sagyou manda usar a do Sagyou.

## Dados

Dados novos, aditivos. Nenhum campo existente muda ou é removido.

| Dado | Onde | Sincroniza | Backup |
| --- | --- | --- | --- |
| Itens editados da esteira | SQLite | Sim, um registro por etapa ou papel | Sim |
| Contrato do projeto | SQLite | Sim, um registro por projeto | Sim |
| Proposta de contrato pendente | Neste PC | Não | Não |
| Onde rodar os testes | Neste PC | Não | Não |

- Restaurar um item para o padrão e excluir um contrato propagam como exclusão.
- Excluir um projeto exclui o contrato dele. Arquivar mantém.
- Conflitos de sincronização aparecem na tela de conflitos que já existe, com rótulos legíveis, no PC e no celular. A escolha é do registro inteiro.
- Backup antigo, sem esses dados, não apaga a esteira nem os contratos locais. Dados inválidos num backup são recusados antes de qualquer escrita.
- Um Sagyou antigo não conhece esses dados: importar um backup novo nele não os restaura.

⚠️ **Aparelhos em versões diferentes.** Pela leitura de `packages/core/src/sync/apply.ts`, um tipo de registro desconhecido é ignorado ao ser recebido. Sem tratamento, um aparelho atualizado depois poderia nunca receber o que ignorou. Requisitos:

1. Um aparelho em versão antiga continua sincronizando os outros dados, sem erro e sem apagar os novos nos demais.
2. Depois de atualizar, ele recebe a esteira e os contratos atuais sem precisar de uma edição nova, sem parear de novo e sem perder edições locais.
3. Um snapshot enviado por um aparelho antigo não pode fazer os dados novos sumirem para quem entrar depois.
4. O celular não mostra esses dados, mas a versão nova os guarda e os preserva.

## Telas

Seguem o `UI_DESIGN.md`.

- **Configurações → Esteira:** lista de etapas e de papéis, editor de texto de cada item, marca "Editado", **Restaurar padrão** com confirmação, parte fixa somente leitura e **Onde rodar os testes neste PC** (Neste PC / No CI / Perguntar).
- **Contrato do projeto:** aberto a partir do projeto. Campos da tabela acima, com erros ao lado de cada campo; revisão de proposta com diferenças e contradições; **Excluir contrato** com confirmação.
- **Nova sessão (Fleet):** **Usar esteira**, **Criar contrato** e os avisos da tabela.
- **Como funciona:** um artigo sobre a esteira, e ajuste nos artigos de sincronização e backup.

## Riscos a resolver antes do plano

**Entrega ao Claude Code.** A ideia é montar, para cada sessão, um plugin numa pasta fora do worktree e abrir o CLI com `--plugin-dir`. A opção aparece no `--help` do Claude Code 2.1.332, mas **não foi testada**. Um teste precisa mostrar que:

1. skills e agentes do plugin carregam numa sessão interativa, e as skills entram sozinhas quando o pedido combina com a descrição;
2. um papel da esteira consegue ser chamado por uma etapa;
3. a parte fixa chega à sessão sem rodar um turno;
4. as skills de domínio de pastas de área, numa sessão aberta na raiz, ficam disponíveis;
5. as skills do repositório continuam funcionando junto;
6. nada aparece no diff.

Se algum item falhar sem alternativa, a spec volta para revisão.

## Perguntas em aberto

Nenhuma.
