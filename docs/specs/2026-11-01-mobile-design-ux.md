# Reformulação de design e UX do app Android

Status: approved by Luis on 2026-11-01
Branch: feature/mobile-design-ux

## Por quê

O app Android v1 (spec `2026-10-31-mobile-app.md`) funciona, mas incomoda de três jeitos ao mesmo tempo (Luis, 2026-11-01):

- **Criar é lento.** Lançar um gasto ou criar uma tarefa pede vários toques: entrar na aba, achar a tabela ou o projeto, abrir um formulário longo e digitar a data como `DD/MM/AAAA`.
- **Parece inacabado.** Só tem texto e bordas de 1 px com raio 8. Não há ícones nem hierarquia, a aba "Ajustes" é uma palavra solta no header e o ícone é o padrão do Expo.
- **É difícil achar as coisas.** Para ver o que vence hoje ou como está o mês, é preciso navegar demais.

## Objetivos

1. O celular parece o Sagyou do PC: mesma paleta e mesmas regras do `UI_DESIGN.md`, com o mesmo ícone.
2. **Criar em 1 toque:** um botão (+) visível em todas as abas abre Tarefa, Gasto, Receita ou Nota. O caminho feliz pede só o título ou o valor.
3. **O mais importante aparece logo na primeira tela de cada aba:** o que vence hoje, o saldo e o resumo do mês, e os hábitos de hoje.
4. Dá para usar com uma mão: ações principais na metade de baixo, alvos de toque de pelo menos 48 dp e gestos com alternativa por botão.
5. Cada tela tem estados de vazio, carregando e erro, retorno tátil discreto e boa acessibilidade (TalkBack, fonte grande, contraste).

## Fora do escopo

- **Apagar no celular** (tarefa, nota, lançamento). Continua só no PC e fica para outra spec. O "desfazer" desta spec cobre só ações que já existem.
- Faixa de nova versão e cartão "Versão do app" em Ajustes: são da spec `mobile-releases`, que vem **depois** desta. Esta spec só reserva o lugar (ver Telas).
- Features novas de dados: metas, planejamento, lista de compras, anexos, cronômetro e finanças completas (dívidas, faturas, transferências).
- Tema escolhido pelo usuário. O app segue o tema do sistema, como hoje.
- Cores dinâmicas do Material You, tablet e paisagem.
- Mudança no desktop, no core ou no Worker.

## Decisões (de Luis)

- **Ordem:** esta reformulação vai antes de `mobile-releases`. A faixa de versão e o cartão de Ajustes de lá serão construídos com os componentes novos daqui.
- **Prioridade:** os três incômodos pesam igual (criar lento, visual inacabado, difícil achar).
- **Direção visual:** igual ao PC e sóbria. O `UI_DESIGN.md` vale à risca: superfícies sólidas, cor no valor, no ícone ou num pequeno marcador, roxo `#6d5bb8` só na ação principal, sem brilho, sem neon e sem cartão pintado. O celular ganha raios maiores, ícones e espaçamento de toque.
- **Botão (+):** abre uma folha curta de baixo com **Tarefa, Gasto, Receita, Nota**. Cada opção abre um formulário enxuto. Projeto, tabela e sprint vêm do último usado.
- **Apagar:** fora. "Desfazer" aparece depois de concluir uma tarefa e de marcar ou desmarcar um hábito.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

- **Ícones:** `lucide-react-native` (traço fino e uniforme, combina com o visual sóbrio), que precisa de `react-native-svg`.
- **Gestos e animação:** `react-native-gesture-handler` + `react-native-reanimated` (deslizar para concluir, folha de baixo). Retorno tátil com `expo-haptics`. Datas com o seletor nativo do Android (`@react-native-community/datetimepicker`); o campo digitado `DD/MM/AAAA` sai.
- Dependências nativas novas exigem um APK novo. O workflow `mobile-apk.yml` continua o mesmo.
- **Raios:** 12 em cartões e folhas, 10 em campos e botões, 999 em chips e no (+). **Espaçamento** em múltiplos de 4 (4, 8, 12, 16, 24). **Tipografia:** fonte do sistema, escala 12 / 14 / 16 / 20 / 28, valores com `tabular-nums`. Sem sombra colorida; a elevação vem só de superfícies sólidas em tons diferentes (`bg` → `surface` → `selected`), mais a sombra neutra padrão do Android na folha de baixo e no (+).
- **Cor por significado (dos tokens atuais em `theme.ts`):** verde para receita e concluído, vermelho para gasto e atrasado, `attention` para vence hoje e avisos, roxo `purple` para seleção e marcadores, `primary` para o botão principal.
- **Último usado** (projeto da tarefa rápida, tabela do lançamento rápido, projeto da nota rápida) fica em `prefs`, só no aparelho, como já acontece com a última tabela.
- **Duração do "Desfazer":** 5 s numa barra inferior (snackbar) acima da tab bar. Um novo desfazer substitui o anterior.
- **Ícone de categoria:** mapa fixo para as categorias padrão do core (alimentação, transporte, moradia etc.). Categoria personalizada ou desconhecida usa um ícone genérico de etiqueta.
- Nomes das abas continuam: **Tarefas, Hábitos, Finanças, Notas, Busca**.

## Comportamento

### Geral
- Todo alvo de toque tem pelo menos 48×48 dp. Todo ícone sem texto tem `accessibilityLabel` em pt-BR.
- Com fonte do sistema em 200%, nenhum texto corta: as linhas quebram, os valores encolhem no máximo até 0,85 e os cartões crescem na altura.
- Contraste mínimo de 4,5:1 para texto e 3:1 para ícones, nos temas claro e escuro. Um teste confere os pares de tokens.
- Retorno tátil leve ao concluir uma tarefa, marcar um hábito e salvar um formulário. Nada vibra ao navegar.
- Animações curtas (≤ 200 ms): abrir e fechar a folha, entrar e sair do snackbar, item concluído saindo da lista. Com "Remover animações" ligado no Android, tudo fica instantâneo.
- Em modo somente leitura (`readOnly`), o (+), deslizar, marcar e Salvar ficam desabilitados, e o motivo aparece na faixa de status (como hoje).

### Shell
- A tab bar tem ícone + rótulo nas 5 abas. A aba ativa usa a cor `purple` no ícone e no rótulo, com um indicador em pílula atrás do ícone.
- O header de cada aba mostra o título à esquerda e um ícone de engrenagem à direita ("Ajustes"), que abre Ajustes.
- O (+) flutua no canto inferior direito, acima da tab bar, em Tarefas, Hábitos, Finanças e Notas. Na Busca ele some (o teclado ocupa a tela). Ao tocar, abre a folha "Criar" com 4 linhas de ícone + texto: **Tarefa, Gasto, Receita, Nota**.
- A faixa de status (somente leitura / offline com alterações aguardando) continua com os mesmos textos, agora numa linha discreta com ícone abaixo do header. Ela não empurra o conteúdo quando some.

### Criar rápido
- **Tarefa:** a folha tem o campo Título focado, com o teclado aberto, e a linha "Projeto ▸ <último usado>". Os chips opcionais Prazo (Hoje, Amanhã, Escolher data…) e Prioridade aparecem fechados. "Salvar" cria a tarefa na primeira coluna que não é Done, na sprint aberta mais recente (mesma regra do formulário atual, `latestOpenSprint`). Sem sprint aberta, cria sem sprint e não pergunta. "Mais campos" abre o formulário completo com o que já foi digitado. Título vazio deixa "Salvar" desabilitado. Sem nenhum projeto, aparece "Nenhum projeto ainda. Crie um no Sagyou do PC." e não há campo.
- **Gasto / Receita:** a folha tem o campo Valor focado, com teclado numérico e a moeda da tabela, e a linha "Tabela ▸ <última usada>". Chips de categoria aparecem numa linha rolável, e Data é hoje por padrão (chip "Hoje" que abre o seletor). Descrição é opcional. O valor usa `parseDecimalInput` com a moeda da tabela, como hoje. Valor inválido mostra o texto atual `INVALID_AMOUNT_TEXT`. Sem tabela no perfil, aparece o texto vazio atual.
- **Nota:** a folha tem o campo de texto focado e a linha "Projeto ▸ <último usado>". Texto vazio deixa "Salvar" desabilitado.
- Fechar a folha com algo digitado pergunta "Descartar?" (Descartar / Continuar editando). Sem nada digitado, fecha direto.

### Tarefas
- A tela inicial mostra primeiro o cartão **Hoje**: tarefas que vencem hoje e atrasadas, contadas ("3 para hoje · 1 atrasada"). Tocar abre Próximas. Sem nenhuma, o cartão diz "Nada vence hoje".
- Abaixo vem a lista de projetos não arquivados, na ordem do PC. Cada linha tem o ponto com a cor do projeto, o nome, as tarefas abertas e uma barra fina de progresso (concluídas / total) em `purple`.
- Dentro do projeto, as colunas viram abas roláveis no topo (chips), na ordem do PC, com a contagem; a coluna Done fica por último. A lista mostra a coluna escolhida. A linha da tarefa tem título, prioridade (ícone + cor só para Alta e Urgente), prazo (vermelho se atrasado, `attention` se hoje) e até 2 tags + "+N".
- **Deslizar para a direita** numa tarefa fora de Done conclui (mesma `completeTask` de hoje) e mostra "Tarefa concluída · Desfazer". Desfazer devolve a tarefa à coluna e à posição de antes, sem `completedAt`. O botão "Concluir" sai da linha e o mesmo gesto fica disponível como ação de acessibilidade ("Concluir") para o TalkBack.
- **Próximas** agrupa em seções: **Atrasadas, Hoje, Amanhã, Esta semana** (até domingo), **Mais tarde**. Seção vazia não aparece. Cada linha mostra o projeto.
- O formulário completo (novo e editar) abre como folha de altura cheia. Prazo e Prioridade usam chips e o seletor nativo de data; Coluna e Sprint, chips; "Nova sprint…" continua.

### Hábitos
- Cada hábito é um cartão com o ponto de cor, o nome, a sequência (ícone de chama do lucide + "5 dias", sem emoji) e um **botão grande "Hoje"** que marca ou desmarca hoje com um toque. Marcado, ele fica sólido em `selected` com o ícone de check na cor do hábito.
- Abaixo, a mini-semana (6 dias anteriores + hoje) continua tocável, como hoje.
- Marcar ou desmarcar mostra "Hábito marcado · Desfazer" (ou "desmarcado").
- No topo, um resumo: "3 de 5 hoje".

### Finanças
- A tabela é escolhida num seletor no topo ("Tabela ▸ Nubank"), que abre uma folha com as tabelas do perfil. O chip por tabela sai.
- O cartão **resumo do mês** mostra o Saldo atual (grande; vermelho se negativo, texto principal se positivo) e duas colunas: Entradas do mês (verde) e Saídas do mês (vermelho), na moeda da tabela. A navegação de mês fica fora: é sempre o mês atual.
- A lista de lançamentos do mês é agrupada por dia ("Hoje", "Ontem", "sex., 30/10"). Cada linha tem o ícone da categoria num círculo neutro, a descrição (ou a categoria), a categoria em texto discreto e o valor com sinal na cor semântica.
- Tocar abre a edição em folha. Lançamento travado (pagamento de dívida, espelho) mostra o aviso atual `LOCKED_TEXT` num snackbar, sem abrir.
- Os botões "Novo gasto" / "Nova receita" saem da tela; criar passa pelo (+).

### Notas
- O projeto é escolhido num seletor no topo, como em Finanças.
- As notas aparecem em cartões numa coluna, com até 6 linhas e a data da última edição ("editada há 2 h"). Tocar abre a edição em tela cheia com "Salvar" no rodapé.

### Busca
- O campo de busca fica no topo, focado ao entrar na aba, com um botão de limpar.
- Os resultados são agrupados por tipo (Tarefas, Projetos, Notas, Hábitos, Lançamentos), cada grupo com ícone e contagem. O termo aparece **destacado** (negrito + `purple`) no título.
- Sem texto, aparece "Busque tarefas, notas, hábitos e lançamentos". Sem resultado, "Nada encontrado para "<termo>"".
- A navegação ao tocar num resultado é a mesma de hoje.

### Ajustes
- As seções ficam em cartões com título discreto: **Este aparelho** (nome), **Sincronização** (estado, conflitos), **Perfil financeiro** (opções com rádio) e **Zona de perigo** ("Desconectar este aparelho", com o mesmo aviso e confirmação de hoje). Entre Perfil financeiro e Zona de perigo fica o lugar reservado para o cartão "Versão do app" de `mobile-releases`.

### Pareamento (onboarding)
- O pareamento vira um passo a passo de 3 passos com indicador "1 de 3":
  1. **Boas-vindas:** o ícone do Sagyou, "Leve suas tarefas, hábitos e finanças no bolso" e "Começar".
  2. **No PC:** "Abra Configurações → Sincronização → Parear novo aparelho no Sagyou do PC". Botões "Ler QR" e "Colar código".
  3. **Conectando:** o progresso e, em erro, o texto atual + "Tentar de novo". A retomada `resume('take-cloud')` continua como hoje.
- Os textos de erro e as regras de `PairScreen` não mudam.

### Bloqueio
- A tela de bloqueio mostra o ícone do Sagyou centralizado, "Sagyou bloqueado" e o botão "Desbloquear". O aviso de "sem bloqueio de tela no aparelho" mantém o texto atual. As regras de `LockGate` (5 min em segundo plano, nada renderiza antes) não mudam.

### Estados
- **Carregando:** no `mode === 'loading'`, uma tela com o ícone do Sagyou. Em listas que dependem do primeiro download após parear, aparece um skeleton (blocos neutros sem animação de brilho; no máximo uma variação lenta de opacidade, desligada com "Remover animações").
- **Vazio:** cada lista tem ícone + uma frase + o que fazer ("Nenhum projeto ainda. Crie um no Sagyou do PC.", mantendo os textos atuais onde existem).
- **Erro:** erro de salvar aparece no formulário (`accessibilityRole="alert"`), como hoje. Erro de sync aparece na faixa de status e em Ajustes.

### Ícone e splash
- O ícone do app vem de `apps/desktop/build/icon.png`, gerando o adaptive icon do Android: primeiro plano com margem segura (66% central), fundo sólido `#0b0b0f`, versão monocromática para os ícones temáticos do Android 13+, e também `icon.png` e `splash-icon.png`. A splash é o ícone centralizado sobre `#0b0b0f` (claro: `#f5f4f1`).

## Dados

Sem mudança de dados sincronizados, do SQLite do celular (`records`, `sync_*`) ou do core. Só entram novas chaves em `prefs` (só no aparelho, nunca sincronizadas, apagadas no wipe como as outras):
- `quick.lastProject` — projeto da última tarefa ou nota criada pelo (+).
- A última tabela continua em `lastTablePref(profileId)` (já existe).

O "desfazer" grava uma edição nova pelo `RecordRepo.save` (gera versão como qualquer edição). Ele não apaga versões nem reescreve o histórico. O invariante de `records.test.ts` (carregar → salvar sem editar = zero versões) continua valendo.

## Telas

Segue o `UI_DESIGN.md` (seção "Decisões"). Esboço do shell no tema escuro:

```
┌──────────────────────────┐
│ Tarefas               ⚙  │  header: título + engrenagem
│ ⚠ Offline · 2 aguardando │  faixa de status (só quando há)
│┌────────────────────────┐│
││ Hoje   3 para hoje · 1 ││  cartão Hoje → Próximas
││        atrasada       › ││
│└────────────────────────┘│
│ ● Sagyou    12  ▬▬▬▭▭    │  projetos com progresso
│ ● Casa       4  ▬▭▭▭▭    │
│                     (+)  │  criar rápido
│ ☑     ◎     $     ✎   ⌕  │  tab bar com ícones
│Tarefas Háb. Fin. Notas Busca
└──────────────────────────┘
```

Telas afetadas: shell (`App.tsx`), `components/ui.tsx` + `theme.ts` (design system), `TasksStack`/`TaskLists`/`TaskForm`, `HabitsScreen`, `FinanceScreen`, `NotesScreen`, `SearchScreen`, `SettingsScreen`, `PairScreen`, `LockGate`, `StatusBanner`, e os assets em `apps/mobile/assets`.

## Perguntas em aberto

(nenhuma)
