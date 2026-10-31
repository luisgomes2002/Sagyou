import { join, resolve } from 'path'

interface CodeRoot {
  id: string
  path: string
}

interface SessionProject {
  id: string
  codePaths?: CodeRoot[]
  activeCodePathIds?: string[]
  activeCodePathId?: string
}

interface SessionRootInput {
  projectId: string | null
  requestPath: unknown
  project: SessionProject | null
  userDataDir: string
}

export interface AgentSessionRoot {
  dir: string
  codeRoot: string
  privateWorkspace: boolean
}

/** Resolves the execution directory in main; the renderer never names the private workspace. */
export function resolveAgentSessionRoot(input: SessionRootInput): AgentSessionRoot {
  const { projectId, project, userDataDir } = input
  const requestPath = input.requestPath
  if (projectId && (!project || project.id !== projectId)) {
    throw new Error('Projeto escolhido indisponível. Selecione-o novamente.')
  }
  if (typeof requestPath !== 'string') {
    throw new Error('Diretório do projeto inválido')
  }
  if (!projectId && requestPath) {
    throw new Error('Uma sessão geral não aceita pasta de código.')
  }
  if (!requestPath) {
    const dir = join(userDataDir, 'general-agent-workspace')
    return { dir, codeRoot: resolve(dir), privateWorkspace: true }
  }

  const codeRoot = resolve(requestPath)
  const activeIds = project?.activeCodePathIds ??
    (project?.activeCodePathId ? [project.activeCodePathId] : [])
  const authorized = (project?.codePaths ?? []).some(
    (root) => activeIds.includes(root.id) && resolve(root.path) === codeRoot
  )
  if (!authorized) {
    throw new Error(
      'A raiz escolhida não está autorizada para este projeto. Marque-a no projeto antes de iniciar.'
    )
  }
  return { dir: requestPath, codeRoot, privateWorkspace: false }
}
