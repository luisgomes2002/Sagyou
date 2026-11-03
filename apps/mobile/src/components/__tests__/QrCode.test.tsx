import { create as createQr } from 'qrcode'
import { render, screen } from '@testing-library/react-native'
import { QR_MARGIN, QrCode, qrPath } from '../QrCode'

const CODE = 'sagyou-sync:1:aHR0cHM6Ly9leGVtcGxvLndvcmtlcnMuZGV2:QUJD:convite-de-teste-1234'

describe('QrCode', () => {
  it('desenha exatamente os módulos escuros do qrcode, com a margem', () => {
    const { modules } = createQr(CODE, { errorCorrectionLevel: 'M' })
    let expected = 0
    for (let row = 0; row < modules.size; row += 1)
      for (let col = 0; col < modules.size; col += 1) if (modules.get(row, col)) expected += 1
    const qr = qrPath(CODE)
    expect(qr.dark).toBe(expected)
    expect(qr.path.match(/M/g)?.length).toBe(expected)
    expect(qr.size).toBe(modules.size + QR_MARGIN * 2)
  })

  it('o mesmo valor dá sempre o mesmo desenho; outro valor, outro', () => {
    expect(qrPath(CODE)).toEqual(qrPath(CODE))
    expect(qrPath(CODE).path).not.toBe(qrPath(CODE + 'x').path)
  })

  it('tem rótulo de acessibilidade', async () => {
    await render(<QrCode value={CODE} size={240} accessibilityLabel="Código de pareamento" />)
    expect(screen.getByLabelText('Código de pareamento')).toBeTruthy()
  })
})
