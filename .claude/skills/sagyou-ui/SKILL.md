---
name: sagyou-ui
description: Use ao criar ou alterar telas, componentes, textos visíveis ou estilos do renderer do Sagyou (src/renderer/src/**/*.tsx, index.css), ou ao revisar como uma tela ficou.
---

# Sagyou: telas

A fonte da verdade visual é [`UI_DESIGN.md`](../../../UI_DESIGN.md). A referência aprovada é `components/financial/AnalyticsTab.tsx`. Esta skill resume o que não pode ser esquecido e o que costuma quebrar.

## Identidade: grafite sólido, cor só no conteúdo
- **Superfícies:**
  - fundo `#0b0b0f`;
  - sidebar e colunas `#121216`;
  - cartões, painéis e modais `#16161a`;
  - campos `#101014`;
  - hover `#222227`;
  - selecionado `#2a2a30`;
  - borda `#2b2b31`.
- **Texto:** rótulo `#999999` e texto principal `#d4d4d4`.
- **Cor semântica** vai no valor, no ícone ou num indicador pequeno, nunca no cartão inteiro nem em faixa no topo ou na lateral:
  - verde `#46d478`/`#20b858`;
  - vermelho `#ec6a6a`/`#e04040`;
  - roxo `#a080f0`;
  - atenção `#d9a640`;
  - ação primária `#6d5bb8` (hover `#7b69c6`).
- **Proibido:**
  - preenchimento com opacidade baixa (`bg-[#cor]/10`, `border-[#cor]/30`, `rgba(…, 0.1)`, texto colorido com opacidade);
  - neon (`#f0b820`, `violet-600/700`, `*-300` sobre fundo escuro);
  - `shadow`/`glow` colorido;
  - `animate-pulse`.
- **Transparência só quando tem função:** scrim de modal, desabilitado, arrastar e o que aparece no hover.
- **Botão de criar/adicionar:** fundo neutro sólido já no estado normal, com a cor de destaque só no ícone.

## Use o que já existe
- **Componentes prontos:**
  - `ModalBase`, que já prende o foco e fecha com Esc;
  - `ConfirmDialog` e `useDeleteConfirm`;
  - `EmptyState`;
  - `SectionHeader`;
  - `CancelButton`.

  Não crie outro modal, confirmação ou estado vazio.
- **Dependência nova** de UI, animação ou ícone só com aprovação (`docs/workflow.md`).
- **Débito conhecido:** ainda há violações no código:
  - `animate-pulse` em `TaskCard`, `AgentTerminal` e `TaskViewModal`;
  - tons `-200`/`-300` em `UnlockScreen` e `CodeDiff`;
  - opacidade em `CodeDiff` (`/40`), `PlanView` (`/30`) e `SprintBadge` (`/50`).

  **Não copie padrão desses trechos.** Se tocar num deles, corrija na mesma mudança.

## Regras que quebram se esquecidas
- **Texto:** todo texto visível em pt-BR, curto e direto ("Não deu para salvar, tente de novo."). Código, nomes e comentários ficam em inglês. Use as strings exatas da spec.
- **Componentes:** função nomeada e export nomeado. Arquivo de componente só exporta componentes, e helpers vão para `utils/`.
- **Markdown:** `react-markdown` sem `rehype-raw`, e nunca `dangerouslySetInnerHTML` com texto de usuário, agente, memória ou web.
- **Acessibilidade:**
  - todo input tem label;
  - botão é `<button>` de verdade;
  - ícone sozinho tem `aria-label`;
  - foco visível;
  - erro com `role="alert"`.
- **Estados:** vazio, carregando, erro, texto longo (título de 200 caracteres) e lista grande (centenas de tasks) não podem quebrar o layout nem rolar na horizontal.
- **Tamanho:** a janela mínima precisa funcionar, e a maximizada não pode deixar uma faixa vazia gigante.

## Olhe a tela
`npm run dev` abre o app. O agente não consegue capturar a janela do Electron sozinho, então:
- liste ao humano as telas e os estados que mudaram, para ele conferir no app;
- quando houver teste de componente (Testing Library), afirme o texto e os papéis acessíveis, não as classes.
