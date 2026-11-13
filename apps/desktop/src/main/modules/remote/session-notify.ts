/**
 * "Uma sessão de código terminou." (spec docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md):
 * a Fleet session that ends on its own, with any exit code, tells the phones; one the user
 * stopped at the PC (`abort`) does not, since they were there.
 */
export function shouldNotifySessionDone(run: { abort: boolean }): boolean {
  return !run.abort
}
