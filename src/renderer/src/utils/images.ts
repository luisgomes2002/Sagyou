/**
 * Longest edge kept when a pasted screenshot is downscaled, in px.
 *
 * A vision model bills by tiles: a 4K screenshot costs several times a 1024px
 * one and reads no better for the "what's wrong with this screen?" question
 * this exists for. It also has to survive re-sending — the agent resends the
 * whole conversation on every step.
 */
export const MAX_IMAGE_EDGE = 1024

/** Below this, downscaling buys nothing and only costs a re-encode. */
const MIN_USEFUL_EDGE = 320

/**
 * Read a pasted or dropped image and shrink it to something worth sending.
 *
 * Kept as PNG: these are screenshots, and JPEG artefacts around small text are
 * exactly what makes a screenshot unreadable to a vision model.
 */
export async function toScaledDataUrl(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = longest > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longest : 1
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    // Already small: re-encoding a tiny image can make it bigger, not smaller.
    if (scale === 1 && longest <= MIN_USEFUL_EDGE) return await blobToDataUrl(file)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return await blobToDataUrl(file)
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/png')
  } finally {
    bitmap.close()
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Falha ao ler a imagem'))
    reader.readAsDataURL(blob)
  })
}

/** The image files among a paste or a drop, ignoring the rest. */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  return Array.from(data.files).filter((f) => f.type.startsWith('image/'))
}
