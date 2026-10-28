# Plano de implementação: paginação da tela de memórias

Status: approved by Luis on 2026-10-28
Spec: docs/specs/2026-10-28-memorias-paginacao.md
Branch: feature/memorias-paginacao

**Objetivo:** a tela de memórias recebe e mostra uma página por vez, sem perder o filtro de arquivadas e o salto do Ctrl+K.

**Arquitetura:**
- A função pura `pageMemories` fica em `src/main/modules/ai/memory.ts`.
- O handler `ai:memory:page` fica em `src/main/handlers/memory.ts`.
- A ponte `ai.memory.page` vai no preload, e o estado de página fica em `MemoryView.tsx`.

## Restrições Globais

- Somente leitura: o canal não chama `touchMemories` nem muda contadores.
- `ai:memory:list` não muda.
- Sem mudança de dados.
- Textos em pt-BR. Visual sem fundo com opacidade baixa nem neon nos elementos novos.

## Foco de Review

1. **Alvo do Ctrl+K fora da página.** A tela abre na página do `focusId`, e uma memória arquivada liga o filtro. Testado nas Tasks 1 e 2.
2. **Página vazia depois de apagar.** A tela volta uma página. Testado na Task 2.
3. **Contagens.** `activeCount` e `archivedCount` são de todas as memórias, não da página. Testado na Task 1.

### Task 1: `pageMemories` e o canal `ai:memory:page`

**Arquivos:**
- `src/main/modules/ai/memory.ts`;
- `src/main/handlers/memory.ts`;
- `src/preload/index.ts` (o tipo vem do retorno);
- testes em `src/main/__tests__/memory.test.ts`.

**Interfaces:**
- `pageMemories(all, { includeArchived, offset, limit, focusId? }) → { items, total, offset, activeCount, archivedCount }`.
  - Preserva a ordem recebida.
  - `limit` fora de 1–100 vira 25.
  - `offset` < 0 vira 0, e um `offset` além do fim vira o início da última página.
  - Um `focusId` presente no filtro define `offset = floor(índice / limit) * limit`.
- O handler chama `pageMemories(deps.store.listMemories({ includeArchived: true }), opts)`.
- O preload ganha `page(opts)`.

Passos:
- [ ] Testes:
  - página 1 e 2 com o total do filtro;
  - filtro desligado sem arquivadas;
  - contagens de todas;
  - limites de `limit` e `offset`;
  - `focusId` na página certa;
  - `focusId` arquivada com o filtro desligado → ignorado (offset pedido);
  - ordem preservada.
- [ ] Ver falhar → implementar → ver passar → typecheck.
- [ ] Commit `feat(memoria): canal paginado para a tela de memórias`

### Task 2: paginação na `MemoryView`

**Arquivos:** `src/renderer/src/components/ai/MemoryView.tsx`; teste novo em `src/renderer/src/__tests__/components/MemoryView.test.tsx`.

Passos:
- [ ] Testes, com `window.electronAPI.ai.memory.page` simulado sobre uma lista de 30:
  - mostra 25 e `Página 1 de 2`, e Próxima leva à 2;
  - Anterior fica desabilitado na 1;
  - ligar arquivadas volta à página 1 e pede `includeArchived: true`;
  - `searchTargetId` de uma memória arquivada liga o filtro e pede com `focusId`;
  - apagar o único item da última página volta uma;
  - sem a barra quando há uma página só.
- [ ] Ver falhar → implementar → ver passar.
- [ ] Typecheck, testes e lint dos arquivos alterados.
- [ ] Commit `feat(memoria): paginação na tela de memórias`

### Task 3: PR

- [ ] Suíte completa, review contra o Foco de Review e PR ("Sem mudança de formato de dados persistidos").
