# AGENTS.md

Ponto de entrada para **qualquer** agente de código (Claude Code, Codex, Cursor,
Copilot, Gemini, OpenCode…). Leia, nesta ordem:

1. **Este arquivo** — as regras de processo abaixo valem sempre.
2. **`GUIDE.md`** — stack, estrutura, comandos e as regras cuja quebra corrompe
   dados reais de usuários. Leia antes de mexer no código.
3. **`docs/workflow.md`** — o fluxo completo (estágios, portões, Git, bugs).
4. `CLAUDE.md` — fonte da verdade sobre arquitetura, em detalhe (sob demanda).

## Regras de processo (resumo; detalhe em `docs/workflow.md`)

- **Estágios:** spec (`docs/specs/`) → plano (`docs/plans/`) → build → review → PR.
  Feature nova começa pela spec; bug começa pela reprodução. Mudança trivial pode
  pular spec e plano, nunca review e PR.
- **Portões humanos:** um humano aprova a spec, o plano e o merge. Você **nunca
  aprova o próprio trabalho** (não escreva `Status: approved` sem o humano ter
  dito sim) e **nunca faz merge**. Urgência não pula portão: peça aprovação
  rápida ou corte o escopo. Surgiu algo fora do plano aprovado: pare e atualize o
  plano.
- **Git:** nunca commite na `main`, nunca faça force-push nem `--no-verify`.
  Uma branch por tarefa: `feature/<slug>`, `fix/<slug>`, `chore/<slug>`.
  Conventional Commits curtos (`feat(board): …`, `fix(backup): …`). Só commite e
  dê push quando o desenvolvedor pediu para entregar; senão liste os arquivos e
  proponha a mensagem. Não toque em mudanças que não são suas. Antes de começar:
  `git fetch && git branch -a` e `gh pr list`.
- **Bug:** sem correção sem causa raiz e evidência. Escreva primeiro o teste que
  falha por causa do bug. Três correções sem sucesso: pare e conte ao humano o
  que aprendeu.
- **Pronto significa:** `npm run typecheck` limpo, `npm test` passando, nenhum
  erro novo de `npm run lint`, teste escrito antes da lógica nova. Mudou
  arquitetura: atualize `CLAUDE.md`, `GUIDE.md` e `README.md` juntos.
- **Dados persistidos:** há dados reais de usuários. Nunca remova nem renomeie
  campos sem migração; avise `⚠️ Breaking schema change — existing data may be
  affected.` (regras completas no `GUIDE.md`).
- **PR:** use `.github/pull_request_template.md` (Summary, dados persistidos,
  testes, causa raiz, decisões).

No Claude Code, cada estágio tem uma skill (`/sagyou-spec`, `/sagyou-plan`,
`/sagyou-build`, `/sagyou-review`, `/sagyou-pr`, `/sagyou-fix`) e há subagentes em
`.claude/agents/`. Nas outras ferramentas, siga os mesmos estágios à mão: os
arquivos em `.claude/skills/` são Markdown puro e servem de checklist.

Este arquivo não duplica o conteúdo do `GUIDE.md` nem do `docs/workflow.md`:
resume só o que um agente não pode ignorar. Se uma regra mudar, mude em
`docs/workflow.md` e ajuste o resumo aqui.
