---
name: sagyou-spec
description: Use quando pedirem uma feature nova ou mudança de comportamento no Sagyou e ainda não existe spec aprovada em docs/specs/, inclusive pedidos "rápidos", urgentes ou do tipo "só constrói/sobe".
argument-hint: "[o que você quer construir]"
---

# Sagyou: escrever a spec (estágio 1)

Pedido: $ARGUMENTS

Estágio 1 do fluxo em `docs/workflow.md`. Saída: spec aprovada em `docs/specs/`. **Sem código, migração ou plano até um humano aprovar.**

## 1. Veja o que já existe
- `git fetch -q && git branch -a` e `gh pr list`: alguém já está construindo isto ou algo de que depende? Se sim, avise e pare até o humano decidir.
- Leia `GUIDE.md` (e "Regras que quebram dados" se tocar algo persistido) e qualquer spec em `docs/specs/` da mesma área.
- Se depende de algo ainda não construído, diga e pergunte: esperar, partir da branch em andamento, ou ampliar o escopo. Não construa a peça faltante em silêncio.
- Crie a branch antes de escrever: `git switch -c feature/<slug> origin/main`. Se a árvore tem mudanças que não são suas, não as toque: pergunte, ou use `git worktree add ../Sagyou-<slug> -b feature/<slug> origin/main`.

## 2. Entrevista
Uma pergunta por mensagem, em linguagem simples, ancorada num momento real ("me conta a última vez que…"). Cubra: o problema e quem o tem, como é o sucesso, o que está explicitamente fora, os detalhes que importam (textos, regras, casos de borda) e como deve parecer. Ofereça um menu curto só se a pessoa travar. Se disserem "você decide", proponha algo concreto e marque como decisão sua.

## 3. Escreva `docs/specs/AAAA-MM-DD-<slug>.md`
```markdown
# <Nome da feature>

Status: draft
Branch: feature/<slug>

## Por quê
## Objetivos
## Fora do escopo
## Decisões (de <nome>)
## Decisões do construtor (o agente decidiu; o humano pode mudar)
## Comportamento
<!-- regras observáveis, textos exatos, bordas: vazio, erro, duplicado, offline -->
## Dados
<!-- campos/tabelas novos, o que persiste e onde (SQLite, userData, backup), compatibilidade com dados existentes — ou "sem mudança de dados". Se quebra formato: ⚠️ Breaking schema change — existing data may be affected. -->
## Telas
<!-- o que o usuário vê; segue UI_DESIGN.md -->
## Perguntas em aberto
<!-- precisa estar vazio antes da aprovação -->
```

## 4. Portão
Mostre o caminho da spec e um resumo de 5 linhas, e pergunte: "Aprova a spec?". Espere. Quando o humano disser sim, troque para `Status: approved by <nome> on <AAAA-MM-DD>`, commite `docs(<slug>): spec` em `feature/<slug>` e dê push se pediram para entregar.

Uma feature minúscula (uma tela, nenhum dado novo) pode mostrar spec e plano na mesma mensagem, mas ainda precisa de dois sins explícitos. Depois, **siga direto para a skill `sagyou-plan`** com esta spec.

## Bandeiras vermelhas: volte ao portão
| Pensamento | Realidade |
| --- | --- |
| "É urgente, pulo a aprovação" | Urgência = pedir aprovação rápida ou cortar escopo. Urgência não pula portão. |
| "O pedido estava claro, spec é exagero" | Então a spec leva 5 minutos. Escreva. |
| "Aproveito e construo as peças que faltam" | Escopo não aprovado. Pergunte primeiro. |
| "Escrevo `approved` eu mesmo, eles vão concordar" | Só um humano aprova. |
