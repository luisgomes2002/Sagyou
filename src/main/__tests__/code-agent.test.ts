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
  needsApproval,
  runCodeTool,
  runCodeAgent,
  buildSystemPrompt,
  readProjectGuide,
  CODE_AGENT_MAX_STEPS,
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
  it('exposes exactly the five tools, each with a JSON schema', () => {
    const names = CODE_AGENT_TOOLS.map((t) => t.function.name)
    expect(names.sort()).toEqual(
      ['buscar_no_codigo', 'escrever_arquivo', 'executar_comando', 'ler_arquivo', 'listar_arquivos'].sort()
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
    const res = JSON.parse((await runCodeTool('ler_arquivo', { caminho: 'src/a.ts', max_chars: 6 }, ctx())).content)
    expect(res.conteudo).toBe('export')
    expect(res.truncado).toBe(true)
    expect(res.proximoInicio).toBe(6)
  })

  it('refuses a path that escapes the root', async () => {
    const res = JSON.parse((await runCodeTool('ler_arquivo', { caminho: '../../etc/passwd' }, ctx())).content)
    expect(res.error).toBeTruthy()
  })

  it('greps and groups matches by file', async () => {
    const res = JSON.parse((await runCodeTool('buscar_no_codigo', { termo: 'const' }, ctx())).content)
    const file = res.arquivos.find((a: { arquivo: string }) => a.arquivo === 'src/a.ts')
    expect(file.ocorrencias.length).toBe(2)
    expect(file.ocorrencias[0]).toMatchObject({ linha: 1 })
  })
})

describe('runCodeTool — write tool', () => {
  it('creates a new file and reports it', async () => {
    const res = JSON.parse(
      (await runCodeTool('escrever_arquivo', { caminho: 'src/new.ts', conteudo: 'x' }, ctx())).content
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
      (await runCodeTool('escrever_arquivo', { caminho: '../escape.ts', conteudo: 'z' }, ctx())).content
    )
    expect(res.error).toBeTruthy()
    expect(existsSync(join(root, '..', 'escape.ts'))).toBe(false)
  })
})

describe('runCodeTool — executar_comando', () => {
  it('runs via the injected runner and caps nothing small', async () => {
    const run: CommandRunner = vi.fn(async () => ({ stdout: 'ok\n', stderr: '', code: 0 }))
    const res = JSON.parse((await runCodeTool('executar_comando', { comando: 'echo ok' }, { root, run })).content)
    expect(run).toHaveBeenCalledWith('echo ok', { cwd: root, timeoutMs: 60000 })
    expect(res).toMatchObject({ code: 0, stdout: 'ok\n' })
  })

  it('reports a timeout as such, not as a plain non-zero exit', async () => {
    const run: CommandRunner = async () => ({ stdout: '', stderr: '', code: null, timedOut: true })
    const res = JSON.parse((await runCodeTool('executar_comando', { comando: 'sleep 999' }, { root, run })).content)
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
function scriptedModel(turns: AgentMessage[]): (m: AgentMessage[], t: unknown) => Promise<{ message: AgentMessage }> {
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
      { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'escrever_arquivo', { caminho: 'x.ts', conteudo: 'q' })] },
      { role: 'assistant', content: 'ok' }
    ])
    const approve = vi.fn(async () => false)
    await runCodeAgent('sys', 'edite', ctx(), { callModel: model, approve })
    expect(approve).toHaveBeenCalledOnce()
    expect(existsSync(join(root, 'x.ts'))).toBe(false)
  })

  it('writes when the user approves', async () => {
    const model = scriptedModel([
      { role: 'assistant', content: '', tool_calls: [toolCall('c1', 'escrever_arquivo', { caminho: 'x.ts', conteudo: 'q' })] },
      { role: 'assistant', content: 'feito' }
    ])
    await runCodeAgent('sys', 'edite', ctx(), { callModel: model, approve: async () => true })
    expect(await readFile(join(root, 'x.ts'), 'utf-8')).toBe('q')
  })

  it('stops at maxSteps and still forces a final answer', async () => {
    // A model that always calls a tool would loop forever without the cap.
    const model = async (): Promise<{ message: AgentMessage }> => ({
      message: { role: 'assistant', content: '', tool_calls: [toolCall('c', 'listar_arquivos', {})] }
    })
    const res = await runCodeAgent('sys', 'x', ctx(), {
      callModel: vi.fn(model),
      approve: async () => true,
      maxSteps: 3
    })
    expect(res.stopped).toBe(true)
    expect(res.steps).toBe(3)
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
    expect(CODE_AGENT_MAX_STEPS).toBe(30)
  })
})
