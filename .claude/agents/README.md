# Agentes do projeto

Cada arquivo é um subagente do Claude Code: `.claude/agents/<nome>.md`. O frontmatter define `name`, `description`, `tools` e `model`; o corpo são as instruções. As skills de estágio os chamam (ex.: `/sagyou-review` despacha `sagyou-reviewer`). Também dá para pedir um direto: "use o agente sagyou-test-runner".

A lista e quando cada um roda estão em [docs/workflow.md](../../docs/workflow.md). Revisores são somente leitura: reportam, e o estágio que os chamou corrige.
