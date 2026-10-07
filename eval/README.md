# Avaliações do chat

`npm run eval:check` valida os seis casos sem chamar um provedor. `npm run eval`
executa cada pedido no modelo configurado, devolve resultados sintéticos para as
ferramentas e usa uma segunda chamada do modelo para pontuar a resposta. Nenhuma
ferramenta altera os dados reais do app. O relatório fica em `eval/results/last.json`
com resposta, nota, chamadas de ferramenta, duração e tokens por caso. Uma regressão em
relação à última execução real também é mostrada.

Os comandos de avaliação usam o suporte nativo a TypeScript do Node.js 24.

O avaliador usa o mesmo modelo como juiz por padrão. Defina
`SAGYOU_EVAL_JUDGE_MODEL` para usar outro modelo disponível no mesmo endpoint.

```bash
SAGYOU_EVAL_BASE_URL=https://seu-provedor/v1 \
SAGYOU_EVAL_API_KEY=sua-chave \
SAGYOU_EVAL_MODEL=seu-modelo \
npm run eval
```

Para um modelo local que não exige chave, omita `SAGYOU_EVAL_API_KEY`. O comando
usa o prompt atual do chat e seis cenários de kanban, finanças, hábitos, agenda,
memória e documento com instrução maliciosa. `tools.json` contém contratos
representativos das ferramentas usadas nesses cenários; quando uma definição
real mudar, atualize o contrato de avaliação também. Resultados sintéticos
permitem comparar modelos sem expor dados pessoais, mas a avaliação não substitui
um teste manual no app com o provedor escolhido.
