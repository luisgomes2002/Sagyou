---
name: sagyou-pr
description: Use quando uma branch do Sagyou foi revisada e está pronta para pull request, ou quando pedirem para abrir, atualizar ou descrever um PR deste repo.
argument-hint: "[branch, padrão: a atual]"
---

# Sagyou: abrir o pull request (estágio 5)

## 1. Prove na árvore commitada
`git status --short` deve estar vazio (ou os restos explicados). Rode, via agente `sagyou-test-runner`:
```bash
npm run typecheck && npm test
npm run lint        # só erros novos importam; há dívida histórica
```
Vermelho para aqui: corrija (com teste) ou relate com honestidade. Nunca afirme uma checagem que não rodou. Se a UI ou o Electron mudou, confirme no app (`npm run dev`) e diga o que viu.

## 2. Push e abertura
`git push -u origin <branch>`, depois `gh pr create --base main --title "<título convencional>" --body-file <template preenchido>`, usando `.github/pull_request_template.md`. Preencha toda seção:
- **Summary:** o que muda para o usuário, e links da spec e do plano.
- **Dados persistidos:** se muda formato, e como o usuário existente é migrado.
- **Testes:** os comandos que rodaram e as contagens.
- **Decisões e pendências:** do registro de progresso, todas as linhas.
- **Causa raiz:** em fix.

Se a arquitetura mudou, `CLAUDE.md`, `GUIDE.md` e `README.md` já devem estar atualizados no PR.

## 3. Entregue a um humano
- Agentes nunca fazem merge. Peça um revisor, de preferência alguém além do autor: `gh pr edit <n> --add-reviewer <usuário>` se o desenvolvedor indicar.
- Release (tag, build de distribuição) é decisão humana, depois do merge.
- Após o merge, apague `.sagyou/work/<slug>/`. O histórico do git é o registro.

Relate a URL do PR e o passo humano pendente (review/merge).
