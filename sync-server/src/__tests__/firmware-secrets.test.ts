// @vitest-environment node
//
// The ESP32 firmware lives in this public repository (firmware/esp32/). Its
// secrets.h holds the Wi-Fi password, the ESP32's power token and its HMAC key:
// none of that may ever be committed. This runs in CI over the files git tracks.
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')

function tracked(prefix: string): string[] {
  return execFileSync('git', ['ls-files', '--', prefix], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
}

describe('segredos do firmware do ESP32', () => {
  const files = tracked('firmware')

  it('o firmware está no repositório', () => {
    expect(files).toContain('firmware/esp32/src/main.cpp')
    expect(files).toContain('firmware/esp32/include/secrets.example.h')
  })

  it('nenhum secrets.h é versionado, nem o build do PlatformIO', () => {
    expect(files.filter((f) => /(^|\/)secrets\.h$/.test(f))).toEqual([])
    expect(files.filter((f) => f.includes('/.pio/'))).toEqual([])
  })

  it('o .gitignore da raiz ignora os dois', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
    expect(ignore).toContain('firmware/**/secrets.h')
    expect(ignore).toContain('firmware/**/.pio/')
  })

  it('nenhum arquivo do firmware carrega algo com cara de chave ou token', () => {
    for (const file of files) {
      const text = readFileSync(join(ROOT, file), 'utf8')
      // ESP32_KEY: 64 hex characters (32 bytes).
      expect([file, /\b[0-9a-fA-F]{64}\b/.test(text)]).toEqual([file, false])
      // A POWER_TOKEN or Wi-Fi password assigned to a real-looking value.
      expect([file, /POWER_TOKEN\s+"[A-Za-z0-9_-]{20,}"/.test(text)]).toEqual([file, false])
    }
  })

  it('o exemplo só tem valores de exemplo', () => {
    const example = readFileSync(join(ROOT, 'firmware/esp32/include/secrets.example.h'), 'utf8')
    expect(example).toContain('#define WIFI_SSID "nome-da-rede"')
    expect(example).toContain('#define WIFI_PASSWORD "senha-da-rede"')
  })
})
