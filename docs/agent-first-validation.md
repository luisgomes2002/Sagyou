# Gate final — migração agent-first

Data da execução: 2026-10-23 (ambiente Windows).

O caminho legado não pode ser removido nem a migração liberada enquanto qualquer
item abaixo estiver pendente ou falhar.

| Verificação                                                       | Estado          | Evidência / próximo passo                                                                                                                               |
| ----------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                               | aprovado        | Main e renderer concluíram sem erro.                                                                                                                    |
| `npm run lint`                                                    | inconclusivo    | ESLint ficou ativo por mais de 60 s sem resumo; foi encerrado.                                                                                          |
| Lint dos arquivos alterados                                       | reprovado       | 14 erros: retornos explícitos em `sagyou-mcp.test.ts` e erros em `index.ts`/`entries.ts`. Corrigir ou classificar dívida fora do diff antes de liberar. |
| `npm test`                                                        | inconclusivo    | Vitest não apresentou resumo após 60 s e manteve workers ativos; foi encerrado. Investigar worker/teste bloqueado e repetir.                            |
| `npm run test:coverage`                                           | inconclusivo    | Mesmo bloqueio da suíte completa; não há relatório de cobertura válido.                                                                                 |
| `npm run build:win`                                               | inconclusivo    | Não emitiu sucesso nem atualizou o instalador; o `dist/sagyou-1.0.0-setup.exe` encontrado é de 2026-10-21. Repetir até saída zero e artefato novo.      |
| Instalação limpa do artefato                                      | pendente manual | Em VM/usuário sem dados: instalar o artefato recém-gerado, abrir, confirmar que não usa dados/configuração prévia e desinstalar.                        |
| Codex: login, modelo/effort, MCP, reconexão, Stop e entrega       | pendente manual | Executar o roteiro em `docs/agent-terminal-manual-test.md`; registrar versão do CLI e resultado de cada passo.                                          |
| Claude Code: login, modelo/effort, MCP, reconexão, Stop e entrega | pendente manual | Executar o mesmo roteiro; registrar versão do CLI e resultado de cada passo.                                                                            |
| Backup/restore                                                    | pendente manual | Em perfil de teste, exportar backup v7 com memória, importar (um backup antigo com conversas as ignora), conferir conteúdo e restaurar o snapshot pré-importação.                         |

## Condição de liberação

Somente liberar quando todos os comandos automáticos tiverem saída zero, o artefato
atual tiver sido instalado limpo e as duas matrizes manuais estiverem completas. Uma
falha de ambiente deve ser registrada e resolvida ou explicitamente aceita pelo
responsável; nunca deve ser convertida em aprovação.
