# Gate final — migração agent-first

Última execução automática: 2026-10-24 (ambiente Windows 11, branch `chore/agent-first-refactor`).

O caminho legado não pode ser removido nem a migração liberada enquanto qualquer
item abaixo estiver pendente ou falhar.

| Verificação                      | Estado          | Evidência / próximo passo                                                                                                                                                                        |
| -------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`              | aprovado        | Main e renderer sem erro.                                                                                                                                                                        |
| `npm test`                       | aprovado        | 88 arquivos, 1416 testes, ~113 s. O "inconclusivo" anterior era corte de 60 s: a suíte precisa de ~2 min.                                                                                        |
| `npm run test:coverage`          | aprovado        | Mesmos 88/1416, saída zero. Linhas 56,6 %, statements 54,8 %, branches 48,0 %, funções 47,4 %. Relatório de observação, sem gate de percentual.                                                  |
| Lint dos arquivos alterados      | aprovado (diff) | Nenhum erro em linhas alteradas pelo branch (7 corrigidos nesta rodada). Restam erros antigos em linhas não alteradas (p. ex. `App.tsx`, `Sidebar.tsx`, `store.ts`): dívida histórica, fora do gate. |
| `npm run lint` completo          | não executado   | Dívida histórica e ~16 mil avisos de fim de linha (CRLF) tornam o resumo inútil como gate; o CI filtra por diff.                                                                                 |
| `npm run build:win`              | aprovado        | Saída zero; `dist/sagyou-1.0.0-setup.exe` regenerado em 2026-10-24 20:22 (≈337 MB).                                                                                                              |
| Paridade dos 3 harnesses (CI)    | aprovado        | `harness-parity.test.ts`: detecção, início, entrada, resize, reconexão, Stop e término por Codex, Claude Code e OpenCode, sem iniciar CLI real.                                                  |
| Segurança de MCP e worktree (CI) | aprovado        | `mcp-worktree-security.test.ts`: mensagens malformadas, isolamento de perfil/projeto, aprovação de escrita, Stop, traversal, repositório com e sem commit.                                        |
| Instalação limpa do artefato     | pendente manual | Em VM/usuário sem dados: instalar o artefato recém-gerado, abrir, confirmar que não usa dados/configuração prévia e desinstalar.                                                                 |
| Codex (matriz manual)            | pendente manual | Executar `docs/agent-terminal-manual-test.md`; registrar versão do CLI e resultado de cada passo (login, modelo/effort, MCP, reconexão, Stop, entrega).                                          |
| Claude Code (matriz manual)      | pendente manual | Mesmo roteiro.                                                                                                                                                                                   |
| OpenCode (matriz manual)         | pendente manual | Mesmo roteiro. Autenticação e modelo aparecem como `unknown` na UI: confirmar que isso não bloqueia nem finge sucesso.                                                                           |
| Remoção do chat (migração) | pendente manual | Em `userData` isolado (nunca nos dados reais; o build de dev só roda a migração com `SAGYOU_RUN_LEGACY_CHAT_REMOVAL=1`): com histórico, conferir a pasta `backups/pre-remocao-chat-*`, a remoção dos itens, o aviso único no Fleet e que a segunda abertura não repete; sem histórico, conferir que não há snapshot nem aviso. |
| Backup/restore                   | pendente manual | Em perfil de teste, exportar backup com memória, importar, conferir conteúdo e restaurar o snapshot pré-importação. Importar também um backup **antigo** com `conversations`/`chatImages`: deve restaurar o resto e ignorar esses campos.                                                                     |

## Condição de liberação

Somente liberar quando todos os comandos automáticos tiverem saída zero (feito), o
artefato atual tiver sido instalado limpo e as três matrizes manuais e o
backup/restore estiverem completos. Uma falha de ambiente deve ser registrada e
resolvida ou explicitamente aceita pelo responsável; nunca deve ser convertida em
aprovação.

## Estado da documentação

`README.md`, `GUIDE.md`, `CLAUDE.md` e o roteiro manual listam os três harnesses. O chat por
perfil de API e o histórico de conversas foram **removidos** (spec
`docs/specs/2026-10-24-remover-historico-chat.md`): o Fleet é a única tela de IA e a sessão
abre direto no terminal. A migração única que apaga os dados antigos está descrita em
`docs/data-migrations.md` e precisa de verificação manual com dados isolados antes de uma
liberação (veja a linha **Remoção do chat** acima).
