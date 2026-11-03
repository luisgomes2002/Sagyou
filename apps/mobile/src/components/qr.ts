import { create as createQr } from 'qrcode'

/** Modules of quiet zone around the code, as the QR spec asks for. */
export const QR_MARGIN = 4

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
