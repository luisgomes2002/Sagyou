# Memória só do próprio projeto e edição de memória por seção

Status: approved by Luis on 2026-11-23
Branch: feature/memoria-escopo-e-secao

## Por quê

1. **Leitura entre projetos sem trava.** Uma sessão de projeto lê memória de outro projeto quando o agente passa `projectId` em `search_memory`, `list_recent_memories`, `check_memories` ou `list_active_sessions`, e `read_memory` lê por id exato qualquer memória ativa. Nada disso pede nada ao usuário. O Luis quer que, por padrão, a sessão veja só as memórias do **próprio projeto** (mais as globais), e que ler outro projeto aconteça só quando ele pedir.
2. **`update_memory` ainda troca o corpo inteiro.** O passo 1 (`expectedUpdatedAt`, PR #65) já recusa a edição sobre uma versão antiga. O passo 2 da task original, "Memória: `update_memory` com proteção contra sobrescrita", é editar **uma seção** da memória, apontada pelo título dela, sem reenviar o corpo inteiro. Isso evita reescrever o que não foi tocado e diminui a chance de apagar, sem querer, o texto que outra sessão acabou de mexer em outra seção.

## Objetivos

- Uma sessão de projeto lê, por padrão, só as memórias do próprio projeto e as globais, em todas as ferramentas de memória.
- Ler memória de **outro projeto** exige um **cartão de aprovação**, que o usuário responde no PC ou no celular. Aprovado, vale para aquele projeto até a sessão acabar.
- `update_memory` aceita editar uma seção, com a mesma proteção de versão do passo 1, e só mexe nela.

## Fora do escopo

- O acesso externo (Remote Control) e as sessões **gerais** (sem projeto) continuam lendo todos os projetos, sem cartão (decisão do Luis de 2026-11-03 para o token externo; uma sessão geral não tem "próprio projeto").
- As outras ferramentas de leitura com `projectId` (`read_tasks`, `read_project`, `read_notes`, `read_goals`, `ler_tasks`, `ler_projeto`) ficam como estão. A trava é só de **memória** (e de `list_active_sessions`, que mostra o que outras sessões fazem).
- O briefing e as buscas internas do Sagyou (que já usam o projeto da run mais as globais) não mudam.
- Ler seção em `read_memory` (devolver só um trecho) e criar seção nova pelo `update_memory`.
- Restringir quem pode **escrever** em memória de outro projeto: as escritas de memória já seguem as regras de hoje.

## Decisões (de Luis)

- Por padrão, a sessão lê só as memórias do próprio projeto (e as globais).
- Ler outro projeto é liberado por **cartão de aprovação** (não por opção ao abrir a sessão, nem só por regra textual para o agente).
- O passo 2 do `update_memory` (edição por seção) entra junto, na mesma spec.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

**Leitura entre projetos**
- **O que conta como "outro projeto":** uma memória com `projectId` diferente do da sessão e diferente de `null`. As globais (`projectId` nulo) são sempre legíveis.
- **Ferramentas cobertas:** `search_memory`, `list_recent_memories` e `check_memories` (quando recebem um `projectId` diferente do da sessão), `read_memory` (quando a memória pedida é de outro projeto) e `list_active_sessions` (quando recebe outro `projectId`).
- **Cartão:** `Ler memórias do projeto "<nome>"?`. Aparece no PC (como os cartões do Fleet) e vai para os celulares autorizados, onde o primeiro que responder vale. Expira em 5 minutos, e expirado conta como recusado.
- **Não é respondido pelo modo automático da sessão** (o toggle "auto" nunca aprova este cartão), como os cartões de escrita arriscada.
- **Aprovado:** vale para aquele projeto até a sessão acabar (guardado na memória do app, por sessão, nunca em disco). Outros projetos pedem o próprio cartão.
- **Recusado, expirado ou app bloqueado:** a ferramenta responde `Leitura de outro projeto não aprovada. Não insista: só leia outro projeto se o usuário pedir.` e **nada é lembrado**, então se o usuário pedir depois, o agente pode tentar de novo e um cartão novo aparece.
- **Vários pedidos ao mesmo tempo** para o mesmo projeto compartilham um único cartão.
- **Projeto inexistente:** responde `Projeto não encontrado.` sem cartão. Projeto arquivado pede cartão como qualquer outro.
- **`read_memory` por id de outro projeto:** o cartão é do projeto dono da memória. Antes de aprovado, a resposta não revela título nem conteúdo, só a recusa acima. Memória inexistente ou arquivada continua com a resposta de hoje (`Memória indisponível nesta sessão MCP.`).
- **Texto das descrições:** as ferramentas passam a dizer que leem, por padrão, o projeto da sessão e as globais, e que outro projeto exige a aprovação do usuário.
- **Log:** só `mcp`/`cross_project_read` com `decision` (`approved` ou `not_approved`), nunca o nome do projeto nem o conteúdo.

**Edição por seção**
- **Parâmetro novo** `section` em `update_memory`: o texto do título (sem os `#`). Com `section`, o `body` passado é o **novo conteúdo daquela seção**, sem a linha do título, que é mantida.
- **O que é seção:** de uma linha de título Markdown (`#` a `######`) até a próxima de nível igual ou menor, ou o fim do texto. Linhas dentro de um bloco de código cercado (```` ``` ````) não contam como título. Subseções fazem parte da seção.
- **Como acha o título:** comparando sem acento nem maiúsculas e ignorando espaços repetidos (a mesma `titleKey` que o app já usa).
- **`expectedUpdatedAt` é obrigatório com `section`.** Sem ele: `Para editar uma seção, passe expectedUpdatedAt (o updatedAt lido com read_memory).` Mudou desde a leitura: a mesma recusa do passo 1.
- **Seção não encontrada:** `Seção "<título>" não encontrada nesta memória.`
- **Título repetido:** `Há mais de uma seção "<título>" nesta memória; use update_memory sem section.`
- **`section` com `title` ou `tags`:** permitidos juntos (mudam o título e as tags como hoje); só o corpo é por seção.
- **Limites:** o corpo **resultante** continua com o limite de 2 000 caracteres; passar disso recusa como hoje (`body inválido.`). Segredos são removidos como em toda gravação.
- **Handoff, arquivada e inexistente** continuam com as recusas de hoje, antes de qualquer checagem de seção.
- **Sem `section`**, `update_memory` funciona exatamente como hoje (corpo inteiro, `expectedUpdatedAt` opcional).

## Comportamento

**Leitura por padrão.** Sessão do projeto A: `search_memory { term }` busca em A e nas globais. `list_recent_memories`, `check_memories` e `read_memory` de uma memória de A ou global seguem como hoje.

**Pedido do usuário.** O usuário diz "veja o que decidimos no projeto B". O agente chama `search_memory { term, projectId: B }`. O Sagyou abre o cartão `Ler memórias do projeto "B"?`. O usuário aprova, a busca roda e, até o fim da sessão, o agente lê B sem novo cartão.

**Sem aprovação.** Nada do projeto B é devolvido (nem título, nem trecho, nem se existe alguma memória).

**Sessão geral e acesso externo.** Sem mudança.

**Edição por seção.** O agente lê com `read_memory` (que devolve `updatedAt`) e chama `update_memory { id, section: "Decisão", body: "novo texto", expectedUpdatedAt }`. Só o conteúdo daquela seção muda; o resto do texto, as outras seções, o pin e os contadores de decaimento ficam intactos.

## Dados

- **Sem mudança de dados.** Nada novo em SQLite, `userData`, backup ou sync. As aprovações por sessão ficam só na memória do processo e somem quando a sessão acaba ou o app fecha.
- Compatibilidade: um agente que ainda chame `update_memory` com o corpo inteiro ou `search_memory` com `projectId` continua funcionando; só a leitura de outro projeto passa a pedir o cartão.
- Contrato do broker: parâmetro novo opcional `section` em `update_memory`; respostas de leitura inalteradas quando aprovadas.

## Telas

- **Cartão de aprovação**: o mesmo componente dos cartões do Fleet e das aprovações no celular, com o texto `Ler memórias do projeto "<nome>"?`. Sem tela nova.
- Nenhuma mudança no MemoryView.

## Perguntas em aberto

(nenhuma)
