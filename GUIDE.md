# GUIDE.md — contexto para agentes de código

Orientação para um agente (Aider, Codex, …) que vai **mexer** neste projeto.
A ideia é que você não precise descobrir tudo sozinho antes da primeira linha.

> **`CLAUDE.md` é a fonte da verdade sobre arquitetura.** Este arquivo é o mapa;
> o `CLAUDE.md` é o território, e é bem mais detalhado. Se algo aqui contradiz o
> `CLAUDE.md`, o `CLAUDE.md` vence — e o erro aqui é um bug, conserte.
>
> Este arquivo é curto de propósito: um agente o carrega no contexto e o reenvia
> a cada passo, então cada parágrafo aqui é pago muitas vezes por execução
> (~2.3k tokens/passo hoje; o `CLAUDE.md` seria ~14k). Detalhe fino vai no
> `CLAUDE.md`, que se lê sob demanda. **Ao acrescentar algo aqui, corte algo.**

---

## 🧠 CONTEXTO — como ler este arquivo

Três marcadores, e só três. Eles valem justamente porque são raros: se tudo
estiver marcado, nada está.

| Marcador | Significa |
|---|---|
| 🔴 **CRÍTICO** | Quebrar isto corrompe dados reais de usuários, ou abre um buraco de segurança. Não há "depois eu arrumo": não existe backup em servidor. |
| ⚠️ **REGRA** | Uma decisão firme do projeto. Pode contrariá-la se tiver um motivo melhor — mas diga qual, não a desfaça em silêncio. |
| 🧠 **CONTEXTO** | Por que algo é como é. Não é ordem; é o que evita você "consertar" o que não está quebrado. |

## ⚠️ REGRA — mantenha este arquivo vivo

Se a sua mudança **cria ou muda uma regra** — um invariante novo, uma armadilha
nova, uma decisão que a próxima pessoa vai querer desfazer sem saber o custo —
escreva-a aqui, no mesmo trabalho. E se ela for de arquitetura, no `CLAUDE.md`
também: os dois andam juntos.

🧠 **CONTEXTO:** isto não tem como ser automatizado, e não finja que tem. Nenhum
script detecta "surgiu uma regra nova" — é julgamento, e só o agente que fez a
mudança está em posição de exercê-lo, na hora. Um hook que só reclamasse "você
mexeu em `src/` e não no `GUIDE.md`" dispararia em quase todo commit, e a única
coisa que ensinaria é a ignorá-lo.

O teste é simples: *alguém, daqui a seis meses, vai desfazer isto achando que é
bobagem?* Se sim, é regra — documente com o custo junto.

## O que é

Sagyou — app **pessoal e offline** de kanban, hábitos, metas e finanças.
Electron, janela sem moldura, um usuário só, tudo na máquina dele.

⚠️ **Há dados de produção reais em uso.** Pessoas têm tasks, hábitos, metas e
registros financeiros de verdade salvos localmente. Não existe "é só um app de
exemplo": uma migração errada apaga o trabalho de alguém, e não há backup em
servidor para restaurar. Leia **Regras que quebram dados** antes de tocar em
qualquer coisa persistida.

## Stack

| Camada | O quê |
|---|---|
| Runtime | Electron 39 — três processos: `main`, `preload`, `renderer` |
| UI | React 19 + TypeScript + Tailwind CSS 4 |
| Build | electron-vite (Vite); electron-builder para distribuir |
| Estado | Zustand — `store/kanban.ts` é a store do app inteiro |
| Banco | SQLite via `better-sqlite3`, no processo main |
| Dinheiro | `decimal.js` — **nunca** `number` (veja abaixo) |
| Testes | Vitest + Testing Library, jsdom por padrão |
| Drag & drop | dnd-kit |
| IA | SDK `openai` (qualquer endpoint compatível), proxiado pelo main |

Idioma: **a UI e os textos são em pt-BR**; código, nomes e comentários em
inglês. As ferramentas da IA têm nome em português de propósito (`ler_tasks`,
`criar_tasks`) — é o modelo que as chama.

## Comandos

```bash
npm run dev          # sobe o app em dev (Electron + Vite HMR)
npm run typecheck    # checa main e renderer
npm run lint         # ESLint
npm test             # roda tudo uma vez
npx vitest run src/main/__tests__/web-fetch.test.ts   # um arquivo só
npm run build:linux  # (ou :win / :mac) gera o distribuível
```

**Antes de dar qualquer coisa por pronta:** `npm run typecheck && npm test`.
O lint tem ~240 erros pré-existentes de estilo antigo — não conserte os que não
são seus, mas **não adicione novos**.

## Estrutura

```
src/
  main/          # janela, IPC, SQLite, spawn de processos
    index.ts     # registra TODOS os handlers IPC — comece por aqui
    store.ts     # persistência SQLite (kanban.db)
    web-fetch.ts # busca páginas para a IA (a política de segurança vive aqui)
    code-files.ts, code-diff.ts, usage.ts, chat-images.ts, …
    __tests__/   # precisam de @vitest-environment node
  preload/
    index.ts     # ponte contextBridge -> window.electronAPI
    index.d.ts   # tipagem da ponte (mantenha em sincronia com index.ts)
  renderer/src/
    App.tsx      # troca de views; dono do estado dos modais
    store/       # kanban.ts (principal), aiRun.ts (execução da IA)
    components/  # ~33 componentes; financial/ tem os seus
    ai/          # agent.ts (o loop), tools.ts (registro de ferramentas)
    utils/, types/, services/
    __tests__/   # espelha a estrutura acima
```

Uma regra acima de todas: **o renderer nunca toca disco nem rede**. Tudo passa
por um handler IPC no main, exposto pelo preload. Capacidade nova = handler em
`main/index.ts` + método em `preload/index.ts` + tipo em `preload/index.d.ts`.

## Convenções

- **Prettier manda**: aspas simples, **sem ponto e vírgula**, largura 100, sem
  trailing comma (`.prettierrc.yaml`). Não discuta com o formatador.
- TypeScript estrito; funções exportadas declaram tipo de retorno (o ESLint cobra).
- React: função nomeada + export nomeado. Arquivo que exporta componente **só**
  exporta componentes (fast refresh) — helpers vão para `utils/`.
- Comentários dizem **por quê**, não o quê. O padrão da casa é registrar a
  decisão e o que quebra se alguém a desfizer. Siga-o.
- Testes descrevem comportamento em frases ("mantém o nome quando o autosave
  passa por cima"), não a implementação.

## Regras que quebram dados

Não são preferências. Quebrá-las corrompe dados reais de gente real.

1. **Dinheiro é string decimal, não número.** `FinancialTransaction.amount`,
   `FinancialGoal.targetAmount` e `ShoppingItem.price` são strings canônicas
   (`"1500.5"`) em memória, no backup e no SQLite (colunas `TEXT`). Toda conta
   passa por `decimal.js` (`D()` em `components/financial/shared.ts`). Converta
   para `number` só para largura de barra e porcentagem. `qty` é `number` — é
   quantidade, não dinheiro.
2. **Nunca remova nem renomeie campos** de tipos persistidos sem migração ou
   fallback. Campo novo opcional é seguro; mudar a forma de um array ou objeto
   existente, não.
3. **Avise explicitamente** ao propor algo que possa corromper dados no load
   (trocar `string` por `string[]`, mudar esquema de IDs), com:
   `⚠️ Breaking schema change — existing data may be affected.`
4. **Nem tudo está no banco.** Em `app.getPath('userData')`: `kanban.db`,
   `files/` (os blobs dos anexos — a tabela só guarda metadados),
   `ai-config.json`, `ai-conversations.json`, `ai-usage-log.json`,
   `chat-images/`. Apagar um lado sem o outro deixa órfão.
5. **Ferramenta de IA que escreve leva `write: true`** em `ai/tools.ts`. É a
   única coisa entre o modelo e os dados do usuário: sem isso a ação roda sem
   aprovação. Ferramenta nova que muta estado **tem** que marcar.

## Segurança — o que já está resolvido

`main/web-fetch.ts` busca páginas cuja URL **vem do modelo**, ou seja, não é
confiável (uma página lida pode dizer ao modelo o que buscar em seguida). Já
existe, com testes, e não deve ser afrouxado:

- só `http`/`https` (allowlist — `file:` leria o disco);
- redes privadas, loopback, link-local e metadata de nuvem bloqueadas;
- **redirects seguidos à mão**, com a mesma política reaplicada a cada salto;
- credenciais embutidas (`user:senha@host`) recusadas;
- nada do usuário vai junto: sem cookie, sem authorization, sem referer;
- o parser (`new URL()`) é o único sanitizador — **não** acrescente limpeza de
  string na frente dele, e não decodifique entidades HTML.

`main/code-files.ts` confina todo acesso a arquivo dentro da raiz escolhida
(`confineToRoot`) — é a única barreira entre o assistente e o resto do disco.

## Testes

- Vitest, jsdom por padrão. Teste de processo main precisa de
  `@vitest-environment node` no topo (o SDK da OpenAI se recusa a construir sob
  globais de browser).
- `ElectronStorage` é mockado por arquivo, **antes** de importar a store.
- Os testes do main usam **coisas reais** — servidor HTTP local, repositório git
  de verdade, processo filho de verdade. Prefira isso a stub: quase todo bug
  desta área é um detalhe de como a coisa real se comporta.
- ⚠️ Testando o agente de código: `aider` e `codex` podem estar **instalados de
  verdade** na máquina, e o handler roda o que achar no PATH. **Substitua** o
  `PATH` por um diretório só com o seu stub — não basta pôr na frente.
- `vitest.config.ts` fixa `TZ=America/Sao_Paulo`: bug de data local não pode se
  esconder atrás de um teste rodando em UTC.

## Coisas que parecem erro e não são

Não "simplifique" nenhuma destas sem ler o comentário que as acompanha:

- **`await` em série no `main/code-files.ts`** — de propósito. A versão síncrona
  travava o event loop do main (que também serve o IPC) por ~70ms.
- **A montagem manual de `tool_calls` no `ai:chat:stream`** — o SDK faz isso e
  quebra com provedores compatíveis que não mandam `role` em todo delta.
- **`maxRetries: 0` no cliente OpenAI** — o retry é do `callModelResilient`. Com
  os dois, uma resposta virou 12 requisições HTTP.
- **A store da execução da IA é separada (`store/aiRun.ts`)** — a execução
  sobrevive à `AIView` ser desmontada. Não a mova para dentro do componente.
- **`trimContext(msgs)` no `agent.ts`** — cada passo reenvia todo o `msgs`, então
  o loop manda uma **cópia** aparada, em três passadas: `windowHistory` (descarta
  os turnos de conversa mais antigos além de um orçamento, deixando um marcador),
  `pruneSupersededResults` (tira leitura idêntica repetida) e `compactOldResults`
  (troca resultado grande de passo antigo por um ponteiro relegível, mantendo os
  últimos 3 passos inteiros). É o que segura o gasto (era 25k tokens/passo).
  `windowHistory` só mexe na conversa persistida, nunca na sequência de tools do
  run atual — soltar mensagem no meio de um tool-call quebra o pareamento (400).
  Nenhuma passada apara resultado de `write`, nem o `msgs` original. Não
  "simplifique" para reenviar tudo.
- **O diff do agente captura a base *antes* de rodar** (`captureBase`) — depois
  não dá para separar o que o agente fez do que o usuário já tinha em andamento.

## Antes de terminar

1. `npm run typecheck` — limpo.
2. `npm test` — tudo passando.
3. Nenhum erro novo de lint.
4. Mexeu em algo persistido? Releia **Regras que quebram dados**.
5. Mudou arquitetura? Atualize o `CLAUDE.md` — **e este arquivo**.
