import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react'
import type { ConflictChoice, SyncConflictView } from '@sagyou/core/sync/engine'
import {
  CONFLICT_TEXTS,
  compareConflict,
  conflictSummary,
  currentHlcOf,
  type FieldRow,
  type FieldValue,
  type NameLookup,
  type Side
} from '@sagyou/core/sync/conflict-view'
import { recordName, syncKindLabel, versionTimeText } from '@sagyou/core/sync/view'

interface Props {
  conflict: SyncConflictView
  names: NameLookup
  busy: boolean
  onResolve: (choice: ConflictChoice) => void
}

const SIDES: readonly Side[] = ['local', 'remote']
const primaryClass =
  'rounded-lg bg-[#6d5bb8] px-3 py-2 text-sm text-white hover:bg-[#7b69c6] disabled:opacity-50'
const secondaryClass =
  'rounded-lg bg-[#2a2a30] px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#303036] disabled:opacity-50'
const cardClass = 'rounded-lg border border-[#2b2b31] bg-[#101014]'
const labelClass = 'text-xs text-[#999999]'

function deviceOf(conflict: SyncConflictView, side: Side): string {
  return side === 'local' ? CONFLICT_TEXTS.thisDevice : conflict.remote.deviceName
}

function Value({ value }: { value: FieldValue }): JSX.Element {
  if (!value.segments) return <span className="whitespace-pre-wrap break-words">{value.text}</span>
  return (
    <span className="whitespace-pre-wrap break-words">
      <span className="sr-only">{CONFLICT_TEXTS.diffHint}: </span>
      {value.segments.map((segment, i) =>
        segment.changed ? (
          <mark key={i} className="rounded-sm bg-[#2a2a30] text-[#d9a640] underline">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </span>
  )
}

function OnlyIn({
  row,
  side,
  device
}: {
  row: FieldRow
  side: Side
  device: string
}): JSX.Element | null {
  const other: Side = side === 'local' ? 'remote' : 'local'
  if (!row[side].present || row[other].present) return null
  return <span className="ml-2 text-xs text-[#d9a640]">{CONFLICT_TEXTS.onlyIn(device)}</span>
}

/**
 * One sync conflict on the Sincronização screen: a summary that opens the
 * field-by-field comparison (spec 2026-11-10). The choice goes up through
 * `onResolve`; the comparison itself comes from the core.
 */
export function SyncConflictCard({ conflict, names, busy, onResolve }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [showEqual, setShowEqual] = useState(false)
  const regionId = useId()
  const region = useRef<HTMLDivElement>(null)
  const cmp = useMemo(() => compareConflict(conflict, names), [conflict, names])
  // A new reading of the conflict (another version arrived) starts the pick over.
  const signature = `${conflict.local.hlc}|${conflict.remote.hlc}`
  const [pick, setPick] = useState({ signature, fields: cmp.initial })
  const picked = pick.signature === signature ? pick.fields : cmp.initial

  useEffect(() => {
    if (open) region.current?.focus()
  }, [open])

  const name = recordName(conflict.remote.payload) ?? recordName(conflict.local.payload)
  const title = `${syncKindLabel(conflict.kind)}${name ? `: ${name}` : ''}`

  if (conflict.type === 'orphan')
    return (
      <div className={`${cardClass} space-y-3 p-4`}>
        <p className="break-words text-sm text-[#d4d4d4]">{title}</p>
        <p className="text-sm text-[#d9a640]">
          Removido: o item de origem foi apagado em outro aparelho
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve('local')}
          className={secondaryClass}
        >
          Dispensar
        </button>
      </div>
    )

  const choose = (field: string, side: Side): void =>
    setPick({ signature, fields: { ...picked, [field]: side } })
  const allFrom = (side: Side): ConflictChoice => ({
    fields: Object.fromEntries(cmp.differing.map((row) => [row.field, side])),
    expectedHlc: currentHlcOf(conflict)
  })
  const save = (): void => onResolve({ fields: picked, expectedHlc: currentHlcOf(conflict) })

  return (
    <div className={cardClass}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-lg p-4 text-left hover:bg-[#16161a]"
      >
        <span className="block break-words text-sm text-[#d4d4d4]">{title}</span>
        <span className={`block ${labelClass}`}>{conflictSummary(conflict, cmp)}</span>
      </button>

      {open && (
        <div
          id={regionId}
          ref={region}
          tabIndex={-1}
          aria-label={title}
          className="space-y-4 border-t border-[#2b2b31] p-4 outline-none"
        >
          <p className={labelClass}>{CONFLICT_TEXTS.explain}</p>

          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {SIDES.map((side) => (
              <p key={side} className="text-xs text-[#d4d4d4]">
                {deviceOf(conflict, side)} · {versionTimeText(conflict[side].at)}
                {cmp.newer === side && (
                  <span className="ml-2 rounded bg-[#2a2a30] px-1.5 py-0.5 text-[#a080f0]">
                    {CONFLICT_TEXTS.newer}
                  </span>
                )}
                {(conflict[side].deleted || !conflict[side].payload) && (
                  <span className="ml-2 text-[#ec6a6a]">{CONFLICT_TEXTS.deleted}</span>
                )}
              </p>
            ))}
          </div>

          {cmp.differing.map((row) =>
            cmp.choosable ? (
              <div key={row.field} role="radiogroup" aria-label={row.label} className="space-y-2">
                <p className="text-sm text-[#d4d4d4]">{row.label}</p>
                {SIDES.map((side) => {
                  const device = deviceOf(conflict, side)
                  return (
                    <label
                      key={side}
                      className="flex min-w-0 cursor-pointer gap-3 rounded-lg border border-[#2b2b31] bg-[#16161a] p-3 hover:bg-[#222227]"
                    >
                      <input
                        type="radio"
                        name={`${conflict.id}-${row.field}`}
                        checked={picked[row.field] === side}
                        onChange={() => choose(row.field, side)}
                        disabled={busy}
                        className="mt-1 accent-[#6d5bb8]"
                      />
                      <span className="min-w-0 flex-1 space-y-1 text-sm text-[#d4d4d4]">
                        <span className={`block ${labelClass}`}>
                          {device}
                          <OnlyIn row={row} side={side} device={device} />
                        </span>
                        <Value value={row[side]} />
                      </span>
                    </label>
                  )
                })}
                {row.field === 'timeSpent' && cmp.timeNote && (
                  <p className="text-xs text-[#d9a640]">{CONFLICT_TEXTS.timeNote}</p>
                )}
              </div>
            ) : (
              <div key={row.field} className="space-y-2">
                <p className="text-sm text-[#d4d4d4]">{row.label}</p>
                {SIDES.map((side) => (
                  <div
                    key={side}
                    className="min-w-0 space-y-1 rounded-lg border border-[#2b2b31] bg-[#16161a] p-3 text-sm text-[#d4d4d4]"
                  >
                    <span className={`block ${labelClass}`}>{deviceOf(conflict, side)}</span>
                    <Value value={row[side]} />
                  </div>
                ))}
              </div>
            )
          )}

          {cmp.equal.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                aria-expanded={showEqual}
                onClick={() => setShowEqual((v) => !v)}
                className="text-sm text-[#999999] hover:text-[#d4d4d4]"
              >
                {CONFLICT_TEXTS.equalSection(cmp.equal.length)}
              </button>
              {showEqual && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {cmp.equal.map((row) => (
                    <div key={row.field} className="contents">
                      <dt className="text-[#999999]">{row.label}</dt>
                      <dd className="min-w-0 whitespace-pre-wrap break-words text-[#d4d4d4]">
                        {row.local.text}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {cmp.choosable ? (
              <>
                <button type="button" disabled={busy} onClick={save} className={primaryClass}>
                  {CONFLICT_TEXTS.save}
                </button>
                {cmp.newer && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onResolve(allFrom(cmp.newer as Side))}
                    className={secondaryClass}
                  >
                    {CONFLICT_TEXTS.keepNewer}
                  </button>
                )}
                {cmp.newer !== 'local' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onResolve(allFrom('local'))}
                    className={secondaryClass}
                  >
                    {CONFLICT_TEXTS.keepThis}
                  </button>
                )}
                {cmp.newer !== 'remote' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onResolve(allFrom('remote'))}
                    className={secondaryClass}
                  >
                    {CONFLICT_TEXTS.keepOther(conflict.remote.deviceName)}
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onResolve('local')}
                  className={secondaryClass}
                >
                  {CONFLICT_TEXTS.pickThis}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onResolve('remote')}
                  className={secondaryClass}
                >
                  {CONFLICT_TEXTS.pickOther(conflict.remote.deviceName)}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
