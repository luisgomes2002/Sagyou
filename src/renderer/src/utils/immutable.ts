/**
 * Immutable Set add/remove — Zustand needs a new reference to notify changes.
 */
export const setAdd = <T>(s: Set<T>, v: T): Set<T> => new Set(s).add(v)
export const setDel = <T>(s: Set<T>, v: T): Set<T> => {
  const n = new Set(s)
  n.delete(v)
  return n
}
