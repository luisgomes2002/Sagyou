# Fluxo de trabalho (agentic SDLC)

Fonte da verdade do fluxo. `CLAUDE.md`, `GUIDE.md` e `README.md` só resumem e apontam para cá.

Toda mudança passa pelos mesmos estágios, seja qual for a ferramenta. Os estágios passam o trabalho adiante por **arquivos no repositório**, não pela memória do chat: qualquer pessoa ou agente retoma de onde o anterior parou.

| Estágio    | Saída                             | Portão antes do próximo                   | Skill (Claude Code)    |
| ---------- | --------------------------------- | ----------------------------------------- | ---------------------- |
| 1. Spec    | `docs/specs/AAAA-MM-DD-<slug>.md` | **um humano aprova**                      | `/sagyou-spec`         |
| 2. Plano   | `docs/plans/AAAA-MM-DD-<slug>.md` | **um humano aprova**                      | `/sagyou-plan`         |
| 3. Build   | commits em `feature/<slug>`       | typecheck + testes verdes por task        | `/sagyou-build`        |
| 4. Review  | achados corrigidos                | nenhum Critical/Important aberto          | `/sagyou-review`       |
| 5. PR      | pull request para `main`          | **um humano faz o merge**                 | `/sagyou-pr`           |
| 6. Release | tag/build de distribuição         | **um humano** cria a tag e roda o release | nenhuma (agente nunca) |

Caminhos menores:

- **Bug** (`fix/<slug>`, `/sagyou-fix`): sem spec nem plano. Reproduz, escreve o teste que falha por causa do bug, acha a causa raiz, corrige, e segue para os estágios 4-5. Se a correção exige mudar schema persistido ou criar tela, é feature: volta ao estágio 1.
- **Chore** (`chore/<slug>`: docs, config, dependência já aprovada): direto para os estágios 4-5.
- **Mudança trivial** (typo, uma linha sem efeito em dados): pode pular spec e plano, mas não o review nem o PR.

## Portões

- Spec e plano nascem com `Status: draft`. Viram `Status: approved by <nome> on <AAAA-MM-DD>` só depois de a pessoa dizer sim. O agente só escreve essa linha se o humano aprovou na conversa; **nunca aprova o próprio trabalho**.
- **O merge precisa da aprovação do dono do repositório.** O agente abre o PR, pede a revisão e espera. Agentes nunca fazem merge.
- **Urgência não pula portão.** "Preciso disso agora" significa: pedir aprovação rápida, cortar o escopo. Não significa construir sem spec e plano aprovados.
- Fique dentro do plano aprovado. Surgiu algo novo e necessário no meio do build: pare, atualize o plano (volta a `draft`) e peça aprovação de novo.
- Antes de começar, veja o trabalho em andamento: `git fetch && git branch -a` e `gh pr list`. Não construa o que outro já está construindo; se depende, parta da branch dele.
- **Mudanças que tocam dados persistidos** (schema SQLite, backup, normalização, `userData`) exigem, na spec, a seção "Dados" e o aviso `⚠️ Breaking schema change — existing data may be affected.` quando for o caso (veja `CLAUDE.md` → Data / Schema safety).

## Git

- Nunca commite direto na `main`, nunca faça force-push. Uma branch por história ou tarefa: `feature/<slug>`, `fix/<slug>`, `chore/<slug>`.
- Conventional Commits curtos e com escopo: `feat(board): add poster grid`, `fix(backup): reject traversal ids`.
- Agentes fazem commit e push **na branch da feature** quando o desenvolvedor pediu para construir ou entregar ("sobe", "abre o PR", `/sagyou-build`, `/sagyou-pr`). Fora isso, listam os arquivos e propõem a mensagem.
- Não misture trabalho alheio no commit: se a árvore tem mudanças que não são suas, não as toque. Pergunte, ou trabalhe num `git worktree` separado.
- Não pule hooks (`--no-verify`) nem assinatura.

## Definition of done

- `npm run typecheck` limpo, `npm test` passando, nenhum erro novo de `npm run lint`.
- Lógica nova tem teste escrito **antes**. Bug corrigido tem teste de regressão que falhava antes da correção.
- Mexeu em algo persistido: releia "Regras que quebram dados" no `GUIDE.md`.
- Mudou arquitetura: atualize `CLAUDE.md`, `GUIDE.md` e `README.md` no mesmo PR.
- O PR diz se muda formato de dados persistidos (e como o usuário existente é migrado).

## Disciplina de bug

**Sem correção sem causa raiz, e sem causa raiz sem evidência.**

1. Reproduza: passos exatos, esperado vs. obtido, se acontece sempre.
2. Reúna evidência: `git log --oneline -15`, o diff da área, logs, o console do DevTools.
3. Formule **uma** hipótese ("X é a causa porque <evidência>") e teste com a menor verificação possível, uma variável por vez. Se errou, nova hipótese a partir da nova evidência; não empilhe correções.
4. Escreva o teste que falha **por causa do bug**, na camada mais baixa que o mostra, e veja-o falhar. Corrija na origem, não onde o sintoma aparece. Veja passar e rode a suíte inteira.
5. **Três correções tentadas e ainda quebrado: pare.** O desenho provavelmente está errado; conte ao humano o que aprendeu em vez de tentar a quarta.
6. O PR traz uma seção "Causa raiz": causa, evidência e o teste que a prova.

## Skills e agentes

Usuários do Claude Code têm o fluxo automatizado por skills e subagentes em `.claude/`. Quem usa Codex/Cursor segue os mesmos estágios à mão; os arquivos são Markdown puro e servem como checklist.

Crie uma skill ou agente novo quando **um fluxo foi feito duas vezes do mesmo jeito** ou **o mesmo erro aconteceu duas vezes**. Mantenha curto, aponte para este arquivo em vez de repetir, e liste-o abaixo no mesmo PR.

**Skills:** `/sagyou-spec`, `/sagyou-plan`, `/sagyou-build`, `/sagyou-review`, `/sagyou-pr`, `/sagyou-fix` (os estágios acima), e `sagyou-ui` (padrão visual, carregada sozinha ao mexer no renderer).

**Agentes** (cada um com um papel só; revisores são somente leitura):

- `sagyou-plan-checker`: lê spec + plano como um construtor novo e devolve só perguntas.
- `sagyou-implementer`: implementa uma task do plano, teste primeiro.
- `sagyou-reviewer`: revisão da branch inteira (correção, segurança de dados, aderência a este fluxo).
- `sagyou-security-reviewer`: ataca a branch como executor com injeção de prompt, conteúdo web/memória malicioso, renderer comprometido ou processo local; roda quando o diff toca IPC, MCP, sessões de agente, arquivos, web ou logs.
- `sagyou-ui-reviewer`: confere telas alteradas contra o `UI_DESIGN.md`, acessibilidade, textos e estados; roda quando o diff toca o renderer.
- `sagyou-test-runner`: roda lint/typecheck/testes e devolve um resumo curto das falhas.

## Permissões do Claude Code

`.claude/settings.json` (versionado) libera comandos de leitura e teste e **nega** o que o fluxo proíbe: force-push, `--no-verify`, ler `.env*`. Preferências pessoais ficam em `.claude/settings.local.json` (ignorado pelo git). Uma regra `deny` vence qualquer `allow`.
