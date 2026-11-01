# Releases e atualização do app Android

Status: approved by Luis on 2026-11-01
Branch: feature/mobile-releases

> Revisão de 2026-11-01: a primeira versão foi aprovada por Luis no mesmo dia; esta revisão
> acrescenta a parte do desktop (deixar de depender do "Latest") e também foi aprovada por ele.

## Por quê

O APK do celular só sai como artifact de uma execução do Actions: fica escondido na aba
Actions, exige login no GitHub, vem dentro de um `.zip` e some em 90 dias. O desktop, ao
contrário, tem uma página de Release com os instaladores. E o celular não tem como saber que
existe uma versão nova: hoje alguém precisa lembrar de ir ao GitHub procurar.

## Objetivos

- Uma tag `mobile-v<versão>` gera um Release **rascunho** com o APK anexado, como o desktop.
- O desktop deixa de depender do "Latest" do repositório para se atualizar: procura o maior
  release `vX.Y.Z` publicado. Assim um release do celular (ou um "Latest" marcado por engano)
  nunca interrompe as atualizações dos PCs, e não há caixa nenhuma para lembrar de desmarcar.
- O app Android avisa sozinho quando há uma versão nova publicada e leva ao download com um
  toque; Ajustes mostra a versão instalada e permite procurar na hora.
- A versão do app começa em **0.0.1**, e cada versão nova instala por cima da anterior.

## Fora do escopo

- Baixar e instalar o APK de dentro do app (exigiria a permissão "instalar apps
  desconhecidos" para o Sagyou). O botão abre o APK no navegador; o Android cuida do resto.
- Instalação silenciosa: o Android sempre mostra a tela de confirmação fora da Play Store.
- Play Store, canais beta/prerelease e notas de versão dentro do app.
- Mudar o workflow de release do desktop ou o formato dos arquivos que ele publica
  (`latest*.yml`, `.blockmap`, instaladores).
- Proteger instalações do desktop anteriores a esta mudança: só Luis tem o app instalado.
- O visual definitivo do aviso: segue o padrão atual e será refeito na sprint
  "Mobile — Design e UX".

## Decisões (de Luis)

- Release só com tag `mobile-v*`, como rascunho que Luis publica depois de conferir.
- Rodar o workflow à mão continua gerando só o artifact, nunca um release.
- O celular procura atualização sozinho e avisa; baixar continua sendo pelo navegador.
- Versão do app em 0.0.1.
- O desktop para de usar o "Latest" (opção 6 de 2026-11-01). Só Luis tem o app instalado, e a
  1.0.0 dele pode ser reinstalada à mão se preciso.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Por que o "Latest" importava.** Conferido no `electron-updater` 6.8.11
  (`GitHubProvider.getLatestTagName`): o provedor `github` descobre a versão por
  `github.com/<owner>/<repo>/releases/latest`; o feed só fornece título e notas. Um release do
  celular marcado como Latest faria o PC procurar `latest.yml` nele e falhar.
- **Provedor de atualização próprio no desktop.** O `electron-updater` aceita
  `provider: 'custom'` com uma classe `updateProvider` (`providerFactory.js`). O desktop passa a
  usar uma classe nossa que lista os releases pela API pública do GitHub, escolhe o maior
  `vX.Y.Z` publicado (não rascunho, não prerelease) e lê o `latest*.yml` **desse** release. O
  download, a conferência do `sha512` do `latest*.yml`, o `.blockmap` e o resto continuam do
  `electron-updater`. A confiança é a mesma de hoje: quem pode publicar release no repositório.
- **Release do celular ainda com `--latest=false`**, só por organização: o selo "Latest" da
  página fica no desktop. Se alguém marcar errado, nada quebra.
- **`versionCode` = `major × 10000 + minor × 100 + patch`** (0.0.1 → 1, 0.1.0 → 100,
  1.2.3 → 10203), escrito em `app.json` (`expo.android.versionCode`). Um teste garante que ele
  bate com `expo.version`, e minor/patch ficam abaixo de 100. 0.0.1 → 1 é o mesmo valor que o
  APK instalado hoje já tem (sem `versionCode`, o Expo usa 1), então o primeiro APK novo
  instala por cima sem desinstalar.
- **A versão da tag é conferida no começo do build**, antes de qualquer passo pesado: tag
  `mobile-v0.0.1` com `app.json` em outra versão falha com mensagem clara.
- **Uma etapa (job) `release` separada**, a única com `contents: write`, que roda só em tag
  `mobile-v*`, depois do job `apk`. Ela não faz checkout nem vê a chave de assinatura: baixa o
  artifact e cria o release com `gh release create`. Actions fixadas por SHA, como no resto.
  Se já existir um release com essa tag, o job falha em vez de sobrescrever.
- **Fonte das atualizações fixa no código:** só a API pública
  `https://api.github.com/repos/luisgomes2002/Sagyou/releases`, sem token. O repositório é
  público; o limite sem login (60 consultas por hora por IP) sobra com uma consulta por dia.
- **Versão instalada** lida do `app.json` embutido no bundle (`expo.version`), sem dependência
  nova.
- **Preferências só do aparelho** (tabela `prefs`, nunca sincronizadas): a hora da última
  consulta automática e a versão que a pessoa dispensou.

## Comportamento

### CI (`.github/workflows/mobile-apk.yml`)

1. **Rodar à mão (Run workflow):** igual a hoje. Gera o APK assinado e o guarda como artifact
   `sagyou-mobile-apk`. Nenhum release.
2. **Push de tag `mobile-v<x.y.z>`:**
   - O job `apk` confere primeiro que `<x.y.z>` é igual a `expo.version` do `app.json`.
     Diferente: falha com `A tag mobile-v<tag> não bate com a versão do app.json (<versão>).`
   - Gera o APK como hoje (`sagyou-mobile-<x.y.z>.apk`) e o guarda como artifact.
   - O job `release` baixa o artifact, confere que o arquivo `sagyou-mobile-<x.y.z>.apk`
     existe e cria o release **rascunho** `mobile-v<x.y.z>`, título
     `Sagyou Android <x.y.z>`, com o APK anexado e `--latest=false`.
3. Uma tag `mobile-v*` não dispara o workflow do desktop (`v*.*.*`), e vice-versa.
4. Luis publica o rascunho na página Releases. Só depois disso os celulares o enxergam.

### Desktop: de onde vem a atualização

- A cada procura (ao abrir e pelo botão, como hoje), o desktop lista
  `https://api.github.com/repos/luisgomes2002/Sagyou/releases?per_page=100`, sem token.
- Considera só releases publicados (não rascunho, não prerelease) cuja tag seja exatamente
  `v<inteiro>.<inteiro>.<inteiro>`, e escolhe a maior versão. `mobile-v*`, rascunhos e o selo
  "Latest" não contam.
- Lê o `latest.yml` / `latest-mac.yml` / `latest-linux.yml` desse release, como antes. Daí em
  diante (comparar com a versão instalada, baixar, conferir, instalar, segurar o sync) tudo
  continua igual.
- Sem nenhum `vX.Y.Z` publicado, ou erro de rede/API: o mesmo erro de procura de hoje (estado
  `error`, sync liberado depois da espera de 10 s).
- O desktop sobe para **1.0.1** (PATCH: muda como a atualização é encontrada, não o que o app
  faz). A 1.0.0 instalada ainda acha a 1.0.1 pelo "Latest", desde que o release dela seja o
  Latest quando for publicado; se não achar, Luis instala a 1.0.1 à mão.

### App: procura automática

- Quando o app está desbloqueado e pareado e volta ao primeiro plano (ou abre), se a última
  consulta automática foi há **24 h ou mais**, consulta a lista de releases.
- Considera só releases **publicados** (não rascunho, não prerelease) cuja tag seja
  exatamente `mobile-v<inteiro>.<inteiro>.<inteiro>`, e escolhe a maior versão.
- Só há atualização se essa versão for **maior** que a instalada e o release tiver o anexo
  `sagyou-mobile-<versão>.apk` com URL de download começando com
  `https://github.com/luisgomes2002/Sagyou/releases/download/`. Qualquer outra URL é ignorada.
- Sem rede, erro, resposta inválida ou demora de mais de 15 s: não mostra nada, não marca a
  consulta e tenta de novo no próximo retorno ao app.
- A consulta não envia nenhum dado do usuário, token ou id de aparelho.
- Funciona também no modo só leitura (aparelho revogado).

### App: aviso

- Com atualização encontrada, aparece uma faixa no topo, abaixo do aviso de sync:
  `Versão <x.y.z> disponível` com os botões **Baixar** e **Agora não**.
- **Baixar** abre a URL do APK no navegador (`Linking.openURL`). O navegador baixa, a pessoa
  abre o arquivo e o Android pede para atualizar. Dados e pareamento continuam.
- **Agora não** esconde a faixa para aquela versão. Uma versão maior volta a mostrar a faixa.
- A faixa some sozinha quando a versão instalada já é igual ou maior.

### App: Ajustes

- Novo cartão **Versão do app**: `Instalada: <versão>`.
- Botão **Procurar atualização** (consulta na hora, sem o limite de 24 h, ignorando o
  "Agora não"). Enquanto consulta: `Procurando…` e botão desabilitado. Resultado:
  - Versão nova: `Versão <x.y.z> disponível` e botão **Baixar**.
  - Nada novo: `Você já está na versão mais recente.`
  - Falha: `Não foi possível verificar agora. Tente de novo mais tarde.`

## Dados

Sem mudança no formato dos dados sincronizados, no SQLite do desktop nem no backup. O
desktop não grava nada novo: o provedor próprio só troca de onde vem o `latest*.yml`.
No celular, duas chaves novas na tabela `prefs` (só do aparelho, apagadas ao desconectar como
as outras): `update.lastCheck` (instante ISO da última consulta automática que terminou) e
`update.dismissed` (versão dispensada com "Agora não"). Chave ausente = nunca consultou /
nada dispensado.

`app.json` passa a ter `expo.version: "0.0.1"` e `expo.android.versionCode: 1`;
`apps/mobile/package.json` e a linha dele no `package-lock.json` vão para `0.0.1`.

## Telas

- Faixa de atualização no topo (mesmo estilo da faixa de status de sync: fundo de superfície,
  borda inferior, texto legível, botões com área de toque ≥ 44).
- Cartão "Versão do app" em Ajustes, entre "Perfil financeiro" e o botão de desconectar.
- Textos em pt-BR exatamente como acima; os botões têm rótulo para leitor de tela.

Documentação: README "App Android" (como soltar uma versão: tag → rascunho → publicar; como o
celular avisa), CLAUDE.md e GUIDE.md (seção mobile/CI e o parágrafo "App updates": o desktop
escolhe o maior `vX.Y.Z` publicado, não o "Latest"), e a linha "Atualização automática do
app Android" em `docs/specs/2026-10-31-mobile-app.md` passa a apontar para esta spec.

## Perguntas em aberto

(nenhuma)
