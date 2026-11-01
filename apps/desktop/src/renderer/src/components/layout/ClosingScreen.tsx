import type { ReactElement } from 'react'

export function ClosingScreen({ error }: { error: boolean }): ReactElement {
  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-5 bg-[#0b0b0f] text-[#d4d4d4]"
      role={error ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div
        aria-hidden="true"
        className="h-9 w-9 rounded-full border-2 border-[#a080f0] border-t-transparent animate-spin motion-reduce:animate-none"
      />
      <p className="text-sm font-medium">
        {error ? 'Não foi possível salvar os dados. Aguarde o fechamento.' : 'Fechando Sagyou…'}
      </p>
    </div>
  )
}
