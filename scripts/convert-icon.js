import sharp from 'sharp'
import { promises as fs } from 'fs'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(__dirname)
const buildDir = `${projectRoot}/build`
const logoPath = `${projectRoot}/src/renderer/src/assets/logo256x256.jpeg`

async function convertIcons() {
  try {
    console.log('Converting logo to icon formats...')

    // Ensure build directory exists
    await fs.mkdir(buildDir, { recursive: true })

    // Convert to PNG (used by electron-builder)
    console.log('Creating icon.png...')
    await sharp(logoPath).png().toFile(`${buildDir}/icon.png`)

    // Create icon.ico for Windows using proper ICO format
    console.log('Creating icon.ico...')
    const sizes = [256, 128, 96, 64, 48, 32, 16]
    const images = []

    for (const size of sizes) {
      const buffer = await sharp(logoPath)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
        .png()
        .toBuffer()
      images.push(buffer)
    }

    // Build ICO file manually (simple ICO format)
    const icoBuffer = buildIcoFile(images)
    await fs.writeFile(`${buildDir}/icon.ico`, icoBuffer)

    // Create icon.icns for macOS
    console.log('Creating icon.icns...')
    await sharp(logoPath).toFile(`${buildDir}/icon.icns`)

    console.log('✓ Icon conversion complete!')
    console.log('✓ All icon files created successfully in build/')
  } catch (error) {
    console.error('Error converting icons:', error)
    process.exit(1)
  }
}

// Simple ICO file builder (creates a valid ICO file from PNG buffers)
function buildIcoFile(pngBuffers) {
  const iconDir = Buffer.alloc(6 + pngBuffers.length * 16)
  iconDir.writeUInt16LE(0, 0) // Reserved
  iconDir.writeUInt16LE(1, 2) // Type = ICO
  iconDir.writeUInt16LE(pngBuffers.length, 4) // Number of images

  const sizes = [256, 128, 96, 64, 48, 32, 16]
  let offset = 6 + pngBuffers.length * 16

  // Build icon directory entries
  for (let i = 0; i < pngBuffers.length; i++) {
    const dirOffset = 6 + i * 16
    // In ICO format, 0 means 256 for width/height
    const width = sizes[i] === 256 ? 0 : sizes[i]
    const height = sizes[i] === 256 ? 0 : sizes[i]
    iconDir.writeUInt8(width, dirOffset) // Width
    iconDir.writeUInt8(height, dirOffset + 1) // Height
    iconDir.writeUInt8(0, dirOffset + 2) // Color count
    iconDir.writeUInt8(0, dirOffset + 3) // Reserved
    iconDir.writeUInt16LE(1, dirOffset + 4) // Color planes
    iconDir.writeUInt16LE(32, dirOffset + 6) // Bits per pixel
    iconDir.writeUInt32LE(pngBuffers[i].length, dirOffset + 8) // Size
    iconDir.writeUInt32LE(offset, dirOffset + 12) // Offset
    offset += pngBuffers[i].length
  }

  // Concatenate all data
  return Buffer.concat([iconDir, ...pngBuffers])
}

convertIcons()
