import { useMemo } from 'react'
import Svg, { Path, Rect } from 'react-native-svg'
import { qrPath } from './qr'

/**
 * Always dark on white, in both themes: many readers fail on an inverted code
 * (decided in docs/plans/2026-11-03-acesso-remoto.md, Task 10).
 */
const QR_LIGHT = 'white'
const QR_DARK = 'black'

/** A QR code drawn with react-native-svg, from the pure-JS `qrcode` matrix. */
export function QrCode({
  value,
  size,
  accessibilityLabel
}: {
  value: string
  size: number
  accessibilityLabel: string
}): React.JSX.Element {
  const qr = useMemo(() => qrPath(value), [value])
  return (
    <Svg
      testID="qr-code"
      width={size}
      height={size}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <Rect x={0} y={0} width={qr.size} height={qr.size} fill={QR_LIGHT} />
      <Path d={qr.path} fill={QR_DARK} />
    </Svg>
  )
}
