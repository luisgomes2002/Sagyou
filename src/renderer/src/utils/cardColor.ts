export function cardTextColor(color: string): string {
  const hex = color.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#d4d4d4'
  const channels = [0, 2, 4].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  return luminance > 0.18 ? '#1b1b1b' : '#ffffff'
}

export function pastelCardColor(color: string | undefined): string | undefined {
  const hex = color?.replace('#', '')
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined
  const channels = [0, 2, 4].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16)
    return Math.round(value * 0.4 + 255 * 0.6)
      .toString(16)
      .padStart(2, '0')
  })
  return `#${channels.join('')}`
}
