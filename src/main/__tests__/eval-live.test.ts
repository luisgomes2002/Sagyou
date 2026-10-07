// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('live chat evaluator', () => {
  it('runs a tool round and scores its answer against a compatible local provider', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'sagyou-eval-'))
    const fixture = readFileSync(join(process.cwd(), 'eval/golden/example-kanban-read.json'))
    writeFileSync(join(temp, 'task.json'), fixture)
    const server = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += String(chunk)
      const payload = JSON.parse(body) as { messages: { role: string; content: string }[] }
      const judging = payload.messages[0]?.content?.includes('Você é um avaliador')
      const hasToolResult = payload.messages.some((message) => message.role === 'tool')
      const message = judging
        ? { role: 'assistant', content: '{"score":5,"reasoning":"Resposta correta."}' }
        : hasToolResult
          ? { role: 'assistant', content: 'São 13 tasks: 8 abertas e 5 concluídas.' }
          : {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'ler_tasks', arguments: '{"estado":"todas"}' }
                }
              ]
            }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 0,
          model: 'test-model',
          choices: [{ index: 0, finish_reason: 'stop', message }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
        })
      )
    })

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Porta não disponível')
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, ['--experimental-strip-types', 'eval/live.ts'], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            SAGYOU_EVAL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            SAGYOU_EVAL_MODEL: 'test-model',
            SAGYOU_EVAL_GOLDEN_DIR: temp,
            SAGYOU_EVAL_RESULTS_DIR: temp
          }
        })
        child.on('error', reject)
        child.on('close', resolve)
      })
      expect(exitCode).toBe(0)
      const report = JSON.parse(readFileSync(join(temp, 'last.json'), 'utf-8')) as {
        passed: number
        results: { answer: string; actualTools: { name: string; args: unknown }[]; usage: unknown }[]
      }
      expect(report.passed).toBe(1)
      expect(report.results[0].answer).toContain('13 tasks')
      expect(report.results[0].actualTools).toEqual([
        { name: 'ler_tasks', args: { estado: 'todas' } }
      ])
      expect(report.results[0].usage).toEqual({ promptTokens: 60, completionTokens: 30 })
    } finally {
      server.close()
      rmSync(temp, { recursive: true, force: true })
    }
  }, 20_000)
})
