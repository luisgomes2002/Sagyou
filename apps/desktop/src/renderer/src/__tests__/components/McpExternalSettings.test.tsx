import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  ACTIVE_SCOPE_TEXT,
  ALLOW_LOCKED_LABEL,
  ALLOW_LOCKED_WARNING,
  FULL_ACCESS_WARNING,
  McpExternalSettings,
  NEW_TOKEN_MESSAGE,
  NONE_TEXT,
  ONCE_TEXT,
  REVOKE_MESSAGE
} from '../../components/settings/McpExternalSettings'

vi.mock('../../services/ElectronStorage', () => ({
  ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
    this.load = vi.fn().mockResolvedValue(null)
    this.save = vi.fn().mockResolvedValue(undefined)
  })
}))

const CREATED = Date.UTC(2026, 10, 3, 12)
const ACTIVE = { state: 'active', createdAt: CREATED, lastUsedAt: null, allowWhileLocked: false }
const COMMAND = 'claude mcp add sagyou-externo --scope user -e SAGYOU_MCP_TOKEN=abc'

let api: Record<string, ReturnType<typeof vi.fn>>
let security: { status: ReturnType<typeof vi.fn> }
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  api = {
    status: vi.fn().mockResolvedValue({ state: 'none' }),
    create: vi.fn().mockResolvedValue({ ok: true, token: 'abc', command: COMMAND, status: ACTIVE }),
    setAllowLocked: vi.fn().mockResolvedValue({ ...ACTIVE, allowWhileLocked: true }),
    revoke: vi.fn().mockResolvedValue({ state: 'none' })
  }
  security = { status: vi.fn().mockResolvedValue({ enabled: true, corrupt: false }) }
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { mcpExternal: api, security }
  })
})

describe('Acesso MCP externo', () => {
  it('sem token: aviso de acesso total e Gerar acesso, sem escolher projeto/perfil/acesso', async () => {
    render(<McpExternalSettings onToast={vi.fn()} />)
    expect(await screen.findByText(NONE_TEXT)).toBeInTheDocument()
    expect(screen.getByText(FULL_ACCESS_WARNING)).toBeInTheDocument()
    expect(FULL_ACCESS_WARNING).toBe(
      'O token dá leitura e escrita de tudo no Sagyou, inclusive excluir e mexer em dinheiro, sem pedir aprovação. Não vence: vale até você revogar.'
    )
    expect(screen.queryByLabelText('Projeto padrão')).toBeNull()
    expect(screen.queryByLabelText('Perfil financeiro')).toBeNull()
    expect(screen.queryByLabelText('Acesso')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('gerar mostra o comando uma vez, copia e some com Pronto', async () => {
    const onToast = vi.fn()
    render(<McpExternalSettings onToast={onToast} />)
    await screen.findByText(NONE_TEXT)
    fireEvent.click(screen.getByRole('button', { name: 'Gerar acesso' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledWith())
    expect(await screen.findByText(COMMAND)).toBeInTheDocument()
    expect(screen.getByText(ONCE_TEXT)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar comando' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(COMMAND))
    expect(onToast).toHaveBeenCalledWith('Comando copiado.')
    fireEvent.click(screen.getByRole('button', { name: 'Pronto' }))
    expect(screen.queryByText(COMMAND)).toBeNull()
  })

  it('ativo mostra desde quando, nunca usado e "Acesso total, sem prazo"', async () => {
    api.status.mockResolvedValue(ACTIVE)
    render(<McpExternalSettings onToast={vi.fn()} />)
    expect(
      await screen.findByText(`Ativo desde ${new Date(CREATED).toLocaleString('pt-BR')}`)
    ).toBeInTheDocument()
    expect(screen.getByText('Nunca usado')).toBeInTheDocument()
    expect(screen.getByText(ACTIVE_SCOPE_TEXT)).toBeInTheDocument()
    expect(ACTIVE_SCOPE_TEXT).toBe('Acesso total, sem prazo')
    expect(screen.queryByText(/Válido até|Vencido em/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Renovar' })).toBeNull()
  })

  it('Gerar novo token pede confirmação antes de trocar', async () => {
    api.status.mockResolvedValue({ ...ACTIVE, lastUsedAt: CREATED + 1000 })
    render(<McpExternalSettings onToast={vi.fn()} />)
    expect(await screen.findByText(/^Último uso: /)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Gerar novo token' }))
    expect(screen.getByText(NEW_TOKEN_MESSAGE)).toBeInTheDocument()
    expect(NEW_TOKEN_MESSAGE).toBe(
      'Gerar um token novo? O atual para de valer na hora e o comando do Claude Code precisa ser trocado.'
    )
    expect(api.create).not.toHaveBeenCalled()
    const buttons = screen.getAllByRole('button', { name: 'Gerar novo token' })
    fireEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(api.create).toHaveBeenCalled())
    expect(await screen.findByText(COMMAND)).toBeInTheDocument()
  })

  it('"Funcionar com o Sagyou bloqueado" aparece com senha, com o aviso, e grava', async () => {
    api.status.mockResolvedValue(ACTIVE)
    render(<McpExternalSettings onToast={vi.fn()} />)
    const toggle = await screen.findByLabelText(ALLOW_LOCKED_LABEL)
    expect(toggle).not.toBeChecked()
    expect(screen.getByText(ALLOW_LOCKED_WARNING)).toBeInTheDocument()
    fireEvent.click(toggle)
    await waitFor(() => expect(api.setAllowLocked).toHaveBeenCalledWith(true))
    await waitFor(() => expect(screen.getByLabelText(ALLOW_LOCKED_LABEL)).toBeChecked())
  })

  it('sem senha no app, a opção de funcionar bloqueado não aparece', async () => {
    security.status.mockResolvedValue({ enabled: false, corrupt: false })
    api.status.mockResolvedValue(ACTIVE)
    render(<McpExternalSettings onToast={vi.fn()} />)
    await screen.findByText(ACTIVE_SCOPE_TEXT)
    await waitFor(() => expect(security.status).toHaveBeenCalled())
    expect(screen.queryByLabelText(ALLOW_LOCKED_LABEL)).toBeNull()
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
