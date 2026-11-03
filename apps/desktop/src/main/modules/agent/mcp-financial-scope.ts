/**
 * Which financial tables an MCP read sees. A Fleet run captured one profile
 * and sees only it, whatever it asks for. The external token (profile null)
 * sees every profile, optionally filtered by `profileId`; each table carries
 * its profile's id and name so the agent can tell them apart (spec
 * docs/specs/2026-11-03-acesso-remoto.md).
 */
export const MCP_DEFAULT_FINANCIAL_PROFILE_ID = 'personal'

export function mcpFinancialTables<T extends { profileId?: string }>(
  data: { lists: T[]; financialProfiles?: { id: string; name: string }[] },
  sessionProfileId: string | null,
  filter?: string
): (T & { profileId: string; profileName: string })[] {
  const names = new Map((data.financialProfiles ?? []).map((p) => [p.id, p.name]))
  const wanted = sessionProfileId ?? filter
  return data.lists
    .map((list) => {
      const profileId = list.profileId || MCP_DEFAULT_FINANCIAL_PROFILE_ID
      return { ...list, profileId, profileName: names.get(profileId) ?? profileId }
    })
    .filter((list) => wanted === undefined || list.profileId === wanted)
}
