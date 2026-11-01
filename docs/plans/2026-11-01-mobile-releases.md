# Plano de implementação: Releases e atualização do app Android

Status: approved by Luis on 2026-11-01
Spec: docs/specs/2026-11-01-mobile-releases.md
Branch: feature/mobile-releases

**Objetivo:** a tag `mobile-vX.Y.Z` gera um Release rascunho com o APK, o app Android avisa
quando há uma versão publicada mais nova, e o desktop deixa de depender do "Latest".

**Arquitetura:** o workflow `mobile-apk.yml` ganha uma conferência de versão no começo e um job
`release` separado, o único com `contents: write`. No app, `src/update/check.ts` (puro: lê a
lista de releases e decide se há atualização), `src/store/update.ts` (Zustand: consulta
automática a cada 24 h, consulta manual, "Agora não", prefs do aparelho) e duas telas: a faixa
`UpdateBanner` e o cartão "Versão do app" em Ajustes. No desktop, um provedor próprio do
`electron-updater` (`provider: 'custom'`) escolhe o maior `vX.Y.Z` publicado pela API do GitHub.

## Restrições Globais

- Tag `mobile-v<inteiro>.<inteiro>.<inteiro>`; release `--draft --latest=false`, título `Sagyou Android <x.y.z>`, anexo `sagyou-mobile-<x.y.z>.apk`.
- Rodar o workflow à mão nunca cria release.
- `versionCode = MAJOR × 10000 + MINOR × 100 + PATCH`; MINOR e PATCH < 100.
- Fonte: `https://api.github.com/repos/luisgomes2002/Sagyou/releases?per_page=100` (uma página; desktop e celular juntos, 100 sobra), sem token; só cabeçalho `Accept: application/vnd.github+json`.
- URL de download: o campo `assets[].browser_download_url` (nunca `assets[].url`, que é da API), aceito só com prefixo `https://github.com/luisgomes2002/Sagyou/releases/download/`, `name` exato e `state === 'uploaded'`.
- Versão instalada: `require('../../app.json').expo.version`, embutido no bundle no build (decisão do construtor: troca o `expo-constants` da spec; mesmo valor, sem dependência nova nem mudança no lock).
- Consulta automática: no máximo 1 a cada 24 h (`24 * 60 * 60 * 1000` ms), timeout de 15 s (`15_000` ms).
- Prefs do aparelho: `update.lastCheck` (ISO) e `update.dismissed` (versão). Nunca sincronizadas; apagadas pelo wipe (a tabela `prefs` já está na lista de `runtime.wipeLocal`).
- Textos exatos: `Versão <x.y.z> disponível`, `Baixar`, `Agora não`, `Versão do app`, `Instalada: <versão>`, `Procurar atualização`, `Procurando…`, `Você já está na versão mais recente.`, `Não foi possível verificar agora. Tente de novo mais tarde.`, `A tag mobile-v<tag> não bate com a versão do app.json (<versão>).`
- Actions fixadas por SHA; checkouts com `persist-credentials: false`; o job `release` não usa `environment`, `secrets.*` nem checkout.
- Testes do celular: Jest (`jest-expo`), `render`/`fireEvent` da Testing Library v14 com `await`. Testes do workflow: `apps/desktop/src/main/__tests__/release-config.test.ts` (vitest, node).
- Verificação: **pelo CI do GitHub** (Quality roda `npm run typecheck` e `npm test` de todos os workspaces), não localmente (preferência do Luis).

## Foco de Review

1. **O desktop para de se atualizar.** Esperado: o desktop ignora o "Latest" e `mobile-v*`, escolhendo o maior `vX.Y.Z` publicado; um release do celular marcado como Latest não muda nada. Rascunho/prerelease do desktop também não são oferecidos. Testado na Task 6.
8. **Provedor próprio quebrando a instalação do desktop.** `resolveFiles` precisa apontar para `/luisgomes2002/Sagyou/releases/download/<tag>/<arquivo>` (espaço vira `-`, como o `GitHubProvider`) e o canal precisa ser o da plataforma (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`). Testado na Task 6.
2. **APK que não instala por cima.** `versionCode` menor que o instalado (1) faz o Android recusar. Esperado: 0.0.1 → 1, e um teste amarra `versionCode` à versão. Testado na Task 1.
3. **Link de download malicioso ou de outro repo.** Uma resposta adulterada levaria a pessoa a baixar outro arquivo. Esperado: só a URL com o prefixo do repo e o nome exato do anexo; qualquer outra resposta = sem atualização. Testado na Task 3.
4. **Rascunho, prerelease ou tag torta oferecidos como atualização** (`mobile-v0.0.2-beta`, `v1.0.1` do desktop, `mobile-v1.2`). Esperado: ignorados. Testado na Task 3.
5. **Prefs existentes no celular.** Chaves novas na tabela `prefs` já existente, sem migração; chave ausente = nunca consultou. O wipe/"Desconectar" apaga a tabela `prefs` inteira (`runtime.ts`, lista de tabelas do wipe) e `useApp.wiped()` passa a zerar o `useUpdate`, para um "Agora não" antigo não valer depois de parear de novo. Testado na Task 4.
6. **Consulta que falha marca como feita** e some por 24 h. Esperado: só sucesso grava `update.lastCheck`. Testado na Task 4.
7. **Atualização achada que some ao reabrir.** Esperado (decisão do construtor): `update.lastCheck` só é gravado quando a consulta termina **sem** versão nova; com versão nova pendente, cada abertura consulta de novo e a faixa volta (até "Agora não"). Testado na Task 4.

### Task 1: versão 0.0.1 e versionCode

**Arquivos:** Modificar `apps/mobile/app.json` (`expo.version` `0.0.1` — já feito, não commitado — e `expo.android.versionCode: 1`), `apps/mobile/package.json` e `package-lock.json` (`packages["apps/mobile"].version` `0.0.1` — já feitos). Teste: `apps/mobile/src/__tests__/app-config.test.ts`.
**Interfaces:** Produz: `app.json` com `expo.version` e `expo.android.versionCode` consistentes.
- [ ] Passo 1: no `app-config.test.ts` existente (amplia o tipo do `require('../../app.json')` com `version: string` e `android.versionCode: number`), `it('o versionCode do Android segue a versão do app')`: lê `expo.version`, separa em `[maj, min, pat]`, espera `min < 100`, `pat < 100` e `expo.android.versionCode === maj * 10000 + min * 100 + pat`. `it('a versão do app é a mesma nos arquivos do celular')`: `require('../../package.json').version === expo.version` e `require('../../../../package-lock.json').packages['apps/mobile'].version === expo.version`.
- [ ] Passo 2: falharia porque `versionCode` não existe (sem rodar local; o CI prova).
- [ ] Passo 3: adiciona `"versionCode": 1` em `expo.android`.
- [ ] Passo 4: CI verde no PR.
- [ ] Passo 5: commit `chore(mobile): versão 0.0.1 e versionCode`.

### Task 2: workflow do APK cria o release rascunho

**Arquivos:** Modificar `.github/workflows/mobile-apk.yml`; teste `apps/desktop/src/main/__tests__/release-config.test.ts`.
**Interfaces:** Consome: `app.json` da Task 1. Produz: job `release`.
- [ ] Passo 1: testes (no teste existente "o workflow do APK só lê o repositório…", troca `not.toContain('contents: write')` por: o texto **antes** de `\n  release:` não contém `contents: write`; a contagem de `persist-credentials: false` = checkouts continua). O job `release` é o **último** do arquivo, depois de `apk`, então o bloco é `apk.slice(apk.indexOf('\n  release:'))`:
  - `permissions:` do topo continua `contents: read`; `contents: write` aparece **uma vez**, e só dentro do bloco `release`.
  - `mobile-apk.yml` dispara só por `workflow_dispatch` e tag `'mobile-v*'`; `release.yml` só por tag `'v*.*.*'` e `workflow_dispatch` (as tags não se cruzam).
  - o bloco `release` contém `needs: apk`, `if: startsWith(github.ref, 'refs/tags/mobile-v')`, `--draft`, `--latest=false`, `--title "Sagyou Android $v"`, e **não** contém `secrets.`, `environment:` nem `actions/checkout`.
  - o job `apk` tem o passo de conferência da tag **antes** de `npm ci`, com `if: startsWith(github.ref, 'refs/tags/mobile-v')` e a mensagem `não bate com a versão do app.json`.
  - os testes existentes de secrets (só os quatro), SHA fixado e ordem prebuild→wrapper→chave→gradle continuam valendo.
- [ ] Passo 2: falharia porque não há job `release` nem conferência.
- [ ] Passo 3: implementa:
  - no job `apk`, logo após o checkout, passo `Tag matches app.json`: `tag="${GITHUB_REF_NAME#mobile-v}"; app="$(node -p "require('./apps/mobile/app.json').expo.version")"; [ "$tag" = "$app" ] || { echo "A tag mobile-v$tag não bate com a versão do app.json ($app)."; exit 1; }`.
  - job `release`: `needs: apk`, `if:` acima, `runs-on: ubuntu-latest`, `permissions: contents: write`; passo `actions/download-artifact` (mesmo SHA do `release.yml`: `d3f86a106a0bac45b974a628896c90dbdf5c8093`) com `name: sagyou-mobile-apk`, `path: apk`; passo com `GH_TOKEN: ${{ github.token }}`: `v="${GITHUB_REF_NAME#mobile-v}"; f="apk/sagyou-mobile-$v.apk"; test -f "$f" || { echo "Falta $f"; exit 1; }`; se `gh release view "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY"` achar, falha com `O release $GITHUB_REF_NAME já existe.`; senão `gh release create "$GITHUB_REF_NAME" "$f" --repo "$GITHUB_REPOSITORY" --draft --latest=false --title "Sagyou Android $v" --notes "APK do Sagyou para Android. Publique com --latest=false: o Latest é do desktop."`.
  - atualiza o comentário do topo (hoje diz que nunca cria Release).
- [ ] Passo 4: CI verde.
- [ ] Passo 5: commit `ci(mobile): release rascunho do APK pela tag mobile-v*`.

### Task 3: decidir se há atualização (puro)

**Arquivos:** Criar `apps/mobile/src/update/check.ts`; teste `apps/mobile/src/update/__tests__/check.test.ts`.
**Interfaces:** Produz:
```ts
export const RELEASES_URL = 'https://api.github.com/repos/luisgomes2002/Sagyou/releases?per_page=100'
export const DOWNLOAD_PREFIX = 'https://github.com/luisgomes2002/Sagyou/releases/download/'
export const CHECK_TIMEOUT_MS = 15_000
export interface AvailableUpdate { version: string; url: string }
export function parseVersion(v: string): [number, number, number] | null   // só /^\d+\.\d+\.\d+$/
export function compareVersions(a: string, b: string): number               // <0, 0, >0
export function pickUpdate(releases: unknown, installed: string): AvailableUpdate | null
export function fetchLatest(fetchFn: typeof fetch, installed: string, timeoutMs?: number): Promise<AvailableUpdate | null> // lança em rede/HTTP≠200/JSON inválido/timeout
```
- [ ] Passo 1: testes de `pickUpdate` com `installed = '0.0.1'`:
  - publicado `mobile-v0.0.2` com anexo `sagyou-mobile-0.0.2.apk` e URL `DOWNLOAD_PREFIX + 'mobile-v0.0.2/sagyou-mobile-0.0.2.apk'` → `{ version: '0.0.2', url }`.
  - escolhe a maior entre `mobile-v0.0.2`, `mobile-v0.1.0`, `mobile-v0.0.10` → `0.1.0`; `0.0.10` > `0.0.9` (numérico, não texto).
  - ignora: `draft: true`, `prerelease: true`, `v1.0.1`, `mobile-v0.2`, `mobile-v0.0.2-beta`, versão igual ou menor que a instalada.
  - fixtures no formato real da API: `{ tag_name, draft, prerelease, assets: [{ name, state, url: 'https://api.github.com/...', browser_download_url }] }`; um asset com `state: 'starter'` não conta; um asset em que só `url` (API) existe não conta.
  - a maior sem o anexo certo, ou com URL fora do prefixo (`https://evil.example/...`, `http://github.com/...`, outro repo) → `null` (não cai para uma menor).
  - entrada que não é array, itens sem `tag_name`/`assets` → `null` sem lançar.
  - `fetchLatest`: chama `RELEASES_URL` com só `{ Accept: 'application/vnd.github+json' }` e um `signal`; status 403 → lança; JSON inválido → lança; fetch que nunca resolve → lança após o timeout (fake timers).
- [ ] Passo 2: falharia porque o módulo não existe.
- [ ] Passo 3: implementa com `AbortController` + `setTimeout`.
- [ ] Passo 4: CI verde.
- [ ] Passo 5: commit `feat(mobile): conferir releases do app no GitHub`.

### Task 4: store de atualização

**Arquivos:** Criar `apps/mobile/src/store/update.ts` e `apps/mobile/src/update/installed.ts`; modificar `apps/mobile/src/store/app.ts` (`wiped()` chama `useUpdate.getState().reset()`); teste `apps/mobile/src/store/__tests__/update.test.ts`.
**Interfaces:** Consome: Task 3. `RecordRepo.readPref/writePref`. Produz:
```ts
// installed.ts
export function installedVersion(): string   // require('../../app.json').expo.version
// update.ts
export const PREF_UPDATE_LAST_CHECK = 'update.lastCheck'
export const PREF_UPDATE_DISMISSED = 'update.dismissed'
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export interface UpdateDeps { repo: Pick<RecordRepo, 'readPref' | 'writePref'>; fetch: typeof fetch; now: () => number; installed: string }
export type ManualResult = 'idle' | 'checking' | 'available' | 'latest' | 'error'
export interface UpdateStore {
  available: AvailableUpdate | null
  dismissed: string | null
  manual: ManualResult
  autoCheck(deps: UpdateDeps): Promise<void>
  manualCheck(deps: UpdateDeps): Promise<void>
  dismiss(deps: UpdateDeps): void
  reset(): void   // volta a { available: null, dismissed: null, manual: 'idle' }
}
export function bannerUpdate(s: Pick<UpdateStore,'available'|'dismissed'>, installed: string): AvailableUpdate | null
export const useUpdate: UseBoundStore<StoreApi<UpdateStore>>
```
- [ ] Passo 1: testes com repo de prefs em memória e fetch falso:
  - `autoCheck` lê `update.dismissed` do repo **antes** do portão de 24 h (a faixa respeita o "Agora não" mesmo sem consultar).
  - sem `update.lastCheck` e nada novo → consulta e grava `new Date(now).toISOString()`.
  - com versão nova → preenche `available` e **não** grava `lastCheck`; a próxima `autoCheck` (mesmo 1 min depois) consulta de novo.
  - `lastCheck` há 23 h → não chama fetch; há 24 h → chama.
  - `useApp.getState().wiped()` zera `available`, `dismissed` e `manual`.
  - fetch que lança → não grava `lastCheck`, `available` continua `null`, não lança.
  - `dismiss` grava `update.dismissed = '0.0.2'`; `bannerUpdate` devolve `null` para `0.0.2` dispensada e devolve `0.0.3` quando ela aparece.
  - `bannerUpdate` devolve `null` se `available.version` ≤ instalada.
  - `manualCheck` ignora `lastCheck` e `dismissed`: passa por `'checking'` e termina em `'available'` (e preenche `available`), `'latest'` ou `'error'`; não grava `lastCheck`.
  - duas `autoCheck` simultâneas fazem um fetch só (flag em andamento).
- [ ] Passo 2: falharia porque o módulo não existe.
- [ ] Passo 3: implementa; `dismissed` é lido do repo a cada `autoCheck`.
- [ ] Passo 4: CI verde.
- [ ] Passo 5: commit `feat(mobile): procura de atualização a cada 24 h`.

### Task 5: faixa de atualização, consulta ao abrir e Ajustes

**Arquivos:** Criar `apps/mobile/src/components/UpdateBanner.tsx`; modificar `apps/mobile/src/App.tsx` (renderiza `<UpdateBanner />` logo abaixo de `<StatusBanner />` e dispara a consulta), `apps/mobile/src/screens/SettingsScreen.tsx` (cartão entre "Perfil financeiro" e o botão de desconectar). Nenhuma dependência nova. Testes: `apps/mobile/src/components/__tests__/UpdateBanner.test.tsx`, `apps/mobile/src/screens/__tests__/SettingsScreen.test.tsx`, `apps/mobile/src/__tests__/App.test.tsx`.
**Interfaces:** Consome: Task 4 (`useUpdate`, `bannerUpdate`, `installedVersion`). Produz: `export function useAutoUpdateCheck(): void` em `UpdateBanner.tsx`, chamado **dentro** do `UpdateBanner`, que o `AppShell` só renderiza no ramo final (`mode === 'app'`, que inclui o modo só leitura), depois dos `return` de `loading` e `pair`. Chama `autoCheck` ao montar e a cada `AppState` `'active'`. O `LockGate` só monta os filhos depois do primeiro desbloqueio; depois de um re-bloqueio eles continuam montados e a consulta pode rodar atrás da tela de bloqueio (decisão do construtor: aceito, a consulta não envia dado nenhum e a faixa fica coberta e escondida do leitor de tela).
- [ ] Passo 1: testes (mock de `Linking.openURL`; versão instalada é a do `app.json`, `0.0.1`):
  - faixa mostra `Versão 0.0.2 disponível`; `Baixar` (rótulo de acessibilidade `Baixar a versão 0.0.2`) chama `Linking.openURL(url)` com a URL exata; `Agora não` grava a pref e some.
  - sem atualização ou dispensada: nada renderizado.
  - App em modo `app` chama `autoCheck` uma vez ao montar, também com `readOnly: true`; em modo `pair` e `loading` não chama.
  - Ajustes: mostra `Versão do app` e `Instalada: 0.0.1`; `Procurar atualização` → `Procurando…` com botão desabilitado → cada resultado com o texto exato; com versão nova mostra `Versão 0.0.2 disponível` e `Baixar`.
- [ ] Passo 2: falharia porque os componentes não existem.
- [ ] Passo 3: implementa no estilo atual (mesmo visual do `StatusBanner`: `theme.surface`, borda inferior, botões com `minHeight` 44 via `Button`); `fetch` global e `Date.now` como deps.
- [ ] Passo 4: CI verde.
- [ ] Passo 5: commit `feat(mobile): aviso de nova versão e versão do app em Ajustes`.

### Task 6: desktop procura o maior `vX.Y.Z`, não o "Latest"

**Arquivos:** Criar `apps/desktop/src/main/modules/update/release-provider.ts`; modificar `apps/desktop/src/main/modules/update/app-updater.ts` (`UpdaterLike` ganha `setFeedURL(options: unknown): void`; `AppUpdaterDeps` ganha `feed: unknown`; `start()` com `enabled` chama `updater.setFeedURL(deps.feed)` **antes** do primeiro `checkForUpdates()`; desabilitado nunca chama), `apps/desktop/src/main/index.ts` (passa `feed: { provider: 'custom', updateProvider: DesktopReleaseProvider }`), versão do desktop **1.0.1** em `apps/desktop/package.json` e `packages["apps/desktop"]` do `package-lock.json`. Testes: `apps/desktop/src/main/__tests__/release-provider.test.ts` (`@vitest-environment node`) e o teste existente do `app-updater`.
**Interfaces:** Produz:
```ts
export const DESKTOP_RELEASES_API = 'https://api.github.com/repos/luisgomes2002/Sagyou/releases?per_page=100'
export function pickDesktopTag(releases: unknown): string | null   // maior /^v\d+\.\d+\.\d+$/, sem draft/prerelease
export class DesktopReleaseProvider extends Provider<UpdateInfo & { tag: string }> {
  constructor(options: unknown, updater: unknown, runtimeOptions: ProviderRuntimeOptions)
  getLatestVersion(): Promise<UpdateInfo & { tag: string }>
  resolveFiles(info: UpdateInfo & { tag: string }): ResolvedUpdateFileInfo[]
}
```
`Provider`, `parseUpdateInfo`, `resolveFiles` vêm de `electron-updater/out/providers/Provider` e `getChannelFilename` de `electron-updater/out/util` (o pacote 6.8.11 não tem campo `exports`, o import fundo funciona; o lock fixa a versão).
- [ ] Passo 1: testes:
  - `pickDesktopTag`: entre `v1.0.0`, `v1.0.1`, `v1.0.10`, `mobile-v9.9.9` (Latest), `v2.0.0` rascunho, `v1.1.0` prerelease, `v1.2` → `v1.0.10`; lista vazia ou não-array → `null`.
  - `DesktopReleaseProvider` com `runtimeOptions.executor` falso (`request(opts)` devolve pela URL) e `platform: 'win32'`: `getLatestVersion()` pede primeiro a API (com `Accept: application/vnd.github+json`) e depois `https://github.com/luisgomes2002/Sagyou/releases/download/v1.0.10/latest.yml`; devolve `version` do yml e `tag: 'v1.0.10'`. Com `platform: 'darwin'` pede `latest-mac.yml`; `linux` → `latest-linux.yml`.
  - sem `vX.Y.Z` publicado → rejeita com código `ERR_UPDATER_NO_PUBLISHED_VERSIONS`; API que falha → rejeita.
  - `resolveFiles` de um yml com `sagyou 1.0.10 setup.exe` → URL `https://github.com/luisgomes2002/Sagyou/releases/download/v1.0.10/sagyou-1.0.10-setup.exe`.
  - `app-updater`: habilitado, `start()` chama `setFeedURL` com o `feed` recebido antes de `checkForUpdates`; desabilitado não chama nenhum dos dois.
  - `release-config.test.ts`: `apps/desktop/package.json` e `packages["apps/desktop"]` do lock com a mesma versão.
- [ ] Passo 2: falharia porque o provedor não existe.
- [ ] Passo 3: implementa; o canal vem de `this.getDefaultChannelName()` do `Provider` (que já acrescenta `-mac`/`-linux`); requisições via `this.httpRequest`, como o `GitHubProvider`.
- [ ] Passo 4: CI verde.
- [ ] Passo 5: commits `feat(update): desktop procura o maior vX.Y.Z publicado` e `chore(version): desktop 1.0.0 → 1.0.1`.

### Task 7: documentação, review e PR

**Arquivos:** `README.md` ("App Android" e a parte de atualização do desktop), `CLAUDE.md` e `GUIDE.md` (linha do APK/mobile e o parágrafo "App updates"), `docs/specs/2026-10-31-mobile-app.md` (a linha "Atualização automática do app Android" passa a apontar para a spec nova). Também entram neste PR (decisão do Luis) as mudanças já feitas da regra de versão (`docs/workflow.md`, `AGENTS.md`, `GUIDE.md`, `CLAUDE.md`, `sagyou-pr`, `sagyou-reviewer`, template de PR).
- [ ] Passo 0: `CLAUDE.md` (bloco `apps/mobile`, frase do APK) e `GUIDE.md` (linha do celular): "a tag `mobile-vX.Y.Z` gera um Release rascunho com o APK (`--latest=false`, só por organização); o app consulta os releases `mobile-v*` publicados a cada 24 h (`src/update/check.ts`, `src/store/update.ts`) e abre o APK no navegador". No parágrafo "App updates" do `CLAUDE.md`: "o desktop usa `DesktopReleaseProvider` (`provider: 'custom'`) e escolhe o maior `vX.Y.Z` publicado pela API do GitHub; o selo Latest e os releases `mobile-v*` não importam". Na spec `2026-10-31-mobile-app.md`, a linha "Atualização automática do app Android (instala-se o APK novo à mão)." vira "… — coberto em `docs/specs/2026-11-01-mobile-releases.md` (aviso + download pelo navegador)."
- [ ] Passo 1: README — como soltar uma versão do celular: subir a versão (regra de versão), merge, `git tag mobile-vX.Y.Z && git push origin mobile-vX.Y.Z`, esperar o build, conferir e publicar o rascunho (de preferência sem marcar "Latest", que fica para o desktop; marcar por engano não quebra nada); como o celular avisa e onde ver a versão em Ajustes. Na parte do desktop: os PCs procuram o maior `vX.Y.Z` publicado.
- [ ] Passo 2: commit `docs(mobile-releases): release e atualização do celular` (e `docs(workflow): versão dos apps por SemVer` para a regra).
- [ ] Passo 3: `/sagyou-review` (inclui `sagyou-security-reviewer`: workflow com escrita, abertura de URL vinda da rede; `sagyou-ui-reviewer`: faixa e cartão).
- [ ] Passo 4: push, PR (`/sagyou-pr`; versão: celular 1.0.0 → 0.0.1 por decisão do Luis, desktop 1.0.0 → 1.0.1 PATCH) e `gh pr checks` até o Quality ficar verde.
- [ ] Passo 5: depois do merge (humano):
  - desktop: tag `v1.0.1`, publicar o rascunho como Latest; a 1.0.0 instalada acha a 1.0.1 (ou Luis instala à mão). Na 1.0.1, "Procurar atualização" responde que está atualizado.
  - celular: tag `mobile-v0.0.1`, publicar; instalar por cima do APK atual sem perder o pareamento; Ajustes mostra `Instalada: 0.0.1` e `Você já está na versão mais recente.`
  - conferir que o desktop 1.0.1 continua dizendo "atualizado" com o release do celular publicado.
