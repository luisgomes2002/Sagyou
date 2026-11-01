// Builds the Android app icons and the splash from the desktop icon, so both
// apps carry the same mark. Run from the repo root:
//   node apps/mobile/scripts/make-icons.mjs apps/desktop/build/icon.png
//
// The desktop icon is a purple glyph on a dark rounded square. Android's
// adaptive icon wants the glyph alone on transparency (the launcher draws its
// own mask over a solid background layer), so the glyph is cut out by color:
// a pixel belongs to it when its blue channel clearly beats its red one.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SIZE = 1024
/** The glyph's longest side, as a share of the canvas: inside the 66 dp safe circle of 108 dp. */
const SAFE_SHARE = 0.44
const BACKGROUND = '#0b0b0f'

const source = process.argv[2]
if (!source) {
  console.error('uso: node make-icons.mjs <icon.png do desktop>')
  process.exit(1)
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
mkdirSync(out, { recursive: true })

/** The glyph as RGBA on transparency, cropped to its bounds. */
async function glyph() {
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const px = Buffer.alloc(info.width * info.height * 4)
  for (let i = 0; i < info.width * info.height; i++) {
    const [r, g, b, a] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]]
    // Edge pixels blend into the dark square: ramp the alpha over the margin.
    const strength = Math.max(0, Math.min(1, (b - r - 30) / 90)) * (a / 255)
    px[i * 4] = r
    px[i * 4 + 1] = g
    px[i * 4 + 2] = b
    px[i * 4 + 3] = Math.round(strength * 255)
  }
  return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer()
    .then((buf) => sharp(buf).trim({ threshold: 1 }).png().toBuffer())
}

/** The glyph centered on a transparent SIZE canvas, longest side = share × SIZE. */
async function centered(glyphPng, share) {
  const side = Math.round(SIZE * share)
  const fitted = await sharp(glyphPng)
    .resize(side, side, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  return sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: fitted, gravity: 'center' }])
    .png()
    .toBuffer()
}

/** Same shape, every visible pixel white: Android 13+ tints it to the theme. */
async function monochrome(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < info.width * info.height; i++) {
    data[i * 4] = 255
    data[i * 4 + 1] = 255
    data[i * 4 + 2] = 255
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer()
}

const mark = await glyph()
const foreground = await centered(mark, SAFE_SHARE)

await sharp(foreground).toFile(join(out, 'android-icon-foreground.png'))
await sharp(await monochrome(foreground)).toFile(join(out, 'android-icon-monochrome.png'))
await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: BACKGROUND } })
  .png()
  .toFile(join(out, 'android-icon-background.png'))
// The legacy/store icon is the desktop icon itself; the splash shows the glyph alone.
await sharp(source).resize(SIZE, SIZE).png().toFile(join(out, 'icon.png'))
await sharp(await centered(mark, 0.8)).toFile(join(out, 'splash-icon.png'))
await sharp(source).resize(48, 48).png().toFile(join(out, 'favicon.png'))
console.log('ícones gerados em', out)
