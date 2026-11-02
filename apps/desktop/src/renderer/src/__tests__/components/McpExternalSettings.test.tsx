import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  McpExternalSettings,
  NONE_TEXT,
  ONCE_TEXT,
  REVOKE_MESSAGE
} from '../../components/settings/McpExternalSettings'
import { useKanbanStore } from '../../store/kanban'

vi.mock('../../services/ElectronStorage', () => ({
  ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
    this.load = vi.fn().mockResolvedValue(null)
    this.save = vi.fn().mockResolvedValue(undefined)
  })
}))

const EXPIRES = Date.UTC(2026, 11, 2, 12)
const SCOPE = { projectId: 'p1', financialProfileId: 'personal', mode: 'read' as const }
const ACTIVE = { state: 'active', createdAt: 1, expiresAt: EXPIRES, lastUsedAt: null, scope: SCOPE }
const COMMAND = 'claude mcp add sagyou-externo --scope user -e SAGYOU_MCP_TOKEN=abc'

let api: Record<string, ReturnType<typeof vi.fn>>
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  useKanbanStore.setState({
    projects: [
      { id: 'p1', name: 'Sagyou', columns: [] },
      { id: 'p2', name: 'Arquivado', columns: [], archivedAt: '2026-01-01' }
    ] as never,
    financialProfiles: [
      { id: 'personal', name: 'Minhas finanças' },
      { id: 'trabalho', name: 'Trabalho' }
    ] as never,
    activeFinancialProfileId: 'trabalho'
  })
  api = {
    status: vi.fn().mockResolvedValue({ state: 'none' }),
    create: vi.fn().mockResolvedValue({ ok: true, token: 'abc', command: COMMAND, status: ACTIVE }),
    renew: vi.fn().mockResolvedValue({
      ok: true,
      token: 'def',
      command: COMMAND.replace('abc', 'def'),
      status: ACTIVE
    }),
    revoke: vi.fn().mockResolvedValue({ state: 'none' })
  }
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { mcpExternal: api }
  })
})

describe('Acesso MCP externo', () => {
  it('sem token mostra o formulário com o perfil ativo e "Só leitura"', async () => {
    render(<McpExternalSettings onToast={vi.fn()} />)
    expect(await screen.findByText(NONE_TEXT)).toBeInTheDocument()
    expect(screen.getByLabelText('Perfil financeiro')).toHaveValue('trabalho')
    expect(screen.getByLabelText('Acesso')).toHaveValue('read')
    expect(screen.getByLabelText('Projeto padrão')).toHaveValue('')
    expect(screen.queryByRole('option', { name: 'Arquivado' })).toBeNull()
  })

  it('gerar mostra o comando uma vez, copia e some com Pronto', async () => {
    const onToast = vi.fn()
    render(<McpExternalSettings onToast={onToast} />)
    await screen.findByText(NONE_TEXT)
    fireEvent.change(screen.getByLabelText('Projeto padrão'), { target: { value: 'p1' } })
    fireEvent.change(screen.getByLabelText('Acesso'), { target: { value: 'read-write' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gerar acesso' }))
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({
        projectId: 'p1',
        financialProfileId: 'trabalho',
        mode: 'read-write'
      })
    )
    expect(await screen.findByText(COMMAND)).toBeInTheDocument()
    expect(screen.getByText(ONCE_TEXT)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar comando' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(COMMAND))
    expect(onToast).toHaveBeenCalledWith('Comando copiado.')
    fireEvent.click(screen.getByRole('button', { name: 'Pronto' }))
    expect(screen.queryByText(COMMAND)).toBeNull()
  })

  it('ativo mostra validade, nunca usado e o escopo', async () => {
    api.status.mockResolvedValue(ACTIVE)
    render(<McpExternalSettings onToast={vi.fn()} />)
    expect(
      await screen.findByText(`Válido até ${new Date(EXPIRES).toLocaleString('pt-BR')}`)
    ).toBeInTheDocument()
    expect(screen.getByText('Nunca usado')).toBeInTheDocument()
    expect(
      screen.getByText('Projeto: Sagyou · Perfil: Minhas finanças · Só leitura')
    ).toBeInTheDocument()
  })

  it('vencido mostra "Vencido em" e Renovar mostra o comando novo', async () => {
    api.status.mockResolvedValue({ ...ACTIVE, state: 'expired', lastUsedAt: EXPIRES - 1000 })
    render(<McpExternalSettings onToast={vi.fn()} />)
    expect(await screen.findByText(/^Vencido em /)).toBeInTheDocument()
    expect(screen.getByText(/^Último uso: /)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Renovar' }))
    expect(await screen.findByText(COMMAND.replace('abc', 'def'))).toBeInTheDocument()
  })

  it('revogar pede confirmação e volta ao estado sem token', async () => {
    api.status.mockResolvedValue(ACTIVE)
    const onToast = vi.fn()
    render(<McpExternalSettings onToast={onToast} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar' }))
    expect(screen.getByText(REVOKE_MESSAGE)).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Revogar' })
    fireEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(api.revoke).toHaveBeenCalled())
    expect(await screen.findByText(NONE_TEXT)).toBeInTheDocument()
    expect(onToast).toHaveBeenCalledWith('Acesso MCP externo revogado.')
  })

  it('mostra o erro de gerar', async () => {
    api.create.mockResolvedValue({
      ok: false,
      error: 'Não foi possível gerar o acesso MCP externo.'
    })
    render(<McpExternalSettings onToast={vi.fn()} />)
    await screen.findByText(NONE_TEXT)
    fireEvent.click(screen.getByRole('button', { name: 'Gerar acesso' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível gerar o acesso MCP externo.'
    )
  })

  // Review: a failing IPC closed the dialog, changed nothing and said nothing.
  it('se revogar falha, mostra o erro e mantém o acesso na tela', async () => {
    api.status.mockResolvedValue(ACTIVE)
    api.revoke.mockRejectedValue(new Error('EPERM'))
    render(<McpExternalSettings onToast={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar' }))
    const buttons = screen.getAllByRole('button', { name: 'Revogar' })
    fireEvent.click(buttons[buttons.length - 1])
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível revogar o acesso MCP externo.'
    )
    expect(screen.getByText('Nunca usado')).toBeInTheDocument()
  })
})
