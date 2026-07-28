import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Module scope on purpose — these must keep their identity across renders.
 * Rebuilt inline, each render hands react-markdown a fresh set of component
 * *types*, which React can only treat as different components: it unmounts the
 * whole subtree and builds new DOM for it. On a streaming answer that is every
 * chunk, and it takes the user's text selection with it each time.
 */
const COMPONENTS: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  p: ({ children }) => <p className="whitespace-pre-wrap break-words">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="break-words">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} className="text-[#a080f0] underline break-all">
      {children}
    </a>
  ),
  h1: ({ children }) => <h1 className="text-base font-semibold text-white mt-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-semibold text-white mt-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-[#d4d4d4] mt-1">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-[#555555] pl-3 text-[#999999]">{children}</blockquote>
  ),
  hr: () => <hr className="border-[#3b3b3b]" />,
  code: ({ className, children }) =>
    className ? (
      <code className={`${className} font-mono text-[0.85em]`}>{children}</code>
    ) : (
      <code className="px-1 py-0.5 rounded bg-[#1b1b1b] text-[#a080f0] font-mono text-[0.85em]">
        {children}
      </code>
    ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto p-3 rounded-lg bg-[#1b1b1b] border border-[#3b3b3b]">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-[#3b3b3b] px-2 py-1 text-left font-semibold bg-[#1b1b1b]">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-[#3b3b3b] px-2 py-1 align-top">{children}</td>
}

/** Likewise: a new array here would re-run the plugin pipeline every render. */
const REMARK_PLUGINS = [remarkGfm]

/**
 * Renders an assistant message as Markdown (GFM: bold, italic, lists, tables,
 * code, headings), themed for the dark chat bubble. Raw HTML is not rendered
 * (react-markdown's safe default), so model output can't inject markup.
 */
export function ChatMarkdown({ content }: { content: string }): React.JSX.Element {
  return (
    <div className="space-y-2 leading-relaxed">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
