/** Live chat evaluation against synthetic app data. No tool mutates user data. */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import {
  checkTools,
  buildSuiteReport,
  formatSuiteDelta,
  judgeMessages,
  parseJudgeResponse,
  type EvalCase,
  type EvalRunResult,
  type EvalSuiteReport,
  type EvalToolCall
} from '../src/main/evaluator.ts'

const root = dirname(fileURLToPath(import.meta.url))
const goldenDir = process.env.SAGYOU_EVAL_GOLDEN_DIR || join(root, 'golden')
const resultPath = join(process.env.SAGYOU_EVAL_RESULTS_DIR || join(root, 'results'), 'last.json')
const systemPrompt = readFileSync(
  join(root, '../src/renderer/src/ai/system-prompt.md'),
  'utf-8'
).trim()
const definitions = JSON.parse(readFileSync(join(root, 'tools.json'), 'utf-8')) as Record<
  string,
  OpenAI.Chat.Completions.ChatCompletionTool
>

function loadCases(): EvalCase[] {
  return readdirSync(goldenDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(goldenDir, name), 'utf-8')) as EvalCase)
}

function validate(kase: EvalCase): string[] {
  const errors: string[] = []
  if (!kase.id || !kase.messages?.some((message) => message.role === 'user'))
    errors.push('id ou pedido ausente')
  if (!kase.rubric?.criteria?.length || !Array.isArray(kase.rubric.tools))
    errors.push('rubrica ausente')
  if (!Array.isArray(kase.availableTools)) errors.push('availableTools ausente')
  for (const name of kase.availableTools ?? []) {
    if (!definitions[name]) errors.push(`ferramenta sem definição: ${name}`)
    if (!Object.hasOwn(kase.toolResults ?? {}, name)) errors.push(`resultado ausente: ${name}`)
  }
  return errors
}

async function runCase(
  client: OpenAI,
  model: string,
  judgeModel: string,
  kase: EvalCase
): Promise<EvalRunResult> {
  const started = Date.now()
  const actualTools: EvalToolCall[] = []
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...kase.messages.map((message) => ({ role: message.role, content: message.content }))
  ]
  const tools = (kase.availableTools ?? []).map((name) => definitions[name])
  let promptTokens = 0
  let completionTokens = 0
  let answer = ''

  try {
    for (let round = 0; round < 6; round++) {
      const completion = await client.chat.completions.create({ model, messages, tools })
      promptTokens += completion.usage?.prompt_tokens ?? 0
      completionTokens += completion.usage?.completion_tokens ?? 0
      const response = completion.choices[0]?.message
      if (!response) throw new Error('Provedor não devolveu mensagem')
      messages.push(response)
      if (!response.tool_calls?.length) {
        answer = response.content ?? ''
        break
      }
      for (const call of response.tool_calls) {
        if (call.type !== 'function') continue
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
        } catch {
          args = { _invalidJson: call.function.arguments }
        }
        actualTools.push({ name: call.function.name, args })
        const result = Object.hasOwn(kase.toolResults ?? {}, call.function.name)
          ? kase.toolResults?.[call.function.name]
          : { error: 'Ferramenta indisponível nesta avaliação; nenhuma ação foi executada.' }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
      }
    }
    if (!answer) throw new Error('Sem resposta final após seis rodadas')
    const userText = kase.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .join('\n')
    const judge = await client.chat.completions.create({
      model: judgeModel,
      messages: judgeMessages(kase.rubric, userText, answer)
    })
    promptTokens += judge.usage?.prompt_tokens ?? 0
    completionTokens += judge.usage?.completion_tokens ?? 0
    const parsed = parseJudgeResponse(judge.choices[0]?.message.content ?? '')
    if ('error' in parsed) throw new Error(`Avaliação da resposta: ${parsed.error}`)
    const checked = checkTools(actualTools, kase.rubric)
    return {
      caseId: kase.id,
      passed: checked.allMet && parsed.score >= kase.rubric.passThreshold,
      score: parsed.score,
      judgeReasoning: parsed.reasoning,
      answer,
      actualTools,
      toolResults: checked.results,
      durationMs: Date.now() - started,
      usage: { promptTokens, completionTokens }
    }
  } catch (error) {
    return {
      caseId: kase.id,
      passed: false,
      score: 0,
      judgeReasoning: '',
      answer,
      actualTools,
      toolResults: checkTools(actualTools, kase.rubric).results,
      durationMs: Date.now() - started,
      usage: { promptTokens, completionTokens },
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function main(): Promise<void> {
  const cases = loadCases()
  const errors = cases.flatMap((kase) => validate(kase).map((error) => `${kase.id}: ${error}`))
  if (!cases.length || errors.length) {
    console.error(errors.join('\n') || 'Nenhum caso em eval/golden/')
    process.exitCode = 1
    return
  }
  console.log(`${cases.length} casos válidos: ${cases.map((kase) => kase.id).join(', ')}`)
  if (process.argv.includes('--check')) return
  const baseURL = process.env.SAGYOU_EVAL_BASE_URL
  const model = process.env.SAGYOU_EVAL_MODEL
  if (!baseURL || !model) {
    console.error(
      'Defina SAGYOU_EVAL_BASE_URL e SAGYOU_EVAL_MODEL; SAGYOU_EVAL_API_KEY é opcional.'
    )
    process.exitCode = 2
    return
  }
  const client = new OpenAI({
    baseURL,
    apiKey: process.env.SAGYOU_EVAL_API_KEY || 'local',
    maxRetries: 0,
    timeout: 60_000
  })
  const judgeModel = process.env.SAGYOU_EVAL_JUDGE_MODEL || model
  const results: EvalRunResult[] = []
  for (const kase of cases) {
    const result = await runCase(client, model, judgeModel, kase)
    results.push(result)
    const tokens = (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0)
    console.log(
      `${result.passed ? 'OK' : 'FALHOU'} ${kase.id}: ${result.score}/5, ${result.durationMs} ms, ${tokens} tokens${result.error ? ` — ${result.error}` : ''}`
    )
    if (process.argv.includes('--verbose')) console.log(result.judgeReasoning, result.actualTools)
  }
  let previous: EvalSuiteReport | undefined
  if (existsSync(resultPath)) {
    try {
      const read = JSON.parse(readFileSync(resultPath, 'utf-8')) as EvalSuiteReport & {
        mode?: string
      }
      if (read.mode === 'live') previous = read
    } catch {
      // A bad previous report cannot invalidate this run.
    }
  }
  const report = { ...buildSuiteReport(results, previous), mode: 'live', model, judgeModel }
  if (previous) console.log(formatSuiteDelta(previous, report))
  mkdirSync(dirname(resultPath), { recursive: true })
  writeFileSync(resultPath, JSON.stringify(report, null, 2))
  console.log(`Resultado: ${report.passed}/${report.total}; relatório: ${resultPath}`)
  if (report.failed || report.errored) process.exitCode = 1
}

await main()
