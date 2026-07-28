// ── Agent Evaluator ─────────────────────────────────────────────────────────
//
// Pure logic for evaluating agent output quality against golden traces.
// No Electron or IPC imports — this is the testable core.
//
// Step 10 of the AI agent construction framework:
// "Avalie o dispositivo individualmente — avaliações de rastreamento real,
//  controle de regressão, avaliador independente."

// ── Types ────────────────────────────────────────────────────────────────────

export type EvalToolExpectation =
  | { kind: 'called'; name: string }
  | { kind: 'notCalled'; name: string }
  | { kind: 'count'; name: string; min?: number; max?: number }

export interface EvalRubric {
  /** 1-5 scale: what a "passing" score minimum is. Default 3. */
  passThreshold: number
  /** What the agent should have done — describes the expected behaviour. */
  criteria: string[]
  /** Specific tool-call expectations. */
  tools: EvalToolExpectation[]
}

export interface EvalCase {
  id: string
  /** Human-readable description of what this case tests. */
  description: string
  /** The conversation that triggers the agent (system + user messages). */
  messages: { role: 'system' | 'user'; content: string }[]
  /** What the evaluator expects. */
  rubric: EvalRubric
  /** Tags for grouping (e.g. 'kanban', 'financial', 'code'). */
  tags: string[]
  /** Schema version this golden was recorded against. */
  schemaVersion: string
}

export interface EvalToolCall {
  name: string
  args: Record<string, unknown>
}

export interface EvalRunResult {
  caseId: string
  passed: boolean
  /** 1-5 score from the judge. */
  score: number
  /** What the judge said about the answer. */
  judgeReasoning: string
  /** Tool calls the agent actually made. */
  actualTools: EvalToolCall[]
  /** Which tool expectations were met/missed. */
  toolResults: { expectation: EvalToolExpectation; met: boolean }[]
  /** How long the run took in ms. */
  durationMs: number
  /** Any error that prevented evaluation. */
  error?: string
}

export interface EvalSuiteReport {
  timestamp: string
  total: number
  passed: number
  failed: number
  errored: number
  averageScore: number
  results: EvalRunResult[]
  /** Cases that regressed since the last run. */
  regressions: EvalRunResult[]
}

// ── Tool-call matching ──────────────────────────────────────────────────────

function toolCalled(actual: EvalToolCall[], name: string): boolean {
  return actual.some((t) => t.name === name)
}

function toolCallCount(actual: EvalToolCall[], name: string): number {
  return actual.filter((t) => t.name === name).length
}

function checkToolExpectation(
  actual: EvalToolCall[],
  exp: EvalToolExpectation
): boolean {
  switch (exp.kind) {
    case 'called':
      return toolCalled(actual, exp.name)
    case 'notCalled':
      return !toolCalled(actual, exp.name)
    case 'count': {
      const n = toolCallCount(actual, exp.name)
      if (exp.min !== undefined && n < exp.min) return false
      if (exp.max !== undefined && n > exp.max) return false
      return true
    }
  }
}

// ── LLM-as-Judge prompt ─────────────────────────────────────────────────────

function judgeSystemPrompt(rubric: EvalRubric): string {
  const criteria = rubric.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
  return `Você é um avaliador de qualidade de respostas de um assistente de IA.
Avalie a resposta abaixo contra estes critérios:

${criteria}

Atribua uma nota de 1 a 5, onde:
1 = Não atendeu nenhum critério
2 = Atendeu parcialmente, com erros significativos
3 = Atendeu a maioria dos critérios (passou)
4 = Atendeu todos os critérios com competência
5 = Excedeu as expectativas

Responda APENAS com um JSON: {"score": <1-5>, "reasoning": "<justificativa em português>"}`
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check tool-call expectations mechanically (no LLM needed).
 * Returns which expectations were met and a preliminary pass/fail.
 */
export function checkTools(
  actual: EvalToolCall[],
  rubric: EvalRubric
): { results: { expectation: EvalToolExpectation; met: boolean }[]; allMet: boolean } {
  const results = rubric.tools.map((exp) => ({
    expectation: exp,
    met: checkToolExpectation(actual, exp)
  }))
  return { results, allMet: results.every((r) => r.met) }
}

/**
 * Build the messages array to send to the judge model for scoring.
 */
export function judgeMessages(
  rubric: EvalRubric,
  userMessage: string,
  assistantAnswer: string
): { role: 'system' | 'user'; content: string }[] {
  return [
    { role: 'system', content: judgeSystemPrompt(rubric) },
    {
      role: 'user',
      content: `Mensagem do usuário:\n${userMessage}\n\nResposta do assistente:\n${assistantAnswer}`
    }
  ]
}

/**
 * Parse the judge model's JSON response.
 */
export function parseJudgeResponse(
  text: string
): { score: number; reasoning: string } | { error: string } {
  try {
    // The model might wrap in markdown code fences
    const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(cleaned)
    if (typeof parsed.score !== 'number' || parsed.score < 1 || parsed.score > 5) {
      return { error: `score inválido: ${parsed.score}` }
    }
    return {
      score: Math.round(parsed.score),
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : ''
    }
  } catch {
    // Fallback: try to extract a number
    const match = text.match(/"score"\s*:\s*(\d)/)
    if (match) {
      return { score: Number(match[1]), reasoning: text.slice(0, 500) }
    }
    return { error: 'Não foi possível parsear a resposta do juiz' }
  }
}

/**
 * Build a suite report from individual run results.
 */
export function buildSuiteReport(
  results: EvalRunResult[],
  previousReport?: EvalSuiteReport
): EvalSuiteReport {
  const errored = results.filter((r) => r.error)
  const valid = results.filter((r) => !r.error)
  const passed = valid.filter((r) => r.passed)
  const failed = valid.filter((r) => !r.passed)
  const averageScore =
    valid.length > 0 ? valid.reduce((s, r) => s + r.score, 0) / valid.length : 0

  // A regression is a case that passed before but fails now
  const regressions = previousReport
    ? failed.filter((r) => previousReport.results.some((pr) => pr.caseId === r.caseId && pr.passed))
    : []

  return {
    timestamp: new Date().toISOString(),
    total: results.length,
    passed: passed.length,
    failed: failed.length,
    errored: errored.length,
    averageScore: Math.round(averageScore * 10) / 10,
    results,
    regressions
  }
}

/**
 * Compare two suite reports and return a human-readable summary.
 */
export function formatSuiteDelta(prev: EvalSuiteReport, next: EvalSuiteReport): string {
  const lines: string[] = []
  const delta = next.passed - prev.passed
  lines.push(`Resultado: ${next.passed}/${next.total} passaram (${delta >= 0 ? '+' : ''}${delta})`)
  lines.push(`Nota média: ${next.averageScore}/5 (era ${prev.averageScore}/5)`)
  if (next.regressions.length > 0) {
    lines.push(`⚠️ ${next.regressions.length} regressão(ões):`)
    for (const r of next.regressions) {
      lines.push(`  - ${r.caseId}: nota ${r.score}/5 (era ${prev.results.find((pr) => pr.caseId === r.caseId)?.score}/5)`)
    }
  }
  if (next.errored > 0) {
    lines.push(`❌ ${next.errored} caso(s) com erro de execução`)
  }
  return lines.join('\n')
}
