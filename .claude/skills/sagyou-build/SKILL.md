---
name: sagyou-build
description: Use quando um plano do Sagyou em docs/plans/ está aprovado e suas tasks precisam ser implementadas, ou ao retomar um build interrompido (janela nova, contexto compactado, outra pessoa).
argument-hint: "[docs/plans/<arquivo>.md]"
---

# Sagyou: construir o plano (estágio 3)

Plano: $ARGUMENTS

**Recuse começar** se o plano não diz `Status: approved by …`. Nesse caso, aponte para `/sagyou-plan`.

## Preparação
1. Leia o plano e a spec uma vez. Anote as Restrições Globais e o Foco de Review: valem para toda task.
2. Vá para a branch do plano (`git switch feature/<slug>`, ou crie a partir de `origin/main`). Nunca trabalhe na `main`.
3. Registro de progresso: `.sagyou/work/<slug>/progress.md` (ignorado pelo git, dentro do repo para subagentes lerem). A primeira linha é `# plan: <caminho do plano>`. Se já existe, cada linha `Task N: complete` está feita: retome na primeira task sem ela, e confie no `git log` mais que na memória.
4. Ao tocar dados persistidos, releia "Regras que quebram dados" no `GUIDE.md`.

## Por task, em ordem
1. Releia o texto da task (valores exatos vivem lá, não na sua memória).
2. Escreva o teste primeiro, rode e **veja-o falhar pelo motivo que o plano diz**. Teste que passa antes de o código existir está quebrado: conserte.
3. Implemente o mínimo para passar, rode o comando da task e compare com o `Esperado:`.
   - Saída difere porque **o código está errado**: ache a causa raiz antes de mudar qualquer coisa (veja `sagyou-fix` §3).
   - Saída difere porque **o plano está errado**: faça a menor mudança que ainda satisfaça a spec. Acrescente `Task N: Decisão: <o quê> — <por quê> — <custo se errada>` ao registro.
4. Rode a suíte inteira (`npm test`) e `npm run typecheck`. Para rodadas longas, use o agente `sagyou-test-runner`, para a saída completa ficar fora do seu contexto.
5. Commite com a mensagem do plano; dê push se o desenvolvedor pediu para entregar.
6. Acrescente `Task N: complete (<sha-inicial>..<sha-final>, <comando> → <resultado>)`.

Uma task grande com interfaces claras pode ir para o agente `sagyou-implementer`: passe o caminho do plano, o número da task e o do registro. Confira o resultado você mesmo (rode os testes de novo) antes de escrever a linha de conclusão.

## Só isto interrompe o build
- algo destrutivo ou irreversível (apagar dados do usuário, reescrever histórico git);
- qualquer coisa que publique (tag, release, push para `main`), que agentes nunca fazem;
- uma escolha de segurança ou de formato de dados que o plano não resolve;
- um plano tão errado que todo caminho adiante é chute.

Fora isso, decida, registre uma Decisão e siga. Não pare entre tasks para perguntar "posso continuar?".

Com todas as tasks concluídas, **siga direto para a skill `sagyou-review`** (não há portão humano entre build, review e PR).
