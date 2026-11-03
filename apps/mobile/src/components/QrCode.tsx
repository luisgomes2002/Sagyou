import { useMemo } from 'react'
import { create as createQr } from 'qrcode'
import Svg, { Path, Rect } from 'react-native-svg'

/** Modules of quiet zone around the code, as the QR spec asks for. */
export const QR_MARGIN = 4
/**
 * Always dark on white, in both themes: many readers fail on an inverted code
 * (decided in docs/plans/2026-11-03-acesso-remoto.md, Task 10).
 */
const QR_LIGHT = 'white'
const QR_DARK = 'black'

/** The dark modules of `value`, row by row, as one SVG path (one 1x1 square each). */
export function qrPath(value: string): { size: number; path: string; dark: number } {
  const { modules } = createQr(value, { errorCorrectionLevel: 'M' })
  const n = modules.size
  let path = ''
  let dark = 0
  for (let row = 0; row < n; row += 1)
    for (let col = 0; col < n; col += 1)
      if (modules.get(row, col)) {
        dark += 1
        path += `M${col + QR_MARGIN} ${row + QR_MARGIN}h1v1h-1z`
      }
  return { size: n + QR_MARGIN * 2, path, dark }
}

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
