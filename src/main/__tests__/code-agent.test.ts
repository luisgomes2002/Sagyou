/**
 * Native code agent — pure core, runs in Node not the suite's default jsdom.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CODE_AGENT_TOOLS,
  codeToolsFor,
  inlineFilesBlock,
  INLINE_FILE_CHAR_CAP,
  INLINE_TOTAL_CHAR_CAP,
  needsApproval,
  runCodeTool,
  runCodeAgent,
  buildSystemPrompt,
  readProjectGuide,
  isRetryableStatus,
  CODE_AGENT_MAX_RETRIES,
  CODE_AGENT_MAX_STEPS,
  suggestCodeAgentSteps,
  type ToolDef,
  type ToolContext,
  type CommandRunner,
  type AgentMessage,
  type ToolCall
} from '../code-agent'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sagyou-agent-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1\nconst hidden = 2\n')
  await writeFile(join(root, 'README.md'), '# projeto')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const ctx = (): ToolContext => ({ root })

describe('tool definitions', () => {
  it('exposes exactly the seven tools, each with a JSON schema', () => {
    const names = CODE_AGENT_TOOLS.map((t) => t.function.name)
    expect(names.sort()).toEqual(
      [
        'buscar_na_web',
        'buscar_no_codigo',
        'escrever_arquivo',
        'executar_comando',
        'ler_arquivo',
        'listar_arquivos',
        'rodar_subagente'
      ].sort()
    )
    for (const t of CODE_AGENT_TOOLS) {
      expect(t.type).toBe('function')
      expect(t.function.parameters).toHaveProperty('type', 'object')
    }
  })

  it('gates only the mutating tools behind approval', () => {
    expect(needsApproval('escrever_arquivo')).toBe(true)
    expect(needsApproval('executar_comando')).toBe(true)
    expect(needsApproval('ler_arquivo')).toBe(false)
    expect(needsApproval('buscar_no_codigo')).toBe(false)
    expect(needsApproval('listar_arquivos')).toBe(false)
  })
})

describe('runCodeTool — read tools', () => {
  it('lists files relative to the root', async () => {
    const res = JSON.parse((await runCodeTool('listar_arquivos', {}, ctx())).content)
    expect(res.arquivos).toContain('src/a.ts')
    expect(res.arquivos).toContain('README.md')
  })

  it('reads a file with a char window and reports truncation', async () => {
    const res = JSON.parse(
      (await runCodeTool('ler_arquivo', { caminho: 'src/a.ts', max_chars: 6 }, ctx())).content
    )
    expect(res.conteudo).toBe('export')
    expect(res.truncado).toBe(true)
    expect(res.proximoInicio).toBe(6)
  })

  it('refuses a path that escapes the root', async () => {
    const res = JSON.parse(
      (await runCodeTool('ler_arquivo', { caminho: '../../etc/passwd' }, ctx())).content
    )
    expect(res.error).toBeTruthy()
  })

  it('greps and groups matches by file', async () => {
    const res = JSON.parse(
      (await runCodeTool('buscar_no_codigo', { termo: 'const' }, ctx())).content
    )
    const file = res.arquivos.find((a: { arquivo: string }) => a.arquivo === 'src/a.ts')
    expect(file.ocorrencias.length).toBe(2)
    expect(file.ocorrencias[0]).toMatchObject({ linha: 1 })
  })
})

describe('runCodeTool — write tool', () => {
  it('creates a new file and reports it', async () => {
    const res = JSON.parse(
      (await runCodeTool('escrever_arquivo', { caminho: 'src/new.ts', conteudo: 'x' }, ctx()))
        .content
    )
    expect(res).toMatchObject({ ok: true, criado: true })
    expect(await readFile(join(root, 'src', 'new.ts'), 'utf-8')).toBe('x')
  })

  it('creates missing directories on the way', async () => {
    await runCodeTool('escrever_arquivo', { caminho: 'a/b/c.ts', conteudo: 'y' }, ctx())
    expect(existsSync(join(root, 'a', 'b', 'c.ts'))).toBe(true)
  })

  it('refuses to write outside the root — confinement, not just approval', async () => {
    const res = JSON.parse(
      (await runCodeTool('escrever_arquivo', { caminho: '../escape.ts', conteudo: 'z' }, ctx()))
        .content
    )
    expect(res.error).toBeTruthy()
    expect(existsSync(join(root, '..', 'escape.ts'))).toBe(false)
  })
})

describe('runCodeTool — executar_comando', () => {
  it('runs via the injected runner and caps nothing small', async () => {
    const run: CommandRunner = vi.fn(async () => ({ stdout: 'ok\n', stderr: '', code: 0 }))
    const res = JSON.parse(
      (await runCodeTool('executar_comando', { comando: 'echo ok' }, { root, run })).content
    )
    expect(run).toHaveBeenCalledWith('echo ok', { cwd: root, timeoutMs: 60000 })
    expect(res).toMatchObject({ code: 0, stdout: 'ok\n' })
  })

  it('reports a timeout as such, not as a plain non-zero exit', async () => {
    const run: CommandRunner = async () => ({ stdout: '', stderr: '', code: null, timedOut: true })
    const res = JSON.parse(
      (await runCodeTool('executar_comando', { comando: 'sleep 999' }, { root, run })).content
    )
    expect(res.timeout).toBe(true)
  })

  it('clamps the timeout to the ceiling', async () => {
    const run = vi.fn<CommandRunner>(async () => ({ stdout: '', stderr: '', code: 0 }))
    await runCodeTool('executar_comando', { comando: 'x', timeout_ms: 9_999_999 }, { root, run })
    expect(run.mock.calls[0][1].timeoutMs).toBe(300000)
  })
})

describe('buildSystemPrompt', () => {
  it('always carries the behaviour rules and folds in guide/tree/files when present', () => {
    const p = buildSystemPrompt({ guide: 'GUIA AQUI', tree: 'src/a.ts', files: ['src/a.ts'] })
    expect(p).toContain('agente de código')
    expect(p).toContain('GUIA AQUI')
    expect(p).toContain('ESTRUTURA DE ARQUIVOS')
    expect(p).toContain('src/a.ts')
  })

  it('omits empty sections', () => {
    const p = buildSystemPrompt({})
    expect(p).not.toContain('GUIA DO PROJETO')
    expect(p).not.toContain('ESTRUTURA DE ARQUIVOS')
  })

  it('inlines pinned file contents and tells the agent not to re-fetch them', () => {
    const p = buildSystemPrompt({
      files: ['src/a.ts'],
      fileContents: '### src/a.ts\n   1  export const a = 1'
    })
    expect(p).toContain('JÁ NO CONTEXTO')
    expect(p).toContain('desativadas')
    expect(p).toContain('export const a = 1')
    // The plain "start by these" list is replaced by the inlined section.
    expect(p).not.toContain('Comece por estes')
  })

  it('renders the decisions section as constraints when given', () => {
    const p = buildSystemPrompt({
      decisoes: ['manter o fallback parseV1', 'não alterar o tipo Project']
    })
    expect(p).toContain('DECISÕES JÁ TOMADAS')
    expect(p).toContain('manter o fallback parseV1')
    expect(p).toContain('não alterar o tipo Project')
  })

  it('omits the decisions section when empty or all-blank', () => {
    expect(buildSystemPrompt({})).not.toContain('DECISÕES JÁ TOMADAS')
    expect(buildSystemPrompt({ decisoes: [] })).not.toContain('DECISÕES JÁ TOMADAS')
    expect(buildSystemPrompt({ decisoes: ['   ', ''] })).not.toContain('DECISÕES JÁ TOMADAS')
  })

  it('overrides npm validation for a project without package.json', () => {
    const p = buildSystemPrompt({ nodeProject: false })
    expect(p).toContain('não tem package.json')
    expect(p).toContain('NÃO execute npm')
    expect(p).toContain('HTML/CSS/JS estático')
  })
})

describe('readProjectGuide', () => {
  it('returns a GUIDE.md at the root when present', async () => {
    await writeFile(join(root, 'GUIDE.md'), '# guia do projeto')
    expect(readProjectGuide(root)).toContain('guia do projeto')
  })

  it('returns empty when there is no guide', () => {
    expect(readProjectGuide(root)).toBe('')
  })
})

// --- The loop ---

/** A callModel stub that plays scripted assistant turns in order. */
function scriptedModel(
  turns: AgentMessage[]
): (m: AgentMessage[], t: unknown) => Promise<{ message: AgentMessage }> {
  let i = 0
  return async () => ({ message: turns[Math.min(i++, turns.length - 1)] })
}

function toolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

describe('runCodeAgent — the loop', () => {
  it('runs a read tool, then returns the final text answer', async () => {
    const model = scriptedModel([
      { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'listar_arquivos', {})] },
      { role: 'assistant', content: 'Pronto: são 2 arquivos.' }
    ])
    const seen: string[] = []
    const res = await runCodeAgent('sys', 'liste', ctx(), {
      callModel: model,
      approve: async () => true,
      onToolCall: (n) => seen.push(n)
    })
    expect(res.answer).toBe('Pronto: são 2 arquivos.')
    expect(res.stopped).toBe(false)
    expect(seen).toEqual(['listar_arquivos'])
  })

  it('asks approval for a write and does not write when denied', async () => {
    const model = scriptedModel([
      {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall('c1', 'escrever_arquivo', { caminho: 'x.ts', conteudo: 'q' })]
      },
      { role: 'assistant', content: 'ok' }
    ])
    const approve = vi.fn(async () => false)
    await runCodeAgent('sys', 'edite', ctx(), { callModel: model, approve })
    expect(approve).toHaveBeenCalledOnce()
    expect(existsSync(join(root, 'x.ts'))).toBe(false)
  })

  it('writes when the user approves', async () => {
    const model = scriptedModel([
      {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall('c1', 'escrever_arquivo', { caminho: 'x.ts', conteudo: 'q' })]
      },
      { role: 'assistant', content: 'feito' }
    ])
    await runCodeAgent('sys', 'edite', ctx(), { callModel: model, approve: async () => true })
    expect(await readFile(join(root, 'x.ts'), 'utf-8')).toBe('q')
  })

  it('does not force npm typecheck when validation is non-Node', async () => {
    const callModel = vi.fn(
      scriptedModel([
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            toolCall('c1', 'escrever_arquivo', { caminho: 'index.html', conteudo: '<p>ok</p>' })
          ]
        },
        { role: 'assistant', content: 'feito' }
      ])
    )
    const run = vi.fn<CommandRunner>()
    const res = await runCodeAgent(
      'sys',
      'edite',
      { root, run },
      {
        callModel,
        approve: async () => true,
        requireTypecheck: false
      }
    )

    expect(res.answer).toBe('feito')
    expect(callModel).toHaveBeenCalledTimes(2)
    expect(run).not.toHaveBeenCalled()
  })

  it('drops bulky reads and full write payloads after applying a rewrite', async () => {
    await writeFile(join(root, 'index.html'), '<main>' + 'x'.repeat(5000) + '</main>')
    const snapshots: AgentMessage[][] = []
    const turns: AgentMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall('r1', 'ler_arquivo', { caminho: 'index.html' })]
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          toolCall('w1', 'escrever_arquivo', {
            caminho: 'index.html',
            conteudo: '<main>' + 'y'.repeat(5000) + '</main>'
          })
        ]
      },
      { role: 'assistant', content: 'feito' }
    ]
    let turn = 0
    const callModel = async (messages: AgentMessage[]): Promise<{ message: AgentMessage }> => {
      snapshots.push(structuredClone(messages))
      return { message: turns[turn++] }
    }

    await runCodeAgent('sys', 'refaça', ctx(), {
      callModel,
      approve: async () => true,
      requireTypecheck: false
    })

    const finalContext = JSON.stringify(snapshots.at(-1))
    expect(finalContext).not.toContain('x'.repeat(1000))
    expect(finalContext).not.toContain('y'.repeat(1000))
    expect(finalContext).toContain('conteúdo já aplicado')
  })

  it('blocks the second identical command instead of executing it twice', async () => {
    const run = vi.fn<CommandRunner>(async () => ({ stdout: '', stderr: 'falhou', code: 1 }))
    const model = scriptedModel([
      {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall('c1', 'executar_comando', { comando: 'npm run typecheck' })]
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall('c2', 'executar_comando', { comando: 'npm run typecheck' })]
      },
      { role: 'assistant', content: 'não foi possível validar' }
    ])

    const res = await runCodeAgent(
      'sys',
      'valide',
      { root, run },
      {
        callModel: model,
        approve: async () => true,
        requireTypecheck: false
      }
    )

    expect(res.answer).toBe('não foi possível validar')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('requests and executes mutable actions in model order', async () => {
    const events: string[] = []
    const model = scriptedModel([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          toolCall('c1', 'escrever_arquivo', { caminho: 'x.ts', conteudo: 'q' }),
          toolCall('c2', 'executar_comando', { comando: 'verificar' })
        ]
      },
      { role: 'assistant', content: 'feito' }
    ])

    await runCodeAgent(
      'sys',
      'edite',
      {
        root,
        run: async (command) => {
          events.push(`command:${command}`)
          return { stdout: '', stderr: '', code: 0 }
        }
      },
      {
        callModel: model,
        approve: async ({ name }) => {
          events.push(`approve:${name}`)
          return true
        },
        onToolCall: (name) => events.push(`tool:${name}`)
      }
    )

    expect(events).toEqual([
      'approve:escrever_arquivo',
      'tool:escrever_arquivo',
      'approve:executar_comando',
      'tool:executar_comando',
      'command:verificar'
    ])
  })

  it('stops at maxSteps and still forces a final answer', async () => {
    // A model that always calls a tool would loop forever without the cap.
    const model = async (): Promise<{ message: AgentMessage }> => ({
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall('c', 'listar_arquivos', {})]
      }
    })
    const res = await runCodeAgent('sys', 'x', ctx(), {
      callModel: vi.fn(model),
      approve: async () => true,
      maxSteps: 3
    })
    expect(res.stopped).toBe(true)
    expect(res.steps).toBe(3)
  })

  it('keeps running past the former cap when maxSteps is zero', async () => {
    let calls = 0
    const model = async (): Promise<{ message: AgentMessage }> => {
      calls++
      if (calls > CODE_AGENT_MAX_STEPS) {
        return { message: { role: 'assistant', content: 'concluído depois do limite antigo' } }
      }
      return {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            toolCall(`c${calls}`, 'listar_arquivos', { subpasta: `tentativa-${calls}` })
          ]
        }
      }
    }

    const res = await runCodeAgent('sys', 'continue até concluir', ctx(), {
      callModel: model,
      approve: async () => true,
      maxSteps: 0
    })

    expect(res.stopped).toBe(false)
    expect(res.steps).toBe(CODE_AGENT_MAX_STEPS + 1)
    expect(res.answer).toContain('concluído')
  })

  it('honours shouldAbort between steps', async () => {
    const model = scriptedModel([{ role: 'assistant', content: 'nunca' }])
    const res = await runCodeAgent('sys', 'x', ctx(), {
      callModel: model,
      approve: async () => true,
      shouldAbort: () => true
    })
    expect(res.stopped).toBe(true)
    expect(res.answer).toContain('interrompida')
  })

  it('defaults the cap to CODE_AGENT_MAX_STEPS', () => {
    expect(CODE_AGENT_MAX_STEPS).toBe(100)
  })

  it('suggests a tight cap for a narrow edit and more room for complex work', () => {
    expect(suggestCodeAgentSteps('reduza o font-size do cronômetro')).toBe(4)
    expect(suggestCodeAgentSteps('corrija o componente')).toBe(8)
    expect(suggestCodeAgentSteps('investigue a arquitetura da integração')).toBe(15)
    expect(suggestCodeAgentSteps('use as cores atuais e refaça toda a página')).toBe(25)
  })

  it('announces each step (1-based) with the cap, for the live counter', async () => {
    const model = scriptedModel([
      { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'listar_arquivos', {})] },
      { role: 'assistant', content: '', tool_calls: [toolCall('c2', 'listar_arquivos', {})] },
      { role: 'assistant', content: 'pronto' }
    ])
    const steps: Array<[number, number]> = []
    await runCodeAgent('sys', 'x', ctx(), {
      callModel: model,
      approve: async () => true,
      maxSteps: 10,
      onStep: (step, max) => steps.push([step, max])
    })
    expect(steps).toEqual([
      [1, 10],
      [2, 10],
      [3, 10]
    ])
  })

  it('offers the reduced tool set when the caller passes one (pinned files)', async () => {
    const seenTools: string[][] = []
    const model = async (_m: AgentMessage[], t: ToolDef[]): Promise<{ message: AgentMessage }> => {
      seenTools.push(t.map((x) => x.function.name))
      return { message: { role: 'assistant', content: 'ok' } }
    }
    await runCodeAgent('sys', 'x', ctx(), {
      callModel: model,
      approve: async () => true,
      tools: codeToolsFor({ pinnedFiles: true })
    })
    // Discovery tools are gone; ler_arquivo + the write/command tools stay.
    expect(seenTools[0]).not.toContain('buscar_no_codigo')
    expect(seenTools[0]).not.toContain('listar_arquivos')
    expect(seenTools[0]).toContain('ler_arquivo')
    expect(seenTools[0]).toContain('escrever_arquivo')
  })
})

describe('isRetryableStatus', () => {
  it('retries transient conditions and transport failures, not permanent 4xx', () => {
    expect(isRetryableStatus(undefined)).toBe(true) // no response: dropped socket/timeout
    expect(isRetryableStatus(429)).toBe(true) // rate limit
    expect(isRetryableStatus(408)).toBe(true) // request timeout
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(401)).toBe(false) // bad key — fail fast
    expect(isRetryableStatus(404)).toBe(false)
  })
})

describe('runCodeAgent — resilience to connection errors', () => {
  /** A model that throws `err` the first `fails` calls, then answers `answer`. */
  const flakyModel = (
    fails: number,
    err: unknown,
    answer = 'pronto'
  ): (() => Promise<{ message: AgentMessage }>) => {
    let n = 0
    return async () => {
      if (n++ < fails) throw err
      return { message: { role: 'assistant', content: answer } }
    }
  }

  const connError = Object.assign(new Error('Connection error'), {}) // no status → transient

  it('retries a transient failure with backoff and then completes', async () => {
    const retries: number[] = []
    const res = await runCodeAgent('sys', 'x', ctx(), {
      callModel: flakyModel(2, connError, 'concluído'),
      approve: async () => true,
      sleep: async () => {}, // no real waiting
      onRetry: (attempt) => retries.push(attempt)
    })
    expect(res.answer).toBe('concluído')
    expect(res.stopped).toBe(false)
    expect(retries).toEqual([1, 2]) // two failures announced, third call succeeded
  })

  it('does NOT retry a permanent 4xx and pauses gracefully', async () => {
    const badKey = Object.assign(new Error('Unauthorized'), { status: 401 })
    const retries: number[] = []
    const res = await runCodeAgent('sys', 'x', ctx(), {
      callModel: flakyModel(99, badKey),
      approve: async () => true,
      sleep: async () => {},
      onRetry: (attempt) => retries.push(attempt)
    })
    expect(retries).toEqual([]) // 401 fails fast, no backoff
    expect(res.stopped).toBe(true)
    expect(res.answer).toMatch(/pausou|falhou/i) // a note, not a thrown crash
  })

  it('gives up after CODE_AGENT_MAX_RETRIES and pauses instead of crashing', async () => {
    const retries: number[] = []
    const res = await runCodeAgent('sys', 'x', ctx(), {
      callModel: flakyModel(99, connError), // never recovers
      approve: async () => true,
      sleep: async () => {},
      onRetry: (attempt) => retries.push(attempt)
    })
    expect(retries).toEqual([1, 2, 3]) // exactly MAX_RETRIES backoffs
    expect(retries.length).toBe(CODE_AGENT_MAX_RETRIES)
    expect(res.stopped).toBe(true) // paused, not thrown
    expect(res.answer).toMatch(/diff/) // tells the user their changes are preserved
  })

  it('stops retrying when the run is aborted mid-backoff', async () => {
    let aborted = false
    const retries: number[] = []
    const res = await runCodeAgent('sys', 'x', ctx(), {
      callModel: flakyModel(99, connError),
      approve: async () => true,
      sleep: async () => {},
      shouldAbort: () => aborted,
      onRetry: (attempt) => {
        retries.push(attempt)
        aborted = true // the user hits Parar during the first backoff
      }
    })
    expect(retries).toEqual([1]) // one announced, then the abort halts it
    expect(res.stopped).toBe(true)
  })
})

describe('codeToolsFor', () => {
  it('returns the full set when no files are pinned', () => {
    expect(codeToolsFor({ pinnedFiles: false })).toBe(CODE_AGENT_TOOLS)
  })

  it('drops only the discovery tools when files are pinned', () => {
    const names = codeToolsFor({ pinnedFiles: true }).map((t) => t.function.name)
    expect(names).not.toContain('buscar_no_codigo')
    expect(names).not.toContain('listar_arquivos')
    expect(names.sort()).toEqual(
      [
        'buscar_na_web',
        'escrever_arquivo',
        'executar_comando',
        'ler_arquivo',
        'rodar_subagente'
      ].sort()
    )
  })
})

describe('inlineFilesBlock', () => {
  it('numbers lines 1-based and omits nothing for a small file', () => {
    const { text, omitted } = inlineFilesBlock([{ path: 'a.ts', content: 'linha1\nlinha2' }])
    expect(text).toContain('### a.ts')
    expect(text).toContain('   1  linha1')
    expect(text).toContain('   2  linha2')
    expect(omitted).toEqual([])
  })

  it('truncates a file past the per-file cap and names it in omitted', () => {
    const big = 'x'.repeat(INLINE_FILE_CHAR_CAP + 500)
    const { text, omitted } = inlineFilesBlock([{ path: 'big.ts', content: big }])
    expect(omitted).toEqual(['big.ts'])
    expect(text).toContain('parcial')
    // Only the capped slice was rendered, not the whole file.
    expect(text.length).toBeLessThan(big.length + 200)
  })

  it('stops inlining once the total budget is spent', () => {
    // Each file is capped at INLINE_FILE_CHAR_CAP, so it takes several full files
    // to exhaust the total budget; the file after that is omitted whole.
    const full = 'y'.repeat(INLINE_FILE_CHAR_CAP)
    const n = Math.ceil(INLINE_TOTAL_CHAR_CAP / INLINE_FILE_CHAR_CAP)
    const files = Array.from({ length: n }, (_, i) => ({ path: `f${i}.ts`, content: full }))
    files.push({ path: 'last.ts', content: 'z' })
    const { text, omitted } = inlineFilesBlock(files)
    expect(text).toContain('### f0.ts')
    expect(text).not.toContain('### last.ts')
    expect(omitted).toContain('last.ts')
  })
})
