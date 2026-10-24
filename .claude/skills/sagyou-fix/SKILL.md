---
name: sagyou-fix
description: Use quando algo no Sagyou está quebrado ou se comporta errado (teste falhando, erro, dado errado, bug reportado), antes de propor ou fazer qualquer correção.
argument-hint: "[o que está quebrado]"
---

# Sagyou: corrigir um bug

Bug: $ARGUMENTS

**Sem correção sem causa raiz, e sem causa raiz sem evidência.** Detalhes em `docs/workflow.md` → Disciplina de bug.

## 1. É mesmo um fix?
Se corrigir exige mudar formato de dado persistido, criar tela ou comportamento que ninguém especificou, é feature: vá para `/sagyou-spec`. Senão, crie a branch `fix/<slug>` a partir de `origin/main`.

## 2. Reproduza e reúna evidência
- **Passos exatos, esperado vs. obtido**, e se acontece sempre.
- Mudanças recentes: `git log --oneline -15` e o diff da área.
- Console do DevTools (renderer) e saída do processo main; para dados, o estado real no SQLite/`userData` (só leitura, e nunca em cima de dados do usuário sem cópia).

## 3. Causa raiz
Enuncie uma hipótese: "X é a causa porque <evidência>". Teste com a menor verificação possível, uma variável por vez. Se errou, nova hipótese a partir da nova evidência; não empilhe correções.

## 4. Corrija, teste primeiro
1. Escreva o teste que falha **por causa do bug**, na camada mais baixa que o mostra, e veja-o falhar. (Em confinamento de caminho, o arquivo fora da raiz precisa existir de verdade.)
2. Faça a correção mínima na origem, não onde o sintoma aparece. Veja o teste passar e rode a suíte inteira.

**Três correções tentadas e ainda quebrado: pare.** O desenho provavelmente está errado; conte ao humano o que aprendeu em vez de tentar a quarta.

## 5. Termine
Commite `fix(<escopo>): <o quê>`. O corpo do PR ganha a seção "Causa raiz": causa, evidência e o teste que a prova. Depois **siga direto para a skill `sagyou-review`**, que segue para `sagyou-pr`.
