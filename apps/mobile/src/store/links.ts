import { Linking } from 'react-native'
import { useUndo } from './undo'

export const BAD_LINK_TEXT =
  'Este link não pode ser aberto. Use um endereço que comece com http:// ou https://.'
export const LINK_FAILED_TEXT = 'Não foi possível abrir o link.'

/** A web address: `http:` or `https:`, a host, and no whitespace anywhere. */
const WEB_LINK = /^(https?):\/\/([^\s/?#]\S*)$/i

/**
 * The link only opens when it is a web address. ⚠️ The text is typed by the user (or arrives from
 * another device), and `Linking.openURL` would hand any scheme (`tel:`, `intent:`, `file:`…) to the
 * system: only `http:` and `https:` go through. The string that was checked is the one opened (only
 * the scheme is lower-cased), so nothing is parsed twice into two different readings.
 */
export function openItemLink(link: string): void {
  const match = WEB_LINK.exec(link.trim())
  if (!match) return useUndo.getState().show(BAD_LINK_TEXT)
  Linking.openURL(`${match[1].toLowerCase()}://${match[2]}`).catch(() =>
    useUndo.getState().show(LINK_FAILED_TEXT)
  )
}
