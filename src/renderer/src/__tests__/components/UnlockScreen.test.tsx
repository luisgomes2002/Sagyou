import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnlockScreen } from '../../components/security/UnlockScreen'

afterEach(() => vi.useRealTimers())

describe('UnlockScreen', () => {
  it('greets the configured user before revealing the password form', () => {
    vi.useFakeTimers()
    render(<UnlockScreen userName="Marina" onUnlocked={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Bem-vindo, Marina' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Desbloqueie o Sagyou' })).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(850))

    expect(screen.getByLabelText('Senha')).toHaveFocus()
  })

  it('unlocks only after the main process accepts the password', async () => {
    const onUnlocked = vi.fn()
    const unlock = vi.fn(async () => ({ success: true }))
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { security: { unlock } }
    render(<UnlockScreen onUnlocked={onUnlocked} />)

    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segura' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Desbloquear' }).closest('form')!)

    await vi.waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce())
    expect(unlock).toHaveBeenCalledWith('segura')
  })
})
