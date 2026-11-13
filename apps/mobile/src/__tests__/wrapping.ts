// Shared check for the finance rows with two or three buttons (not a test file: no .test suffix).
import { screen, within } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'

/**
 * The actions of a row wrap on a 360 dp phone: the container is a wrapping row and each of its
 * `count` buttons grows from a 112 dp minimum (never `flex: 1`, which squeezes labels instead).
 */
export function expectWrappingActions(containerId: string, count: number): void {
  const container = screen.getByTestId(containerId)
  expect(StyleSheet.flatten(container.props.style)).toMatchObject({
    flexDirection: 'row',
    flexWrap: 'wrap'
  })
  const actions = within(container).getAllByTestId('acao')
  expect(actions).toHaveLength(count)
  for (const action of actions) {
    const style = StyleSheet.flatten(action.props.style)
    expect(style.minWidth).toBeGreaterThanOrEqual(112)
    expect(style.flexGrow).toBe(1)
    expect(style.flex).toBeUndefined()
  }
}
