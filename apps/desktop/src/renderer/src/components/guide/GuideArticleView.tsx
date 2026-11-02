import type { JSX } from 'react'
import type { GuideBlock } from '../../guide/types'
import { CommandBlock } from './CommandBlock'
import { GuideVisual } from './GuideVisuals'
import { SyncDiagram } from './SyncDiagram'

const CALLOUTS = {
  tip: {
    label: 'Dica',
    color: 'text-[#a080f0]',
    path: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3Z'
  },
  warning: { label: 'Atenção', color: 'text-[#d9a640]', path: 'M12 3 2 20h20L12 3Zm0 6v5m0 3h.01' },
  danger: {
    label: 'Cuidado',
    color: 'text-[#ec6a6a]',
    path: 'M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5Zm4 5v5m0 3h.01'
  }
} as const

function Callout({ tone, text }: { tone: keyof typeof CALLOUTS; text: string }): JSX.Element {
  const callout = CALLOUTS[tone]
  return (
    <div className="flex gap-3 rounded-lg border border-[#2b2b31] bg-[#16161a] p-3">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`mt-0.5 shrink-0 ${callout.color}`}
      >
        <path d={callout.path} />
      </svg>
      <p className="text-sm leading-6 text-[#d4d4d4]">
        <strong className={`font-semibold ${callout.color}`}>{callout.label}: </strong>
        {text}
      </p>
    </div>
  )
}

function Block({ block }: { block: GuideBlock }): JSX.Element {
  switch (block.type) {
    case 'p':
      return <p className="text-sm leading-6 text-[#d4d4d4]">{block.text}</p>
    case 'steps':
      return (
        <ol className="space-y-2">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-3 text-sm leading-6 text-[#d4d4d4]">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2a2a30] text-[11px] font-semibold text-[#a080f0]"
              >
                {index + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      )
    case 'callout':
      return <Callout tone={block.tone} text={block.text} />
    case 'command':
      return <CommandBlock command={block.command} label={block.label} />
    case 'diagram':
      return <SyncDiagram />
    case 'visual':
      return <GuideVisual id={block.id} />
  }
}

export function GuideArticleView({ blocks }: { blocks: GuideBlock[] }): JSX.Element {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  )
}
