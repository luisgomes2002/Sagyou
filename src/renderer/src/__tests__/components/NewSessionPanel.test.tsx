import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewSessionPanel, type Harness } from '../../components/ai/fleet/NewSessionPanel'
import type { Project } from '../../types'

const projects = [
  { id: 'empty', name: 'Sem código', codePaths: [], activeCodePathIds: [] },
  {
    id: 'rooted',
    name: 'Com código',
    codePaths: [{ id: 'root', path: '/code/project', label: 'Código' }],
    activeCodePathIds: ['root']
  }
] as Project[]

const harnesses = [
  {
    id: 'codex',
    label: 'Codex',
    installed: true,
    capabilities: {
      createSession: 'available',
      interactiveTerminal: 'available',
      mcp: 'available'
    }
  }
] as Harness[]

describe('NewSessionPanel', () => {
  it('opens a project session without a code root', async () => {
    const onStart = vi.fn()
    const user = userEvent.setup()
    render(
      <NewSessionPanel
        projects={projects}
        harnesses={harnesses}
        starting={false}
        error=""
        onStart={onStart}
      />
    )

    await user.selectOptions(screen.getByRole('combobox', { name: 'Projeto da sessão' }), 'empty')
    expect(
      screen.getByText(
        'Sem pasta de código: o agente usará um espaço privado. O MCP continuará vinculado a este projeto.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir sessão' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Abrir sessão' }))
    expect(onStart).toHaveBeenCalledWith({
      projectId: 'empty',
      rootPath: '',
      harnessId: ''
    })
  })

  it('keeps the active root selected and allows an explicit private session', async () => {
    const onStart = vi.fn()
    const user = userEvent.setup()
    render(
      <NewSessionPanel
        projects={projects}
        harnesses={harnesses}
        starting={false}
        error=""
        onStart={onStart}
      />
    )

    await user.selectOptions(screen.getByRole('combobox', { name: 'Projeto da sessão' }), 'rooted')
    expect(screen.getByRole('combobox', { name: 'Pasta de código' })).toHaveValue('/code/project')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Pasta de código' }), '')
    await user.click(screen.getByRole('button', { name: 'Abrir sessão' }))
    expect(onStart).toHaveBeenCalledWith({
      projectId: 'rooted',
      rootPath: '',
      harnessId: ''
    })
  })
})
