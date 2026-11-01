import { fireEvent, render, screen } from '@testing-library/react-native'
import { StyleSheet, Text } from 'react-native'
import { MIN_TOUCH } from '../../theme'
import { BottomSheet, Button, Chip, EmptyState, Fab, Field, ListItem, Snackbar } from '../ui'
import { Inbox } from 'lucide-react-native'

function minHeight(label: string): number {
  const style = StyleSheet.flatten(screen.getByLabelText(label).props.style) ?? {}
  return Number(style.minHeight ?? style.height ?? 0)
}

describe('componentes base', () => {
  it('Button desabilitado não chama onPress', async () => {
    const onPress = jest.fn()
    await render(<Button label="Salvar" onPress={onPress} disabled />)
    const button = screen.getByRole('button', { name: 'Salvar' })
    expect(button.props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(button)
    expect(onPress).not.toHaveBeenCalled()
  })

  it('alvos de toque têm pelo menos MIN_TOUCH', async () => {
    await render(
      <>
        <Button label="Botão" onPress={() => undefined} />
        <Chip label="Chip" selected={false} onPress={() => undefined} />
        <Fab a11yLabel="Criar" onPress={() => undefined} />
        <ListItem title="Item" onPress={() => undefined} />
      </>
    )
    for (const label of ['Botão', 'Chip', 'Criar', 'Item'])
      expect([label, minHeight(label) >= MIN_TOUCH]).toEqual([label, true])
  })

  it('Field mostra o erro como alerta', async () => {
    await render(<Field label="Valor" value="" error="Valor inválido" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Valor inválido')
  })

  it('BottomSheet invisível não renderiza os filhos', async () => {
    await render(
      <BottomSheet visible={false} onClose={() => undefined}>
        <Text>conteúdo</Text>
      </BottomSheet>
    )
    expect(screen.queryByText('conteúdo')).toBeNull()
  })

  it('Snackbar chama a ação', async () => {
    const onAction = jest.fn()
    await render(
      <Snackbar visible message="Tarefa concluída" actionLabel="Desfazer" onAction={onAction} />
    )
    expect(screen.getByText('Tarefa concluída')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Desfazer' }))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('EmptyState lê o texto', async () => {
    await render(<EmptyState icon={Inbox} text="Nada aqui." />)
    expect(screen.getByText('Nada aqui.')).toBeTruthy()
  })
})
