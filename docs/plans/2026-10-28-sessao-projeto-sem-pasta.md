# Plano de implementação: sessão de projeto sem pasta

Status: approved by Luis on 2026-10-28
Spec: docs/specs/2026-10-28-sessao-projeto-sem-pasta.md
Branch: feature/sessao-projeto-sem-pasta

**Objetivo:** abrir uma sessão de projeto no workspace privado quando nenhuma raiz de código for escolhida, mantendo o projeto no MCP.

**Arquitetura:** O painel envia `rootPath: ''` para a escolha **Sem pasta de código**. O main resolve esse valor para o workspace privado do `userData`, mas valida caminhos preenchidos contra raízes ativas do projeto. A run continua criando worktree destacado e capturando `projectId` para o MCP.

## Restrições globais

- O renderer nunca escolhe o caminho privado. Caminho preenchido fora das raízes ativas continua recusado.
- O projeto precisa existir no `loadData()` antes de criar workspace, worktree, PTY ou MCP.
- Sessões interativas arquivam o diff e não aplicam patch no diretório de origem.
- Nenhum schema ou backup muda; sessão com pasta autorizada mantém comportamento atual.

## Foco de review

1. **Escalada de caminho:** `request.path` arbitrário para projeto é recusado. Testado na Task 2.
2. **Projeto perdido no MCP:** `projectId` da sessão sem pasta chega a `prepareAgentMcpSession`. Testado no fluxo Electron da Task 3.
3. **Workspace compartilhado indevidamente:** duas sessões ganham worktrees destacados distintos. Testado no fluxo Electron da Task 3.
4. **Patch aplicado no lugar errado:** sessão sem pasta arquiva diff sem entregar à raiz privada ou ao projeto. Testado no fluxo Electron da Task 3.
5. **Projeto removido:** falha antes de criar diretório ou executor. Testado no helper da Task 2 e no fluxo Electron da Task 3.

### Task 1: painel permite sessão sem pasta

**Arquivos:** modificar `src/renderer/src/components/ai/fleet/NewSessionPanel.tsx`; testar em `src/renderer/src/__tests__/components/FleetView.test.tsx` ou novo `NewSessionPanel.test.tsx`.

**Interface:** `SessionRequest.rootPath === ''` representa escolha do workspace privado; projeto continua em `SessionRequest.projectId`.

- [ ] Escrever teste que seleciona projeto sem raiz, encontra **Abrir sessão** habilitado, vê o aviso exato da spec e envia `projectId` com `rootPath: ''`; verificar raiz ativa pré-selecionada e opção explícita sem pasta.
- [ ] Rodar `npx vitest run src/renderer/src/__tests__/components/NewSessionPanel.test.tsx` e ver falha pelo bloqueio atual.
- [ ] Ajustar seletor, aviso e `disabled`, sem mudar a validação de executor.
- [ ] Reexecutar teste e typecheck; commit `feat(fleet): permitir escolher sessao sem pasta`.

### Task 2: main cria run privada com projeto

**Arquivos:** modificar `src/main/index.ts`; extrair resolução/validação para `src/main/modules/agent/agent-session-root.ts`; testar em `src/main/__tests__/agent-session-root.test.ts` e `src/main/__tests__/agent-infrastructure.test.ts`.

**Interface:** `resolveAgentSessionRoot({ projectId, requestPath, project, userDataDir }): { dir: string; codeRoot: string; privateWorkspace: boolean }` valida o projeto e raízes ativas; `codeRoot` permanece string (o caminho do workspace privado quando sem pasta), compatível com `CodeRunState`. O launcher passa o `projectId` capturado à `prepareAgentMcpSession`.

- [ ] Escrever teste RED: projeto sem raiz + caminho vazio retorna `general-agent-workspace`; projeto com raiz ativa + caminho preenchido retorna raiz; caminho arbitrário é recusado; projeto inexistente falha; geral com caminho preenchido falha.
- [ ] Escrever teste do helper: projeto inexistente falha antes de devolver caminho utilizável. Testar `AgentWorktreeManager` existente em repo Git temporário para duas worktrees distintas; o efeito do handler sobre o disco será verificado na Task 3.
- [ ] Ajustar o handler para resolver raiz no main, criar workspace privado quando `privateWorkspace`, e manter captura MCP. Worktree/diff/cleanup continuam pelo fluxo atual.
- [ ] Rodar testes específicos, typecheck e suíte; commit `feat(fleet): iniciar sessao de projeto no workspace privado`.

### Task 3: revisão e PR

- [ ] Rodar `npm run typecheck`, `npm test`, `npm run lint`; corrigir somente erros novos.
- [ ] Conferir no app com `npm run dev` o aviso, botão e abertura da sessão sem pasta usando projeto de teste: confirmar no log/MCP o `projectId`, iniciar duas sessões e observar worktrees distintos, encerrar após editar arquivo no workspace e verificar diff arquivado sem entrega, e tentar projeto removido antes de criar diretório. Registrar evidência no PR. Esta verificação cobre o handler de `index.ts`, que o Vitest não carrega.
- [ ] Se a arquitetura mudou, atualizar `CLAUDE.md`, `GUIDE.md` e `README.md` no mesmo PR.
- [ ] Abrir PR para `main` com template; não fazer merge.
