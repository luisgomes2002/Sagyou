# Plano de implementação: Configurações e Como funciona reformulados

Status: approved by Luis on 2026-11-01
Spec: docs/specs/2026-11-01-configuracoes-e-ajuda.md
Branch: feature/configuracoes-e-ajuda

**Objetivo:** reorganizar Configurações em seções com menu lateral e transformar o Como funciona numa central de ajuda atualizada, com um capítulo detalhado de Sincronização.

**Arquitetura:** um layout compartilhado (`SectionedPage`) dá o esqueleto das duas telas. O conteúdo do guia vira dados tipados (`guide/content.ts`), e a busca vira uma função pura (`guide/search.ts`), ambos testados sem render. `App.tsx` ganha um tipo de navegação exportado (`navigation.ts`) e dois alvos em memória: a seção de Configurações e o artigo do guia a abrir.

Todos os caminhos abaixo são relativos a `apps/desktop/src/renderer/src/`, salvo indicação.

## Restrições Globais

- Sem mudança de dados: nada novo em SQLite, `settings`, `uiPreferences`, `localStorage` ou backup. A seção aberta, o artigo aberto e a busca vivem em `useState`.
- Sem IPC novo. A versão do app chega por `define` do Vite (`__APP_VERSION__`), lida do `package.json` do desktop na hora do build.
- Os controles de Configurações mantêm os textos, toasts, validações e chamadas `window.electronAPI.*` de hoje. Os testes existentes `SyncSettings.test.tsx`, `UpdateSettings.test.tsx`, `WindowSettings.test.tsx` e `AutoLockSettings.test.tsx` continuam passando sem que os textos que eles procuram sejam alterados.
- Visual segundo `UI_DESIGN.md`: superfícies `#0b0b0f`/`#121216`/`#16161a`/`#101014`, borda `#2b2b31`, hover `#222227`, selecionado `#2a2a30`, primário `#6d5bb8` com hover `#7b69c6`. Avisos: dica `#a080f0`, atenção `#d9a640`, perigo `#ec6a6a`, sempre com ícone e texto, sobre superfície sólida e sem opacidade decorativa. Sai o `#7c3aed` (`accent-[#7c3aed]`, `bg-[#7c3aed]`) das telas reescritas.
- Ícones em SVG inline, como na `Sidebar.tsx`. Nenhuma dependência nova.
- Textos em pt-BR, exatamente como na spec: "Buscar no guia", `Nada encontrado para "<termo>".`, "Limpar busca", "Copiar", "Copiado", "Não foi possível copiar.", "Abrir esta tela", "Esta área está oculta na barra lateral.", "Mostrar em Configurações", "Como funciona a sincronização", `Versão <x.y.z>`, "Abrir o Como funciona".
- Testes: Vitest + Testing Library em `__tests__/`. **Por preferência do usuário, nada roda localmente**: cada task commita o teste e o código, e a verificação é o CI do PR (`gh pr checks` / `gh run watch`). A branch abre o PR em rascunho logo na Task 1 para que o CI rode a cada push.

## Respostas da checagem do construtor

- **Os exemplos visuais do guia atual (de Luis):** todos são portados e atualizados. `GuideBlock` ganha `{ type: 'visual'; id: GuideVisualId }`, com `GuideVisualId = 'board' | 'planejamento' | 'meta-habito' | 'perfis' | 'compras' | 'saldo' | 'vinculos' | 'leitura' | 'sessoes'`. O antigo visual do assistente vira `sessoes`: a aba de sessões + terminal + um cartão de aprovação, sem chat. Eles saem de `GuideView.tsx` (`GuideVisual`/`VisualBox`, linhas 293–553) para `components/guide/GuideVisuals.tsx`, na Task 3. O bloco `{ type: 'diagram'; id: 'sync' }` continua separado (Task 4).
- **Blocos da Sincronização (de Luis):** os nomes e controles de hoje ficam; só a ordem muda. Com a sincronização ativa: Este aparelho → Aparelhos → Google Authenticator → Conflitos. Sem a sincronização: Primeiro aparelho → Outro aparelho já sincroniza. A spec propunha outros nomes; Luis preferiu manter os atuais.

- **Os títulos internos dos componentes de Configurações** (decisão do construtor): sai só o invólucro do cartão (`rounded-xl border … bg-[#16161a]`). Os `h2` "Janela e inicialização" e "Atualizações" viram `h3`, como subtítulos de bloco dentro da seção Sistema, com o mesmo texto. Assim `WindowSettings.test.tsx:32` continua valendo. O `h2` "Sincronização" de `SyncSettings.tsx:447` sai, porque duplicaria o título da página; nenhum teste o procura.
- **`AutoLockSettings`** continua aninhado em `PasswordSettings` (`SettingsView.tsx:379`), sem mudar estado de lugar (decisão do construtor).
- **Descrição de Geral:** "Como o Sagyou deve chamar você." É a descrição da seção, não o texto de um controle; o nome serve ao cumprimento da tela de bloqueio e aos agentes, não a um "assistente" (decisão do construtor).
- **Comandos:** são 8 blocos, as 7 linhas do bloco `bash` do README (linhas 132–138, sem os comentários `#`) mais o gerador do `TOTP_ENC_KEY` citado na linha 141, que confere com o texto do plano. O teste compara com literais no próprio teste, não lê o README.
- **Textos antigos do guia que caem:** "não há uma conta online sincronizando esses dados" (`GuideView.tsx:24`), "registros e conversas" (`:26`) e "…arquivos e chat" (`:49`). O teste de conteúdo da Task 3 também proíbe `/conversas?\b/i` e `/conta online/i`. Excel e exportação entram no capítulo Dados e segurança (artigo "Backup e exportação"); Relatórios e Concluídas ficam em Metas e hábitos e Projetos.
- **Caminhos:** `apps/desktop/vitest.config.ts` (`define` no nível raiz), `apps/desktop/src/renderer/src/env.d.ts` (`declare const __APP_VERSION__: string`) e `renderer.define` em `apps/desktop/electron.vite.config.ts`, que hoje não existe.
- **`App.tsx`:** o cast `view as typeof activeView` da Home vira `view as AppView`. O `Sidebar.tsx` mantém o próprio union, e um teste de tipo (`satisfies`) garante que ele cabe em `AppView`. Os alvos são zerados no handler `onChangeView` que o `App` passa à `Sidebar`.

## Foco de Review

1. **Nenhum controle de Configurações perde comportamento ao mudar de lugar.** Senha, bloqueio automático, janela/bandeja, atualização e sincronização continuam chamando as mesmas APIs e mostrando os mesmos textos. A troca de seção desmonta o componente, então `SyncSettings` refaz o `status()` ao voltar. Pode refazer, mas um formulário meio preenchido é descartado sem gravar nada: digitar uma senha, trocar de seção e voltar deixa o campo vazio, sem chamar `security.enable`. Testado na Task 6 (cada seção renderiza o componente de hoje) e pelos testes existentes dos componentes.
2. **"Abrir esta tela" nunca leva a uma área desativada.** Com a feature oculta, o botão fica desativado e "Mostrar em Configurações" abre Configurações → Barra lateral. Sem isso, o efeito de `App.tsx` (linha ~303) jogaria o usuário para Início sem explicação. Testado nas Tasks 1 e 5.
3. **O guia não mente sobre o app.** Todo `target` do conteúdo aponta para uma `AppView` ou seção de Configurações que existe; nenhum artigo fala do chat removido; os 7 comandos `wrangler` são idênticos aos do `README.md`. Testado nas Tasks 3 e 4.
4. **A busca não esconde artigos por causa de acento ou caixa** ("sincronizacao" acha "Sincronização"; "WRANGLER" acha os comandos), e a busca vazia mostra tudo. Testado na Task 3.
5. **A cópia para a área de transferência falha de forma visível.** Se `navigator.clipboard.writeText` rejeitar, aparece "Não foi possível copiar." e nada mais muda. Testado na Task 5.
6. **Dados persistidos existentes:** nenhum muda. As preferências de aparência e barra lateral continuam salvas pelos mesmos `onSetUiPreferences`/`onSetFeaturePreferences`. Testado na Task 6 (alternar o tema e uma área chama os callbacks com o mesmo formato de hoje).

### Task 1: Tipo de navegação e regra de área visível

**Arquivos:** Criar `navigation.ts`. Modificar `App.tsx` (usar `AppView` e `VIEW_FEATURE` no lugar do union inline e do `viewFeatures` local). Teste: `__tests__/navigation.test.ts`.

**Interfaces:** Produz:
- `export type AppView = 'home' | 'board' | 'canvas' | 'done' | 'goals' | 'habits' | 'financial' | 'upcoming' | 'reports' | 'files' | 'ai' | 'memory' | 'planejamento' | 'graph' | 'guide' | 'settings'`
- `export const VIEW_FEATURE: Partial<Record<AppView, FeatureId>>`, com o mesmo mapa do `viewFeatures` de hoje.
- `export function isViewEnabled(view: AppView, enabled: FeatureId[]): boolean`
- `export type SettingsSectionId = 'geral' | 'aparencia' | 'barra-lateral' | 'seguranca' | 'sincronizacao' | 'sistema' | 'sobre'`
- `export type NavTarget = { view: Exclude<AppView, 'settings' | 'guide'> } | { view: 'settings'; section: SettingsSectionId } | { view: 'guide'; articleId?: string }`

- [ ] Passo 1: teste: `isViewEnabled('financial', ['kanban'])` → `false`; `isViewEnabled('financial', ['financial'])` → `true`; `isViewEnabled('settings', [])` e `isViewEnabled('guide', [])` → `true`; `isViewEnabled('memory', ['ai'])` → `true`; `VIEW_FEATURE.board === 'kanban'`.
- [ ] Passo 2: abra o PR em rascunho (`gh pr create --draft`) depois do primeiro push; o CI deve FALHAR porque `navigation.ts` não existe (commit só do teste).
- [ ] Passo 3: implemente `navigation.ts` e troque o union de `useState<…>('home')` e o `viewFeatures` de `App.tsx` pelos exportados, sem mudar comportamento.
- [ ] Passo 4: push. Esperado: CI passa (typecheck + testes).
- [ ] Passo 5: commit `refactor(navegacao): tipo AppView e regra de área visível`

### Task 2: Layout compartilhado `SectionedPage`

**Arquivos:** Criar `components/layout/SectionedPage.tsx` e `components/layout/sectionIcons.tsx`. Teste: `__tests__/components/SectionedPage.test.tsx`.

**Interfaces:** Produz:
```ts
interface SectionedPageItem<T extends string> { id: T; label: string; icon?: JSX.Element; group?: string }
interface SectionedPageProps<T extends string> {
  title: string                       // "Configurações" | "Como funciona"
  items: SectionedPageItem<T>[]
  activeId: T
  onSelect: (id: T) => void
  navTop?: JSX.Element                // campo de busca do guia
  emptyNav?: JSX.Element              // mensagem quando items está vazio
  heading: string                     // título da área de conteúdo
  description?: string
  children: React.ReactNode
}
export function SectionedPage<T extends string>(props: SectionedPageProps<T>): JSX.Element
```
`group` gera um rótulo de grupo na lista (usado pelos capítulos do guia). A lista é um `<nav aria-label={title}>` com botões `aria-current="page"` no ativo. O título do conteúdo é um `<h2 tabIndex={-1}>`, que recebe o foco a cada troca de `activeId` (exceto na primeira renderização, para não roubar o foco ao abrir a tela). Layout: em `md:` e acima, a lista ocupa uma coluna fixa de `w-60` e o conteúdo usa `max-w-3xl`; abaixo de `md`, a lista vira uma faixa horizontal com `overflow-x-auto` no topo.

- [ ] Passo 1: testes: renderiza os itens em ordem; o item ativo tem `aria-current="page"`; ↓/↑ movem o foco entre os botões da lista (com volta circular); Enter e espaço chamam `onSelect(id)`; ao mudar `activeId` por rerender, o `h2` com `heading` recebe o foco; os rótulos de grupo aparecem uma vez por grupo.
- [ ] Passo 2: push só do teste. Esperado: CI FALHA (módulo inexistente).
- [ ] Passo 3: implemente. As setas são tratadas no `onKeyDown` da `nav`, movendo o foco pelos `button` filhos; a ativação é o `onClick` nativo do botão, que cobre Enter e espaço.
- [ ] Passo 4: push. Esperado: CI passa.
- [ ] Passo 5: commit `feat(ui): layout de seções com navegação lateral`

### Task 3: Conteúdo do guia (capítulos 1–6 e 8) e busca

**Arquivos:** Criar `guide/types.ts`, `guide/content.ts`, `guide/search.ts` e `components/guide/GuideVisuals.tsx` (os 9 visuais portados, exportando `GuideVisual({ id }: { id: GuideVisualId })`). Teste: `__tests__/guide/content.test.ts`, `__tests__/guide/search.test.ts` e `__tests__/components/GuideVisuals.test.tsx` (cada um dos 9 ids renderiza sem erro e com `aria-label` próprio; nenhum contém "chat").

**Interfaces:** Consome `AppView`, `NavTarget` e `SettingsSectionId` (Task 1). Produz:
```ts
type GuideBlock =
  | { type: 'p'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'callout'; tone: 'tip' | 'warning' | 'danger'; text: string }
  | { type: 'command'; command: string; label?: string }
  | { type: 'diagram'; id: 'sync' }
  | { type: 'visual'; id: GuideVisualId }
interface GuideArticle { id: string; title: string; blocks: GuideBlock[]; target?: NavTarget }
type GuideChapterId = 'primeiros-passos' | 'projetos' | 'organizacao' | 'metas-habitos'
  | 'financeiro' | 'sessoes-codigo' | 'sincronizacao' | 'dados-seguranca'
interface GuideChapter { id: GuideChapterId; label: string; articles: GuideArticle[] }
export const GUIDE_CHAPTERS: GuideChapter[]
export function articleText(a: GuideArticle): string        // título + todo texto dos blocos
export function normalizeForSearch(s: string): string        // NFD, sem diacríticos, minúsculas, espaços colapsados
export function searchGuide(chapters: GuideChapter[], query: string): GuideChapter[]
export function findArticle(id: string): { chapter: GuideChapter; article: GuideArticle } | null
```
`searchGuide`: query normalizada vazia → `chapters` inalterado. Senão, mantém só os artigos em que **todas** as palavras da query aparecem em `normalizeForSearch(articleText(a))`, preserva a ordem e remove capítulos vazios.

Capítulos, nesta ordem e com estes rótulos: Primeiros passos · Projetos e tarefas · Organização · Metas e hábitos · Financeiro · Sessões de código · Sincronização e celular · Dados e segurança. Nesta task, o capítulo `sincronizacao` entra com um único artigo provisório (`sync-o-que-e`), que a Task 4 completa. O conteúdo de Financeiro, Projetos, Organização e Metas é portado do `GuideView.tsx` atual (reescrito em artigos com passos/avisos onde couber). Sessões de código é escrito a partir das seções "Fleet" e "Agentes de código e IA" do `CLAUDE.md`: os CLIs, a pasta isolada, o MCP e os cartões de aprovação, a memória e o resumo da sessão. Dados e segurança cobre: onde ficam os dados, backup e restauração, senha e bloqueio automático, atualização automática e registro de diagnóstico.

Alvos (`target`) mínimos: board → `{view:'board'}`, Planejamento → `planejamento`, Canvas → `canvas`, Grafo → `graph`, Arquivos → `files`, Metas → `goals`, Hábitos → `habits`, Relatórios → `reports`, Financeiro → `financial`, Sessões → `ai`, Memória → `memory`, Senha → `{view:'settings', section:'seguranca'}`, Atualização → `{view:'settings', section:'sistema'}`, Barra lateral → `{view:'settings', section:'barra-lateral'}`.

- [ ] Passo 1: testes de conteúdo: os 8 capítulos com os ids e rótulos acima, em ordem; ids de artigo únicos em todo o guia; todo `target.view` pertence a `AppView`, e todo `section` a `SettingsSectionId`; nenhum `articleText` casa com `/\bchat\b/i`; todo capítulo tem ≥ 1 artigo; `findArticle('sync-o-que-e')` retorna o capítulo `sincronizacao`. Testes de busca: `searchGuide(GUIDE_CHAPTERS, '')` devolve o mesmo array; `'sincronizacao'` acha o artigo cujo título contém "Sincronização"; `'BACKUP'` acha os mesmos artigos que `'backup'`; `'xyzzy'` → `[]`; uma query de duas palavras exige as duas.
- [ ] Passo 2: push só dos testes. Esperado: CI FALHA (módulos inexistentes).
- [ ] Passo 3: implemente os três módulos.
- [ ] Passo 4: push. Esperado: CI passa.
- [ ] Passo 5: commit `feat(guia): conteúdo em dados e busca sem acento`

### Task 4: Capítulo Sincronização e celular + diagrama

**Arquivos:** Modificar `guide/content.ts`. Criar `components/guide/SyncDiagram.tsx`. Teste: ampliar `__tests__/guide/content.test.ts` e criar `__tests__/components/SyncDiagram.test.tsx`.

**Interfaces:** Consome os tipos da Task 3. Produz os artigos do capítulo `sincronizacao`, com ids e títulos fixos:

| id | título |
| --- | --- |
| `sync-o-que-e` | O que é e o que o servidor vê |
| `sync-servidor` | Criar o servidor na Cloudflare |
| `sync-ativar` | Ativar no primeiro PC |
| `sync-autenticador` | Cadastrar o autenticador |
| `sync-parear-pc` | Parear outro PC |
| `sync-parear-celular` | Parear o celular |
| `sync-conflitos` | Conflitos |
| `sync-perdi-aparelho` | Perdi um aparelho |
| `sync-perdi-todos` | Perdi todos os aparelhos |
| `sync-restaurar-backup` | Restaurar um backup com a sincronização ligada |
| `sync-problemas` | Problemas comuns |

O conteúdo segue a seção "Comportamento → Capítulo Sincronização" da spec. `sync-o-que-e` abre com `{type:'diagram', id:'sync'}`. `sync-servidor` tem estes blocos `command`, nesta ordem e idênticos ao `README.md`: `npm install`, `npx wrangler login`, `npx wrangler d1 create sagyou-sync`, `npx wrangler d1 execute sagyou-sync --remote --file schema.sql`, `npx wrangler secret put SETUP_TOKEN`, `npx wrangler secret put TOTP_ENC_KEY`, `npx wrangler deploy`, além do gerador `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Avisos obrigatórios: `danger` sobre o código de recuperação (em `sync-ativar`) e `warning` sobre guardar `SETUP_TOKEN`/`TOTP_ENC_KEY` fora do repositório (em `sync-servidor`). Os artigos de uso têm `target: {view:'settings', section:'sincronizacao'}`. Antes de escrever, o implementador confere cada afirmação contra `SyncSettings.tsx`, `useSync.ts`, `utils/sync-view.ts`, `sync-server/` e `apps/mobile`: validade do convite de 10 min, TOTP com 5 erros e 15 min de bloqueio, Juntar/Substituir, `no-keychain`, `update-pending`, pausa `restore`. Uma divergência com o README é anotada para o PR.

`SyncDiagram`: SVG inline com três caixas ("Este PC", "Seu Worker (Cloudflare)", "Celular / outro PC"), setas bidirecionais com um ícone de cadeado e a legenda "Tudo trafega cifrado; o servidor não tem a chave.", com `role="img"` e `aria-label` com o mesmo texto da legenda. Cores com os tokens do `UI_DESIGN.md`.

- [ ] Passo 1: testes: os 11 ids/títulos acima, em ordem; os 8 comandos de `sync-servidor`, idênticos e em ordem; a existência do `danger` em `sync-ativar` e do `warning` em `sync-servidor`; `searchGuide(…, 'autenticador')` inclui `sync-autenticador`; `SyncDiagram` renderiza um `img` com o `aria-label` acima.
- [ ] Passo 2: push só dos testes. Esperado: CI FALHA (artigos e componente faltando).
- [ ] Passo 3: escreva os artigos e o diagrama.
- [ ] Passo 4: push. Esperado: CI passa.
- [ ] Passo 5: commit `feat(guia): capítulo de sincronização e celular`

### Task 5: `GuideView` como central de ajuda

**Arquivos:** Reescrever `components/views/GuideView.tsx`. Criar `components/guide/GuideArticleView.tsx` (renderiza os blocos) e `components/guide/CommandBlock.tsx`. Modificar `App.tsx` (alvo do guia e navegação). Teste: `__tests__/components/GuideView.test.tsx`.

**Interfaces:** Consome `SectionedPage` (Task 2), `GUIDE_CHAPTERS`/`searchGuide`/`findArticle` (Task 3), `SyncDiagram` (Task 4), `NavTarget`/`isViewEnabled` (Task 1). Produz:
```ts
interface GuideViewProps {
  initialArticleId?: string
  enabledFeatures: FeatureId[]
  onNavigate: (target: NavTarget) => void
}
export function GuideView(props: GuideViewProps): JSX.Element
```
Em `App.tsx`: `const [guideArticleId, setGuideArticleId] = useState<string | undefined>()` e `const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('geral')`, mais `navigateTo(target: NavTarget)`, que limpa os alvos de busca como o `onNavigate` da Home já faz, grava o alvo e chama `setActiveView`. Abrir pela barra lateral zera os alvos: guia no primeiro artigo, Configurações em `geral`. `GuideView` recebe `key={guideArticleId ?? 'inicio'}`, para que um novo alvo reabra a tela no artigo pedido.

Comportamento (da spec):
- O primeiro artigo de Primeiros passos abre por padrão, ou o `initialArticleId` se ele existir; um id desconhecido cai no padrão.
- O campo "Buscar no guia" vai no `navTop`. Com a busca ativa, a lista mostra só os resultados de `searchGuide`. Se o artigo aberto sai dos resultados, abre o primeiro resultado. Sem resultados, aparece `Nada encontrado para "<termo>".` com o botão "Limpar busca". Esc no campo limpa a busca.
- `CommandBlock`: um `<pre>` monoespaçado e um botão com `aria-label="Copiar comando"` e o texto "Copiar". Com `await navigator.clipboard.writeText(cmd)` resolvido, o texto vira "Copiado" por 2000 ms; rejeitado, aparece "Não foi possível copiar." (`role="status"`).
- Avisos: `tip` com o ícone de lâmpada e o rótulo "Dica", `warning` com triângulo e "Atenção", `danger` com octógono e "Cuidado", nas cores das Restrições Globais.
- "Abrir esta tela" só aparece em artigo com `target`. Se `target.view` é uma AppView com feature e `!isViewEnabled`, o botão fica `disabled`, e ao lado aparecem "Esta área está oculta na barra lateral." e o botão "Mostrar em Configurações" → `onNavigate({view:'settings', section:'barra-lateral'})`.

- [ ] Passo 1: testes (com `navigator.clipboard` mockado e `vi.useFakeTimers` para os 2 s): abre em "Primeiros passos"; `initialArticleId="sync-autenticador"` abre esse artigo; digitar "sincronizacao" filtra a lista; digitar "xyzzy" mostra `Nada encontrado para "xyzzy".`, e "Limpar busca" restaura a lista; Esc limpa; "Copiar" chama `writeText` com o comando e mostra "Copiado", que some depois de 2000 ms; a rejeição mostra "Não foi possível copiar."; "Abrir esta tela" em Hábitos com `enabledFeatures=['habits']` chama `onNavigate({view:'habits'})`; com `enabledFeatures=[]`, o botão fica desativado, o texto de área oculta aparece e "Mostrar em Configurações" chama `onNavigate({view:'settings', section:'barra-lateral'})`.
- [ ] Passo 2: push só dos testes. Esperado: CI FALHA (props e textos novos inexistentes).
- [ ] Passo 3: implemente e ligue em `App.tsx`.
- [ ] Passo 4: push. Esperado: CI passa.
- [ ] Passo 5: commit `feat(guia): central de ajuda com busca e atalhos para as telas`

### Task 6: `SettingsView` em seções

**Arquivos:** Reescrever `components/views/SettingsView.tsx`. Modificar `components/settings/SyncSettings.tsx`, `UpdateSettings.tsx`, `WindowSettings.tsx` e `AutoLockSettings.tsx` (só o invólucro: sai o cartão externo com `h2` próprio, porque o título vem da página; os textos internos ficam). Modificar `apps/desktop/electron.vite.config.ts` (`renderer.define.__APP_VERSION__`), `env.d.ts` do renderer (`declare const __APP_VERSION__: string`), `vitest.config.*` (o mesmo `define`, com `'0.0.0-test'`) e `App.tsx`. Teste: `__tests__/components/SettingsView.test.tsx`; ajustar os testes existentes dos quatro componentes só se buscarem o `h2` removido.

**Interfaces:** Consome `SectionedPage` (Task 2), `SettingsSectionId`/`NavTarget` (Task 1). Produz:
```ts
interface Props {           // as props de hoje, mais:
  initialSection?: SettingsSectionId
  onOpenGuide: (articleId?: string) => void
}
export const SETTINGS_SECTIONS: { id: SettingsSectionId; label: string; description: string }[]
```
Seções, nesta ordem, com estes rótulos e descrições:

| id | rótulo | descrição | conteúdo |
| --- | --- | --- | --- |
| `geral` | Geral | Como o Sagyou deve chamar você. | campo de nome (o Perfil de hoje) |
| `aparencia` | Aparência | Tema, tamanho do texto e acessibilidade. | o bloco "Aparência e acessibilidade" de hoje |
| `barra-lateral` | Barra lateral | Escolha as áreas que aparecem na navegação. Seus dados não são apagados ao ocultar uma área. | a lista de features de hoje |
| `seguranca` | Segurança | Senha do app e bloqueio automático. | `PasswordSettings` + `AutoLockSettings` |
| `sincronizacao` | Sincronização | Mantenha seus PCs e o celular com os mesmos dados. | o link "Como funciona a sincronização" no topo + `SyncSettings`, com os blocos reordenados (ver Respostas da checagem) |
| `sistema` | Sistema | Janela, bandeja e atualizações do app. | `WindowSettings` + `UpdateSettings` |
| `sobre` | Sobre | Versão e ajuda. | `Versão {__APP_VERSION__}` + o botão "Abrir o Como funciona" |

O link de Sincronização chama `onOpenGuide('sync-o-que-e')`; "Abrir o Como funciona" chama `onOpenGuide()`. O cartão Criptografia é removido. `PreferenceButton` e os checkboxes passam do `#7c3aed` para o primário `#6d5bb8`. Em `App.tsx`: `<SettingsView key={settingsSection} initialSection={settingsSection} onOpenGuide={(id) => navigateTo({view:'guide', articleId:id})} …/>`.

- [ ] Passo 1: testes (com `window.electronAPI` mockado como nos testes existentes): abre em "Geral"; a navegação lista as 7 seções na ordem da tabela; nenhum texto "Criptografia"; `initialSection="sistema"` mostra "Janela e inicialização" (texto do `WindowSettings`) e o conteúdo de atualizações; clicar em "Sincronização" mostra "Como funciona a sincronização", e clicar nele chama `onOpenGuide('sync-o-que-e')`; "Sobre" mostra "Versão 0.0.0-test", e "Abrir o Como funciona" chama `onOpenGuide(undefined)`; em "Aparência", trocar o tema chama `onSetUiPreferences` com o objeto de hoje e só o tema alterado; em "Barra lateral", desmarcar uma área chama `onSetFeaturePreferences` sem ela; em "Segurança", digitar uma nova senha, ir para "Geral" e voltar deixa o campo vazio, sem chamar `security.enable`.
- [ ] Passo 2: push só dos testes. Esperado: CI FALHA (seções e props inexistentes).
- [ ] Passo 3: implemente. Mova `PasswordSettings`, `PreferenceButton`, `TogglePreference` e `SectionTitle` sem mudar a lógica deles.
- [ ] Passo 4: push. Esperado: CI passa, inclusive os testes existentes de Sync/Update/Window/AutoLock.
- [ ] Passo 5: commit `feat(configuracoes): seções com menu lateral e sem o cartão de criptografia`

### Task 7: Fechamento

- [ ] Atualizar `CLAUDE.md` (a tabela de Views: `guide` = central de ajuda com conteúdo em `guide/content.ts`; `settings` em seções; `navigation.ts`; a regra "um texto novo do guia sobre sync precisa bater com o código"), `GUIDE.md` (uma linha sobre `guide/content.ts`) e `README.md` (onde cita "Configurações → Sincronização", o caminho continua válido; acrescentar que o app traz o passo a passo em Como funciona → Sincronização e celular).
- [ ] Push e CI verde (typecheck, testes, lint do diff). Nada roda localmente.
- [ ] Verificação no app (`npm run dev`) feita **pelo usuário**, roteiro no PR: navegar pelas 7 seções com o mouse e com ↑/↓; estreitar a janela e ver a lista virar faixa; ativar/desativar a senha; abrir o guia por "Sobre" e por "Como funciona a sincronização"; buscar "wrangler" e copiar um comando; ocultar Hábitos e tentar "Abrir esta tela" em Hábitos.
- [ ] Revisão (`sagyou-review`, com o `sagyou-ui-reviewer`) e PR (`sagyou-pr`) apontando a divergência README × código, se houver.
- [ ] Concluir as três tasks do Sagyou.
- [ ] Commit `docs(configuracoes-e-ajuda): documentação`

## Tasks no Sagyou (via MCP)

Uma por mudança da spec, no projeto do Sagyou:
1. **Reformular Configurações**: Tasks 1, 2 e 6 do plano.
2. **Guia de sincronização (Cloudflare, aparelhos, autenticador)**: Task 4.
3. **Reformular o Como funciona**: Tasks 3 e 5.
