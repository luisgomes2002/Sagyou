import type { GlobalSearchHit } from '../../../main/modules/search/global-search-query'

// A search hit built by hand, so views that highlight a search target can
// also be opened on one entity from elsewhere (the graph's double click).
export function focusedEntityHit(
  type: 'goal' | 'habit' | 'memory',
  id: string,
  title: string,
  completed: boolean
): GlobalSearchHit {
  return {
    type,
    id,
    title,
    snippet: title,
    matchedField: 'title',
    projectId: null,
    profileId: null,
    tableId: null,
    projectArchived: false,
    memoryArchived: false,
    completed,
    state: null,
    date: null
  }
}
