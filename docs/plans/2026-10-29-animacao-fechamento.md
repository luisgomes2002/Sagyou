# Plano de implementação: aviso de encerramento

Status: approved by Luis on 2026-10-29
Spec: docs/specs/2026-10-29-animacao-fechamento.md
Branch: feature/animacao-fechamento

**Objetivo:** mostrar o fechamento em andamento e confirmar o flush do estado antes de encerrar a janela.

**Arquitetura:** o evento `app:flush-before-close` existente no main/preload inicia um pequeno componente de ciclo de vida no renderer. Ele mostra uma camada de fechamento, chama `_flushPersist()` somente quando o estado já foi carregado e só então responde com `flushBeforeCloseComplete()`. O main mantém seu timeout de segurança e ignora pedidos de fechamento repetidos enquanto aguarda. Nenhum canal IPC ou dado persistido novo é necessário.

## Restrições Globais

- Texto visível: `Fechando Sagyou…`; em erro: `Não foi possível salvar os dados. Aguarde o fechamento.`
- O handshake assíncrono existente continua sendo a única autorização de fechamento antecipado.
- Timeout de segurança existente: 10 segundos a partir do primeiro pedido; não reiniciar em cliques repetidos.
- Sem mudança de schema, backup, normalização ou dados em `userData`.
- UI em pt-BR, cores de `UI_DESIGN.md`, animação desativada com `prefers-reduced-motion`.
- A camada cobre também os estados de carregamento e desbloqueio.
- Se `isLoaded` for falso, fechar sem salvar o estado inicial vazio sobre os dados reais.
- O handler `store:save` no main é síncrono; mensagens IPC do mesmo renderer chegam em ordem. O flush final cancela o debounce pendente antes de enviar sua gravação.

## Foco de Review

1. **Dados pendentes:** a janela permanece aberta até `_flushPersist()` resolver e só então recebe a confirmação; dados já persistidos continuam íntegros. Testado nas Tasks 2 e 3.
2. **Renderer sem resposta:** o timeout de 10 segundos ainda fecha a janela. Testado na Task 1.
3. **Cliques repetidos:** um novo clique não prolonga o timeout nem dispara outro flush. Testado nas Tasks 1 e 3.
4. **Erro de gravação:** a tela informa falha, não envia confirmação de sucesso e espera o timeout. Testado na Task 3.
5. **Bloqueio, carga e acessibilidade:** fechar antes de carregar não sobrescreve dados existentes; botão e fechamento nativo mostram o mesmo estado, com texto acessível e movimento reduzido. Testado nas Tasks 1 e 3.

### Task 1: proteger o handshake do main contra pedidos repetidos

**Arquivos:** modificar `src/main/handlers/window.ts`; criar `src/main/__tests__/window-close.test.ts`.

**Interfaces:** preservar `createManagedWindow(options): ManagedWindow` e `ManagedWindow.completeClose(): void`; nenhuma API nova.

- [ ] Escrever o teste antes da lógica: primeiro `close` impede destruição e envia `app:flush-before-close` uma vez; segundo `close` não reinicia os 10 segundos; `completeClose` encerra uma vez; sem resposta, o timeout encerra.
- [ ] Rodar `npx vitest run src/main/__tests__/window-close.test.ts` e ver falhar no caso de repetição.
- [ ] Alterar o listener `close` para ignorar pedidos adicionais enquanto espera, preservando a confirmação e o timeout.
- [ ] Rodar o teste e `npm run typecheck`; commit `fix(window): manter prazo do fechamento`.

### Task 2: cancelar o debounce antes do flush final

**Arquivos:** modificar `src/renderer/src/store/kanban.ts` e `src/renderer/src/__tests__/store/kanban.test.ts`.

**Interfaces:** preservar `_flushPersist(): Promise<void>`; ao iniciar, cancelar e zerar `_persistTimer` antes de capturar o estado atual.

- [ ] Escrever teste de regressão: um `_persist()` agenda a gravação; `_flushPersist()` salva uma vez; avançar 300 ms não provoca gravação posterior. Confirmar que a gravação enviada tem o estado atual.
- [ ] Rodar `npx vitest run src/renderer/src/__tests__/store/kanban.test.ts` e ver falhar no caso do debounce.
- [ ] Cancelar o timer no início de `_flushPersist()`. Gravações IPC já enviadas terminam antes da gravação final porque o handler `store:save` é síncrono e recebe as chamadas do mesmo renderer em ordem.
- [ ] Rodar o teste e `npm run typecheck`; commit `fix(store): cancelar debounce no flush final`.

### Task 3: mostrar o estado de encerramento e salvar antes de fechar

**Arquivos:** criar `src/renderer/src/components/layout/ClosingScreen.tsx` e `src/renderer/src/components/layout/CloseLifecycle.tsx`; modificar `src/renderer/src/main.tsx`; criar `src/renderer/src/__tests__/components/CloseLifecycle.test.tsx`.

**Interfaces:** `CloseLifecycle` registra `window.electronAPI.lifecycle.onFlushBeforeClose`, chama `useKanbanStore.getState()._flushPersist()` apenas se `isLoaded` for verdadeiro e, em sucesso, `flushBeforeCloseComplete()`. Com `isLoaded` falso, confirma o fechamento sem gravar. `ClosingScreen` recebe `error: boolean` e mostra o texto da spec. `main.tsx` monta `CloseLifecycle` como irmão de `App`, para cobrir também os retornos condicionais de segurança/carga.

- [ ] Escrever testes de componente antes da lógica: evento recebido mostra `Fechando Sagyou…` e cobre a UI; promessa de flush pendente não confirma; sucesso confirma uma vez; evento duplicado não cria outro flush; com `isLoaded=false`, confirma sem salvar; rejeição mostra a mensagem de erro e não confirma; desmontagem remove listener; a animação tem variante para movimento reduzido.
- [ ] Rodar `npx vitest run src/renderer/src/__tests__/components/CloseLifecycle.test.tsx` e ver falhar.
- [ ] Implementar a camada sem dependência nova, com `role="status"`, animação CSS discreta e `motion-reduce:animate-none`. Agendar o flush após um `requestAnimationFrame` para permitir pintura, com fallback de 100 ms para janelas em segundo plano; executar apenas uma vez.
- [ ] Rodar teste e `npm run typecheck`; commit `feat(window): mostrar encerramento enquanto salva`.

### Task 4: revisão, validação e PR

- [ ] Rodar `npm run typecheck`, `npm test` e `npm run lint`; corrigir erros introduzidos.
- [ ] Revisar o diff inteiro: preservação de dados, timeout, IPC, acessibilidade e aderência ao `UI_DESIGN.md`.
- [ ] Verificar no app com `npm run dev` o fechamento pelo botão e pelo sistema; se a janela não puder ser inspecionada no ambiente, registrar essa limitação no PR e indicar os estados para conferência manual.
- [ ] Abrir PR para `main` com `.github/pull_request_template.md`, citar spec/plano e verificar os checks do PR.
- [ ] Só após checks obrigatórios verdes, registrar na task do Sagyou o tempo decorrido desde sua criação e concluí-la; usar o cronômetro da task se o Sagyou permitir iniciá-lo. Não fazer merge.
