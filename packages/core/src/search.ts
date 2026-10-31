/**
 * The FTS5 query for a search box: up to 8 Unicode words, each a quoted prefix
 * term, all required. Quoting makes anything the user types (quotes, *, NEAR,
 * column filters) a literal token instead of FTS5 syntax.
 */
export function searchMatch(term: string): { tokens: string[]; match: string } {
  const tokens =
    term
      .slice(0, 200)
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 8) ?? []
  return { tokens, match: tokens.map((token) => `"${token}"*`).join(' AND ') }
}
