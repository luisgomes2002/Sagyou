import type { JSX } from 'react'
import { EXAMPLE_LABEL, exampleA11yLabel } from '@sagyou/core/sync/guide'
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

type KeyExampleBlock = Extract<GuideBlock, { type: 'keyExample' }>
type TableBlock = Extract<GuideBlock, { type: 'table' }>

/** A sync key with a fake value: marked as an example and never copyable. */
function KeyExample({ block }: { block: KeyExampleBlock }): JSX.Element {
  return (
    <section
      aria-label={block.name}
      className="space-y-3 rounded-lg border border-[#2b2b31] bg-[#16161a] p-4"
    >
      <h3 className="text-sm font-medium text-[#d4d4d4]">{block.name}</h3>
      <div
        role="group"
        aria-label={exampleA11yLabel(block.name)}
        className="flex items-start gap-3 rounded-lg border border-dashed border-[#2b2b31] bg-[#101014] p-3"
      >
        <span className="shrink-0 rounded bg-[#2a2a30] px-2 py-0.5 text-[11px] font-semibold text-[#d9a640]">
          {EXAMPLE_LABEL}
        </span>
        <code className="min-w-0 whitespace-pre-wrap break-all font-mono text-xs text-[#999999]">
          {block.example}
        </code>
      </div>
      <dl className="space-y-2">
        {block.lines.map((line) => (
          <div key={line.label}>
            <dt className="text-xs text-[#999999]">{line.label}</dt>
            <dd className="text-sm leading-6 text-[#d4d4d4]">{line.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function GuideTable({ block }: { block: TableBlock }): JSX.Element {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr>
          {block.head.map((cell) => (
            <th
              key={cell}
              scope="col"
              className="border-b border-[#2b2b31] py-2 pr-4 font-medium text-[#999999]"
            >
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {block.rows.map(([lost, use]) => (
          <tr key={lost}>
            <td className="border-b border-[#2b2b31] py-2 pr-4 align-top text-[#d4d4d4]">{lost}</td>
            <td className="border-b border-[#2b2b31] py-2 align-top leading-6 text-[#d4d4d4]">
              {use}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
    case 'keyExample':
      return <KeyExample block={block} />
    case 'table':
      return <GuideTable block={block} />
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
