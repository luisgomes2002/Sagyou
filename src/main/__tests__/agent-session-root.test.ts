// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { resolveAgentSessionRoot } from '../modules/agent/agent-session-root'

const userDataDir = join(tmpdir(), 'sagyou-session-root-test')
const rootPath = join(tmpdir(), 'project-code')
const project = {
  id: 'project-1',
  codePaths: [
    { id: 'active', path: rootPath },
    { id: 'inactive', path: join(tmpdir(), 'other-code') }
  ],
  activeCodePathIds: ['active']
}

describe('resolveAgentSessionRoot', () => {
  it('keeps general sessions in the same private workspace', () => {
    expect(
      resolveAgentSessionRoot({
        projectId: null,
        requestPath: '',
        project: null,
        userDataDir
      })
    ).toEqual({
      dir: join(userDataDir, 'general-agent-workspace'),
      codeRoot: resolve(userDataDir, 'general-agent-workspace'),
      privateWorkspace: true
    })
  })

  it('uses the private workspace for a project with no code root', () => {
    const result = resolveAgentSessionRoot({
      projectId: project.id,
      requestPath: '',
      project: { id: project.id, codePaths: [], activeCodePathIds: [] },
      userDataDir
    })
    expect(result).toEqual({
      dir: join(userDataDir, 'general-agent-workspace'),
      codeRoot: resolve(userDataDir, 'general-agent-workspace'),
      privateWorkspace: true
    })
  })

  it('keeps a selected active code root', () => {
    expect(
      resolveAgentSessionRoot({
        projectId: project.id,
        requestPath: rootPath,
        project,
        userDataDir
      })
    ).toEqual({ dir: rootPath, codeRoot: resolve(rootPath), privateWorkspace: false })
  })

  it('rejects unauthorized and inactive paths', () => {
    for (const requestPath of [join(tmpdir(), 'outside'), project.codePaths[1].path]) {
      expect(() =>
        resolveAgentSessionRoot({ projectId: project.id, requestPath, project, userDataDir })
      ).toThrow('A raiz escolhida não está autorizada para este projeto.')
    }
  })

  it('rejects a removed project before choosing a workspace', () => {
    expect(() =>
      resolveAgentSessionRoot({
        projectId: 'removed',
        requestPath: '',
        project: null,
        userDataDir
      })
    ).toThrow('Projeto escolhido indisponível.')
  })

  it('rejects a path for a general session', () => {
    expect(() =>
      resolveAgentSessionRoot({
        projectId: null,
        requestPath: rootPath,
        project: null,
        userDataDir
      })
    ).toThrow('Uma sessão geral não aceita pasta de código.')
  })
})
