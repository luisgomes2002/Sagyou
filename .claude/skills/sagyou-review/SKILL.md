---
name: sagyou-review
description: Use quando uma branch do Sagyou está implementada (todas as tasks do plano concluídas, ou um fix pronto) e precisa de review antes do PR, ou quando pedirem para revisar uma branch ou PR.
argument-hint: "[branch, padrão: a atual]"
---

# Sagyou: revisar a branch (estágio 4)

Branch: $ARGUMENTS (padrão: a atual)

## 1. Empacote a mudança
```bash
slug=<slug>; mkdir -p .sagyou/work/$slug
git fetch -q origin
{ git log --oneline origin/main..HEAD; echo; git diff --stat origin/main...HEAD; echo; \
  git diff -U10 origin/main...HEAD -- . ':!package-lock.json'; } \
  > .sagyou/work/$slug/review.diff
```
Vai dentro do repo, nunca em `/tmp`: subagentes não leem fora do diretório de trabalho.

## 2. Despache o revisor
Passe ao `sagyou-reviewer`: o caminho do pacote, os caminhos da spec e do plano (se houver), o **Foco de Review** do plano colado literalmente e o caminho do registro de progresso, para ele pesar as linhas `Decisão:`.

Mudança pequena (menos de ~150 linhas, nada persistido): despache com `model: sonnet`.

## 3. Triagem (você decide, não os rótulos)
Reclassifique cada achado por **o que o usuário viveria se fosse para produção**. Um revisor que marcou Minor "porque a spec não mencionava" avaliou a spec, não o efeito. Perda ou corrupção de dados é sempre Critical.
- **Critical / Important:** corrija tudo numa passada. Para cada um: escreva um teste que o reproduz, veja falhar, corrija, veja passar, rode a suíte inteira. Registre `Final: fixed <achado> — <teste> RED→GREEN`.
- **Important que não vai corrigir:** registre `Final: Decisão: <achado> — <por que fica> — <custo se errada>`. Vai para o PR.
- **Minor:** registre `Final: minor (adiado): <uma linha>`. Vai para o PR em "Decisões e pendências". Não corrija minors que ninguém pediu.

Não há segunda rodada de review: os testes que falhavam e agora passam são a prova. Commite as correções (`fix(<escopo>): …`) e dê push se pediram. Depois **siga direto para a skill `sagyou-pr`**.
