// FleetView is unmounted when the user visits another area. The PTYs belong to
// main, not React, so only the selection is remembered; the next mount selects
// the same session again instead of treating navigation as a new request.
// Configurações sets it too, so "Ligar" on a server lands on that server's tab.

let retained: string | null = null

export function retainedFleetSelection(): string | null {
  return retained
}

export function retainFleetSelection(key: string | null): void {
  retained = key
}
