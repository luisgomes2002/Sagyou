import { memo } from 'react'
import type { ChatMessage } from '../../store/aiRun'
import { formatTokens, type StatusState } from '../../utils/aiDisplay'
import { ChatMarkdown } from './ChatMarkdown'

/** Memoized so streaming one turn does not redraw the whole transcript. */
export const MessageBubble = memo(function MessageBubble({
  m,
  index,
  imageData,
  onCopy,
  onEdit,
  onFeedback
}: {
  m: ChatMessage
  index: number
  imageData: Record<string, string>
  onCopy: () => void
  onEdit?: () => void
  onFeedback?: (feedback: 'positive' | 'negative') => void
}) {
  return (
    <div key={index} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`px-3.5 py-2 rounded-2xl text-sm break-words ${
          m.role === 'user'
            ? 'max-w-[75%] whitespace-pre-wrap bg-[#7c3aed] text-white rounded-br-sm'
            : 'max-w-[88%] bg-[#16161a] text-[#d4d4d4] border border-[#2b2b31] rounded-bl-sm'
        }`}
      >
        {(m.imageIds ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {(m.imageIds ?? []).map((id) =>
              imageData[id] ? (
                <img
                  key={id}
                  src={imageData[id]}
                  alt="Imagem enviada"
                  className="max-h-40 rounded-md border border-white/10"
                />
              ) : (
                <span key={id} className="text-[10px] italic opacity-60">
                  [imagem indisponível]
                </span>
              )
            )}
          </div>
        )}
        {m.role === 'user' ? m.content : <ChatMarkdown content={m.content} />}
        <div className="flex items-center gap-3 mt-2 text-[11px] opacity-70">
          <button
            type="button"
            onClick={onCopy}
            className="hover:opacity-100"
            title="Copiar mensagem"
          >
            Copiar
          </button>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="hover:opacity-100"
              title="Editar e reenviar"
            >
              Editar
            </button>
          )}
          {onFeedback && (
            <>
              <button
                type="button"
                onClick={() => onFeedback('positive')}
                aria-label="Resposta útil"
                aria-pressed={m.feedback === 'positive'}
                className={m.feedback === 'positive' ? 'text-[#46d478]' : 'hover:opacity-100'}
              >
                Útil
              </button>
              <button
                type="button"
                onClick={() => onFeedback('negative')}
                aria-label="Resposta ruim"
                aria-pressed={m.feedback === 'negative'}
                className={m.feedback === 'negative' ? 'text-[#f08a34]' : 'hover:opacity-100'}
              >
                Ruim
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
})

/** Tool progress remains inline instead of appearing as a chat message. */
export const MemoStatusLine = memo(function StatusLine({
  text,
  state,
  step,
  maxSteps,
  tokens
}: {
  text: string
  state: StatusState
  step?: number
  maxSteps?: number
  tokens?: number
}): React.JSX.Element {
  // Both or neither: "3/" without a denominator hides the remaining budget.
  const badge = step !== undefined && maxSteps !== undefined ? `${step}/${maxSteps}` : null
  return (
    <div
      className={`flex items-start gap-2 px-1 ${
        state === 'running' ? 'text-[#a080f0]' : 'text-[#999999]'
      }`}
    >
      {state === 'running' ? (
        <span className="mt-[3px] w-2.5 h-2.5 shrink-0 rounded-full border-[1.5px] border-[#a080f0] border-t-transparent animate-spin" />
      ) : state === 'done' ? (
        <svg
          className="mt-[2px] shrink-0 text-[#46d478]"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <span className="mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 bg-[#555555]" />
      )}
      {badge && (
        <span
          title={`Passo ${step} de ${maxSteps} desta execução`}
          className="mt-[1px] shrink-0 px-1.5 py-[1px] rounded text-[10px] font-medium tabular-nums bg-[#16161a] border border-[#2b2b31] text-[#999999]"
        >
          {badge}
        </span>
      )}
      {tokens !== undefined && tokens > 0 && (
        <span
          title="tokens desta chamada do modelo (prompt + resposta). Cresce a cada passo porque o histórico é reenviado."
          className="mt-[1px] shrink-0 px-1.5 py-[1px] rounded text-[10px] font-medium tabular-nums bg-[#16161a] border border-[#2b2b31] text-[#999999]"
        >
          {formatTokens(tokens)} tokens
        </span>
      )}
      <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">{text}</p>
    </div>
  )
})
