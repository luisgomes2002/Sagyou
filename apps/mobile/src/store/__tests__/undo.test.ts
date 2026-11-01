import { UNDO_MS, useUndo } from '../undo'

describe('desfazer', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    useUndo.getState().dismiss()
  })
  afterEach(() => jest.useRealTimers())

  it('some sozinho depois de 5 s', () => {
    expect(UNDO_MS).toBe(5000)
    useUndo.getState().show('Tarefa concluída', jest.fn())
    expect(useUndo.getState().message).toBe('Tarefa concluída')
    jest.advanceTimersByTime(4999)
    expect(useUndo.getState().message).toBe('Tarefa concluída')
    jest.advanceTimersByTime(1)
    expect(useUndo.getState().message).toBeNull()
  })

  it('desfaz uma vez só', () => {
    const revert = jest.fn()
    useUndo.getState().show('Tarefa concluída', revert)
    useUndo.getState().run()
    useUndo.getState().run()
    expect(revert).toHaveBeenCalledTimes(1)
    expect(useUndo.getState().message).toBeNull()
  })

  it('um aviso novo substitui o anterior, que nunca é desfeito', () => {
    const first = jest.fn()
    const second = jest.fn()
    useUndo.getState().show('Primeiro', first)
    useUndo.getState().show('Segundo', second)
    expect(useUndo.getState().message).toBe('Segundo')
    jest.advanceTimersByTime(4000)
    useUndo.getState().run()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('sem revert é só aviso, sem Desfazer', () => {
    useUndo.getState().show('Só aviso')
    expect(useUndo.getState().canUndo).toBe(false)
    useUndo.getState().show('Com ação', jest.fn())
    expect(useUndo.getState().canUndo).toBe(true)
  })
})
