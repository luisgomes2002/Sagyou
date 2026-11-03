# plan: docs/plans/2026-11-03-controle-remoto-app.md
Task 1: complete (46a5d6b)
Task 2: complete (465c25c)
Task 3: complete (b32b1af)
Task 4: complete (ddaf3b2)
Task 5: complete (e729468)
Task 6: complete (ff59f04; typecheck fix e511406)
Task 7: complete (fdae93e)
Task 8: complete (ae99f39)
Task 9: Decisão: corpos das mensagens (authorize-request/remote, authorized, esp32-key, result, approval-card/answer/closed) em packages/core/src/control/bodies.ts — o celular (Task 13) precisa dos mesmos formatos — custo se errada: mover/renomear parsers.
Task 9: Decisão: authorize-remote certo NÃO chama removeController no Worker (a resposta da checagem diz que só o Worker limpa em /roles/remote, e o Worker já faz clearControllers) — custo: nenhum, o Worker é a fonte.
Task 9: Decisão: authorize() é assíncrono (chama addController/send) — Task 10 deve aguardar.
Task 9: Decisão: serviço só roda depois de syncStatusChanged com sync ativo (ok/offline/update-pending, sem pausa); Task 10 deve repassar o status atual logo após criar o serviço.
Task 9: Decisão: extras checkDevices(), running(), lastError() para a Task 10 (revogar pela tela de sync e remote:status).
Task 9: Nota: teste e implementação foram num único push (só CI), sem a rodada FALHA separada.
Task 9: complete (b7c44cc..2adbd41, CI → aguardando)
Task 10: Decisão: chave do ESP32 devolvida em hex (64 caracteres) para colar no secrets.h — custo: Task 18/firmware decodificar hex.
Task 10: Decisão: ponte de cartões em handlers/remote.ts (createRemoteCards.park embrulha parkMcpApproval e fecha o cartão em qualquer desfecho); remoteUnlock puro testável — o teste de "não chama loadData" fica no remoteUnlock, que não tem acesso ao loadData.
Task 10: Decisão: sessão do cartão = run.agent (nome do harness); sync:revoke chama remoteService.checkDevices().
Task 11: Decisão: seção "Controle remoto" entra entre Acesso MCP externo e Sistema (nona seção, não oitava: já havia oito); textos em utils/remoteControlText.ts; código do pedido mostrado como "482 913".
Task 12: Decisão: artigo sync-trocar-celular vive no core (SYNC_SWITCH_PHONE_ARTICLE, aparece também no celular); no desktop aponta para a seção controle-remoto.
Task 10/11/12: commits a3ebb18, 3f084da, 4cb700d, ceaf79f — CI pendente.
Task 9: complete (b7c44cc..792215e, CI run 41698584643 → passa)
Task 10: complete (a3ebb18..792215e, CI run 41698584643 → passa)
Task 11: complete (4cb700d..792215e, CI run 41698584643 → passa)
Task 12: complete (ceaf79f..792215e, CI run 41698584643 → passa)
Task 10b: complete (0c33292, CI run 41702667825 → passa) — adendo aprovado por Luis: pc-key + install-update; remote-fetch removido
Task 13: Decisão: a chave pública do celular também fica no secure store (sagyou.control.public, sem biometria) e o estado da autorização em sagyou.control.state; renew() assina com a chave em memória (uma biometria só no pedido).
Task 13: Decisão: antes de conhecer a chave do PC, o celular só aceita um "result" não verificado que responda ao próprio pedido de autorização (no pior caso, um falso só faz pedir de novo).
Task 15: Decisão: o celular não tem lista de aparelhos; o aviso dos celulares anteriores aparece sem atalho (revogar o perdido fica pelo PC ou numa task futura).
Task 16: Decisão: código escrito antes dos testes (WIP de 2026-11-03), então não houve rodada FALHA separada; os testes vieram no mesmo commit — custo: um teste que passaria sem o código não é detectado.
