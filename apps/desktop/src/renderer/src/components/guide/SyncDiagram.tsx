import type { JSX } from 'react'

export const SYNC_DIAGRAM_LABEL = 'Tudo trafega cifrado; o servidor não tem a chave.'

function Node({ x, title, detail }: { x: number; title: string; detail: string }): JSX.Element {
  return (
    <g>
      <rect x={x} y={20} width={150} height={64} rx={10} fill="#101014" stroke="#2b2b31" />
      <text x={x + 75} y={48} textAnchor="middle" fontSize="13" fontWeight="600" fill="#d4d4d4">
        {title}
      </text>
      <text x={x + 75} y={68} textAnchor="middle" fontSize="11" fill="#999999">
        {detail}
      </text>
    </g>
  )
}

function Link({ x }: { x: number }): JSX.Element {
  // Two-way arrow between boxes with a lock in the middle.
  const mid = x + 35
  return (
    <g stroke="#a080f0" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${x + 4} 52 H${x + 66}`} />
      <path d={`M${x + 10} 46 L${x + 4} 52 L${x + 10} 58`} />
      <path d={`M${x + 60} 46 L${x + 66} 52 L${x + 60} 58`} />
      <rect x={mid - 7} y={28} width={14} height={11} rx={2} fill="#16161a" />
      <path d={`M${mid - 4} 28 v-3 a4 4 0 0 1 8 0 v3`} />
    </g>
  )
}

/** PC ↔ your Worker ↔ phone/other PC, with a lock on each link. */
export function SyncDiagram(): JSX.Element {
  return (
    <figure className="rounded-xl border border-[#2b2b31] bg-[#16161a] p-4">
      <svg
        role="img"
        aria-label={SYNC_DIAGRAM_LABEL}
        viewBox="0 0 590 104"
        className="h-auto w-full"
      >
        <Node x={0} title="Este PC" detail="tem a chave" />
        <Link x={150} />
        <Node x={220} title="Seu Worker" detail="Cloudflare · só cifrado" />
        <Link x={370} />
        <Node x={440} title="Celular / outro PC" detail="tem a chave" />
      </svg>
      <figcaption aria-hidden="true" className="mt-2 text-center text-xs text-[#999999]">
        {SYNC_DIAGRAM_LABEL}
      </figcaption>
    </figure>
  )
}
