import { describe, it, expect } from 'vitest'
import { checkTools, parseJudgeResponse, buildSuiteReport, type EvalToolCall, type EvalRubric, type EvalRunResult } from '../evaluator'

describe('checkTools', () => {
  const rubric: EvalRubric = {
    passThreshold: 3,
    criteria: ['Deve usar ler_tasks'],
    tools: [
      { kind: 'called', name: 'ler_projetos' },
      { kind: 'notCalled', name: 'deletar_task' },
      { kind: 'count', name: 'ler_tasks', min: 1, max: 3 }
    ]
  }

  it('flags a missing expected call', () => {
    const calls: EvalToolCall[] = []
    const { allMet } = checkTools(calls, rubric)
    expect(allMet).toBe(false)
  })

  it('passes when all expectations are met', () => {
    const calls: EvalToolCall[] = [
      { name: 'ler_projetos', args: {} },
      { name: 'ler_tasks', args: { prioridade: 'high' } }
    ]
    const { results, allMet } = checkTools(calls, rubric)
    expect(allMet).toBe(true)
    expect(results[0].met).toBe(true)  // ler_projetos called
    expect(results[1].met).toBe(true)  // deletar_task NOT called
    expect(results[2].met).toBe(true)  // ler_tasks count 1 (min=1, max=3)
  })

  it('fails when a notCalled tool is actually called', () => {
    const calls: EvalToolCall[] = [
      { name: 'ler_projetos', args: {} },
      { name: 'deletar_task', args: { titulo: 'x' } },
      { name: 'ler_tasks', args: {} }
    ]
    const { allMet } = checkTools(calls, rubric)
    expect(allMet).toBe(false)
  })

  it('fails on count out of range', () => {
    const calls: EvalToolCall[] = [
      { name: 'ler_projetos', args: {} },
      { name: 'ler_tasks', args: {} },
      { name: 'ler_tasks', args: {} },
      { name: 'ler_tasks', args: {} },
      { name: 'ler_tasks', args: {} }
    ]
    const { allMet } = checkTools(calls, rubric)
    expect(allMet).toBe(false)
  })
})

describe('parseJudgeResponse', () => {
  it('parses a clean JSON response', () => {
    const result = parseJudgeResponse('{"score": 4, "reasoning": "Boa resposta"}')
    expect(result).toEqual({ score: 4, reasoning: 'Boa resposta' })
  })

  it('handles markdown code fences', () => {
    const result = parseJudgeResponse('```json\n{"score": 5, "reasoning": "Perfeito"}\n```')
    expect(result).toEqual({ score: 5, reasoning: 'Perfeito' })
  })

  it('rejects invalid scores', () => {
    const result = parseJudgeResponse('{"score": 7, "reasoning": "x"}')
    expect('error' in result).toBe(true)
  })

  it('falls back to extracting a number', () => {
    const result = parseJudgeResponse('something "score": 3 something')
    expect(result).toEqual({ score: 3, reasoning: 'something "score": 3 something' })
  })

  it('errors on unparseable input', () => {
    const result = parseJudgeResponse('nonsense')
    expect('error' in result).toBe(true)
  })
})

describe('buildSuiteReport', () => {
  it('computes pass/fail/error counts and average', () => {
    const results: EvalRunResult[] = [
      { caseId: 'a', passed: true, score: 5, judgeReasoning: '', actualTools: [], toolResults: [], durationMs: 100 },
      { caseId: 'b', passed: false, score: 2, judgeReasoning: '', actualTools: [], toolResults: [], durationMs: 200 },
      { caseId: 'c', passed: true, score: 4, judgeReasoning: '', actualTools: [], toolResults: [], durationMs: 150 },
      { caseId: 'd', passed: false, score: 1, judgeReasoning: '', actualTools: [], toolResults: [], durationMs: 50, error: 'timeout' }
    ]
    const report = buildSuiteReport(results)
    expect(report.total).toBe(4)
    expect(report.passed).toBe(2)
    expect(report.failed).toBe(1)
    expect(report.errored).toBe(1)
    expect(report.averageScore).toBe(3.7) // (5+2+4)/3 = 3.666...
  })

  it('detects regressions from previous report', () => {
    const prev: EvalRunResult[] = [
      { caseId: 'a', passed: true, score: 4, judgeReasoning: '', actualTools: [], toolResults: [], durationMs: 100 },
      { caseId: 'b', passed: true, score: 3, judgeReasoning: '', actualTools: [], toolResults: [], durationMs: 200 }
    ]
    const prevReport = buildSuiteReport(prev)

    const next: EvalRunResult[] = [
      { caseId: 'a', passed: true, score: 4, judgeReasoning: '', actualTools: [], toolResults: [], durationMs: 100 },
      { caseId: 'b', passed: false, score: 2, judgeReasoning: '', actualTools: [], toolResults: [], durationMs: 200 }
    ]
    const nextReport = buildSuiteReport(next, prevReport)

    expect(nextReport.regressions.length).toBe(1)
    expect(nextReport.regressions[0].caseId).toBe('b')
  })
})
