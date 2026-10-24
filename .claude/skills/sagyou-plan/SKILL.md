---
name: sagyou-plan
description: Use quando uma spec do Sagyou em docs/specs/ está aprovada e ainda não tem plano em docs/plans/, ou quando um plano aprovado precisa mudar no meio do build.
argument-hint: "[docs/specs/<arquivo>.md]"
---

# Sagyou: escrever o plano (estágio 2)

Spec: $ARGUMENTS

**Recuse começar** se a spec não diz `Status: approved by …`. Nesse caso, aponte para `/sagyou-spec`.

O plano é o conjunto de decisões que um implementador não toma sozinho: arquivos, nomes e assinaturas, os valores e textos exatos da spec, e os testes que provam cada task. Não é o código.

## Escreva `docs/plans/AAAA-MM-DD-<slug>.md`
```markdown
# Plano de implementação: <Feature>

Status: draft
Spec: docs/specs/<arquivo>.md
Branch: feature/<slug>

**Objetivo:** uma frase. **Arquitetura:** 2-3 frases.

## Restrições Globais
<!-- uma linha cada, valores exatos copiados da spec e do GUIDE.md -->

## Foco de Review
<!-- as 5 entradas/modos de falha com mais chance de ferir o usuário que a spec implica mas não detalha,
     cada um com o comportamento esperado e "Testado na Task N". Sempre inclua dados persistidos existentes. -->

### Task N: <nome>
**Arquivos:** Criar / Modificar / Teste (caminhos exatos)
**Interfaces:** Consome (de tasks anteriores, assinaturas exatas) / Produz (para as seguintes)
- [ ] Passo 1: escreva o teste que falha: nomes + asserções com os valores exatos da spec
- [ ] Passo 2: rode `<comando>`. Esperado: FALHA porque <motivo>
- [ ] Passo 3: implemente `<assinatura>` em `<arquivo>` (uma linha sobre a abordagem se houver escolha real)
- [ ] Passo 4: rode `<comando>`. Esperado: PASSA
- [ ] Passo 5: commit `<tipo>(<escopo>): <mensagem>`
```

Regras:
- Uma task é a menor unidade com ciclo de teste próprio que um revisor poderia rejeitar sozinha. Dobre o setup na task que precisa dele.
- Dado persistido: a task cita o normalizador de load/import (`store/normalization.ts`), a migração idempotente em `main/store.ts` e o teste de round-trip com dados antigos.
- Sem linhas que não decidem nada ("tratar bordas", "adicionar validação", "TBD").
- A última task é sempre: suíte completa, verificação no app (`npm run dev`) se a UI mudou, PR (estágio 5), e atualizar `CLAUDE.md`/`GUIDE.md`/`README.md` se a arquitetura mudou.

## Checagem do construtor
Despache o agente `sagyou-plan-checker` com os caminhos da spec e do plano. Classifique as perguntas:
- **Já respondida** pela spec ou repo: escreva a resposta no plano.
- **Menor** (não muda o que é construído): decida e marque "(decisão do construtor)".
- **Do humano** (muda o que é construído): pergunte numa mensagem só, a mais importante primeiro.

## Portão
Mostre o caminho do plano, a lista de tasks com uma linha cada, e suas decisões. Pergunte "Aprova o plano?" e espere. Com sim: `Status: approved by <nome> on <AAAA-MM-DD>`, commite `docs(<slug>): plan` em `feature/<slug>` e dê push se pediram. Depois **siga direto para a skill `sagyou-build`** com este plano, sem esperar que digitem o comando.

Se o plano mudar no meio do build: edite, volte para `Status: draft` e peça nova aprovação das tasks alteradas.
