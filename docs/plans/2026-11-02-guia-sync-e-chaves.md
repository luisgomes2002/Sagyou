# Plano de implementação: Guia da sincronização entre aparelhos e das chaves

Status: approved by Luis on 2026-11-02
Spec: docs/specs/2026-11-02-guia-sync-e-chaves.md
Branch: feature/sync-conflitos-celular

**Objetivo:** explicar como a sincronização se comporta e para que serve cada chave, com o mesmo
texto no Como funciona do PC e numa tela nova do celular.

**Arquitetura:** os dois artigos são dados puros no core (`packages/core/src/sync/guide.ts`). O PC
os insere em `SYNC_ARTICLES` (com `target`) e ganha dois tipos de bloco (`keyExample`, `table`);
o celular renderiza os mesmos blocos num componente `SyncGuideContent`, usado pela tela
`ComoFunciona` e pelo pareamento.

## Restrições Globais

- Textos, ids e ordem dos blocos: exatamente os da spec (seção Comportamento). Ids `sync-comportamento` e `sync-chaves`, títulos "Como a sincronização se comporta" e "As chaves da sincronização".
- Ordem no capítulo do PC: depois de `sync-parear-celular`, antes de `sync-conflitos` (13 artigos).
- Exemplos falsos: código de recuperação de exemplo com 14 grupos de 4 e checksum inválido (`fromRecoveryCode` lança); códigos reserva de exemplo com 20 caracteres hex maiúsculos; selo "Exemplo"; rótulo de acessibilidade "Exemplo de <nome>, não é um valor real"; sem botão Copiar.
- Core sem Node e sem React (só dados e tipos).
- "Steps" com título da spec viram um `p` com o título seguido do `steps` (decisão do construtor: o `steps` do PC não tem título). Textos exatos: `p` "Quando cada aparelho sincroniza:" antes do item 2 e `p` "Como evitar conflitos:" antes do item 7 (artigo 1 com 9 blocos).
- "Onde guardar" (decisão do construtor; a tabela da spec não traz a coluna): Código de recuperação "Num gerenciador de senhas ou em papel, fora do celular e longe dos códigos reserva."; Código do autenticador "No app autenticador; não precisa anotar."; Códigos reserva "Num gerenciador de senhas ou em papel, separados do código de recuperação."; Senha de configuração do Worker "Num gerenciador de senhas."; Código de pareamento / QR "Não guarde: use na hora."
- Valores de exemplo exatos: recuperação `ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567-ABCD-EFGH-IJKL-MNOP-QRST-UVWX` + `\n` + `https://exemplo.workers.dev`; autenticador `123 456`; reserva `0A1B2C3D4E5F60718293` (um só, como amostra dos 8); senha de configuração `exemplo-de-senha-de-setup`; pareamento `sagyou-sync:1:https://exemplo.workers.dev:CHAVE-DE-EXEMPLO:CONVITE-DE-EXEMPLO`.
- 30 dias e 10 min ficam só no texto (as constantes não são exportadas pelo core); 5 s, 60 s e 15 min são conferidos contra `PUSH_DEBOUNCE_MS`, `POLL_MS`, `MAX_BACKOFF_MS`.
- Caminhos do celular são relativos a `apps/mobile/src/`. Em Ajustes, a linha "Como funciona a sincronização" fica por último na seção Sincronização (depois do status e da linha de conflitos).
- Celular: só tokens de `theme.ts` e componentes de `components/`; alvo de toque ≥ 48 dp; títulos de artigo com `accessibilityRole="header"`.
- Versões: desktop `1.3.0` (package.json + lock); celular continua `0.1.0`.

## Foco de Review

1. **Exemplo virar valor real.** O código de recuperação de exemplo nunca passa em `fromRecoveryCode`, e nenhum exemplo é copiável. Testado na Task 1 e Task 2.
2. **Texto divergente entre apps.** PC e celular leem o mesmo objeto do core; um teste do PC compara os blocos do artigo com os do core. Testado na Task 2.
3. **Busca do Como funciona.** `articleText` inclui nomes e linhas das chaves e as células da tabela (não o valor de exemplo); "chaves" e "recuperação" encontram `sync-chaves`. Testado na Task 2.
4. **Afirmações que o código desmente.** 5 s, 60 s e 15 min batem com `PUSH_DEBOUNCE_MS`, `POLL_MS`, `MAX_BACKOFF_MS` (teste lê as constantes); 30 dias, 10 min, 8 códigos e 6 dígitos foram conferidos à mão no código (sem constante exportada). Testado na Task 1.
5. **Pareamento sem navegação.** No modo pareamento não há navigator: o link abre o guia dentro da própria tela, com "Voltar". Testado na Task 3.

### Task 1: core — artigos do guia como dados

**Arquivos:** Criar `packages/core/src/sync/guide.ts`, `packages/core/src/sync/__tests__/guide.test.ts`.
**Interfaces:** Produz
`export type SyncGuideBlock = { type: 'p'; text: string } | { type: 'steps'; items: string[] } | { type: 'callout'; tone: 'tip' | 'warning' | 'danger'; text: string } | { type: 'keyExample'; name: string; example: string; lines: { label: string; text: string }[] } | { type: 'table'; head: [string, string]; rows: [string, string][] }`;
`export interface SyncGuideArticle { id: string; title: string; blocks: SyncGuideBlock[] }`;
`export const SYNC_BEHAVIOR_ARTICLE`, `SYNC_KEYS_ARTICLE`, `SYNC_GUIDE_ARTICLES` (os dois, nesta ordem); `export const EXAMPLE_LABEL = 'Exemplo'`; `export function exampleA11yLabel(name: string): string`.
- [ ] Passo 1: testes: ids/títulos; 5 `keyExample` com nomes da spec, cada um com as 6 linhas na ordem "Para que serve", "Quando é pedido", "Onde ver de novo", "Se perder", "Se alguém pegar", "Onde guardar"; o exemplo do código de recuperação tem 14 grupos de 4 + URL e `fromRecoveryCode` lança; exemplo de reserva casa `/^[0-9A-F]{20}$/`; tabela "Perdeu…/Usa…" com 6 linhas; o texto cita "5 s", "60 s", "15 min", "30 dias", "10 min".
- [ ] Passo 2: commit `feat(guia): artigos de comportamento e chaves do sync no core`.

### Task 2: PC — blocos novos e artigos no capítulo

**Arquivos:** Modificar `apps/desktop/src/renderer/src/guide/types.ts` (`GuideBlock` ganha `keyExample` e `table` do core), `guide/sync-content.ts` (insere os dois artigos com `target: SYNC_SETTINGS`), `guide/search.ts` (`articleText` inclui `name` + linhas de `keyExample` e células de `table`), `components/guide/GuideArticleView.tsx` (renderiza `KeyExample` e `GuideTable`). Testes `__tests__/guide/sync-content.test.ts`, `__tests__/guide/search.test.ts`, `__tests__/components/GuideView.test.tsx`.
- [ ] Passo 1: testes: capítulo com 13 artigos na ordem da restrição; blocos de `sync-comportamento`/`sync-chaves` iguais aos do core; busca "chaves" e "recuperação" acha `sync-chaves`, busca pelo valor de exemplo não acha; GuideView abre `sync-chaves` e mostra 5 selos "Exemplo", rótulo "Exemplo de Código de recuperação, não é um valor real", nenhum botão "Copiar" dentro do exemplo, e a tabela com cabeçalhos "Perdeu…"/"Usa…".
- [ ] Passo 2: `KeyExample`: caixa `#16161a`, valor em `font-mono` com `whitespace-pre-wrap break-all`, selo "Exemplo" (`#d9a640`), `<dl>` com as linhas; `GuideTable`: `<table>` com `<th scope="col">`.
- [ ] Passo 3: commit `feat(guia): artigos de comportamento e chaves no Como funciona`.

### Task 3: celular — tela Como funciona e link no pareamento

**Arquivos:** Criar `apps/mobile/src/components/SyncGuideContent.tsx`, `apps/mobile/src/screens/SyncGuideScreen.tsx`, `apps/mobile/src/screens/__tests__/SyncGuide.test.tsx`. Modificar `App.tsx` (`RootStackParams.ComoFunciona`, `Stack.Screen name="ComoFunciona" options={{ title: 'Como funciona' }}`), `screens/SettingsScreen.tsx` (linha "Como funciona a sincronização" → `navigate('ComoFunciona')`; tipo de `navigate` aceita `'Conflitos' | 'ComoFunciona'`), `screens/PairScreen.tsx` (link "Como funciona a sincronização" no passo "No PC" alterna para `SyncGuideContent` com botão "Voltar"), testes `SettingsScreen.test.tsx`, `PairScreen.test.tsx`.
- [ ] Passo 1: testes: a tela mostra os dois títulos como `header`; cada exemplo tem o rótulo de acessibilidade e o selo "Exemplo"; a tabela aparece como pares "Perdeu…: Um aparelho" / "Usa…: …"; Ajustes tem o botão "Como funciona a sincronização" que chama `navigate('ComoFunciona')` (com e sem conflitos); no pareamento, o link abre o guia e "Voltar" volta para o passo.
- [ ] Passo 2: commit `feat(mobile): tela Como funciona da sincronização`.

### Task 4: versão, docs, CI, review e PR

**Arquivos:** `apps/desktop/package.json`, `package-lock.json` (1.3.0), `CLAUDE.md`/`GUIDE.md` (texto do guia do sync vive no core; telas novas do celular), `README.md` (menção à tela Como funciona no celular), corpo do PR #40.
- [ ] Passo 1: bump e docs; commit `chore(release): desktop 1.3.0 e docs do guia`.
- [ ] Passo 2: push; CI do PR #40 verde (`gh pr checks 40 --watch`). Testes não rodam localmente (preferência do Luis).
- [ ] Passo 3: `/sagyou-review` da branch inteira (reviewer + security + UI) e `/sagyou-pr` (tirar do rascunho).
