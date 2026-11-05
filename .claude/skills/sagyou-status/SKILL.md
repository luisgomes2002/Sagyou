---
name: sagyou-status
description: Use quando perguntarem o que está sendo construído agora, quem está trabalhando em quê, ou se uma feature já está em andamento, e antes de começar qualquer spec, plano, build ou fix no Sagyou.
argument-hint: "[feature ou área a procurar, opcional]"
---

# Sagyou: o que está em andamento

Procurando: $ARGUMENTS

Somente leitura. Responde "alguém já está construindo isso?" (`docs/workflow.md` → Portões). Nunca cria branch, commit ou comentário.

**Por que não basta olhar `docs/specs/` na `main`:** a spec é commitada na branch `feature/<slug>`, então a `main` só tem specs de trabalho já mergeado. O que está em andamento vive em branches não mergeadas, PRs abertos e worktrees locais.

## 1. Colete
```bash
git fetch -q --prune
git for-each-ref --sort=-committerdate --no-merged origin/main \
  --format='%(refname:short)|%(authorname)|%(committerdate:relative)' refs/remotes/origin
gh pr list --state open --json number,title,headRefName,author,isDraft,reviewDecision,updatedAt
git worktree list
```
Para cada branch não mergeada `<b>`:
- `git diff --name-only origin/main...<b> -- docs/specs docs/plans`: spec e plano que ela adiciona ou muda.
- De cada um: o título (primeira linha `# `) e o `Status:` (`git show <b>:<caminho>`).
- Tamanho do plano: títulos `### Task`. Feito até agora: `git log --oneline origin/main..<b>`. O progresso real fica em `.sagyou/work/` (ignorado pelo git): dê commits vs. tasks como pista, não porcentagem.
- Sem spec nem plano: nomeie pela branch e pelos últimos commits.

Worktrees locais (inclusive as das sessões de agente do app) com branch sem push também contam: liste-as à parte.

## 2. Relate
Uma tabela, mais recente primeiro:

| Branch | Quem | Último commit | Spec / plano | Estágio | PR |
| --- | --- | --- | --- | --- | --- |

Estágio: spec draft → spec aprovada → plano draft → plano aprovado → construindo → PR aberto / aprovado (`reviewDecision`).

Se `$ARGUMENTS` (ou o pedido que trouxe até aqui) cita uma feature ou área: diga quais itens tocam a mesma coisa, comparando objetivos das specs e arquivos alterados (`git diff --stat origin/main...<b>`), não só nomes. Mesma feature → diga ao humano e pare até ele decidir. Depende dela → sugira partir daquela branch.

Nada em andamento → uma linha, com o último PR mergeado (`gh pr list --state merged --limit 1`).

## Limites
- Commits locais de outra máquina são invisíveis.
- Branch parada há dias pode estar abandonada; informe a idade, não decida pelo autor.
