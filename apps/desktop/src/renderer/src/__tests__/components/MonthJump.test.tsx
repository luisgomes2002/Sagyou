import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MonthJump } from '../../components/financial/MonthJump'

describe('MonthJump', () => {
  it('vai diretamente ao mês e ano escolhidos pelo campo ou digitados', () => {
    const onChange = vi.fn()
    const { getByLabelText, getByRole } = render(
      <MonthJump month={{ year: 2025, month: 1 }} onChange={onChange} />
    )
    const input = getByLabelText('Escolher mês e ano') as HTMLInputElement

    fireEvent.change(input, { target: { value: '2027-11' } })
    fireEvent.click(getByRole('button', { name: 'Ir' }))
    expect(onChange).toHaveBeenCalledWith({ year: 2027, month: 11 })

    fireEvent.change(input, { target: { value: '2030-04' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith({ year: 2030, month: 4 })
  })

  it('sincroniza o campo depois que as setas ou Hoje mudam o mês', () => {
    const onChange = vi.fn()
    const { getByLabelText, rerender } = render(
      <MonthJump month={{ year: 2025, month: 1 }} onChange={onChange} />
    )
    const input = getByLabelText('Escolher mês e ano') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2027-11' } })

    rerender(<MonthJump month={{ year: 2025, month: 2 }} onChange={onChange} />)
    expect((getByLabelText('Escolher mês e ano') as HTMLInputElement).value).toBe('2025-02')
  })
})
