import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { GuideView } from '../../components/views/GuideView'
import { ALL_FEATURE_IDS } from '../../types'

const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  writeText.mockReset()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true
  })
})

afterEach(() => {
  vi.useRealTimers()
})

function renderGuide(props: Partial<Parameters<typeof GuideView>[0]> = {}): {
  onNavigate: ReturnType<typeof vi.fn>
} {
  const onNavigate = vi.fn()
  render(<GuideView enabledFeatures={ALL_FEATURE_IDS} onNavigate={onNavigate} {...props} />)
  return { onNavigate }
}

const heading = (): HTMLElement => screen.getByRole('heading', { level: 2 })
const nav = (): HTMLElement => screen.getByRole('navigation', { name: 'Como funciona' })
const search = (): HTMLElement => screen.getByRole('searchbox', { name: 'Buscar no guia' })

describe('GuideView', () => {
  it('opens on the first article of Primeiros passos', () => {
    renderGuide()
    expect(heading()).toHaveTextContent('O que é o Sagyou')
    expect(screen.getAllByText('Primeiros passos').length).toBeGreaterThan(0)
  })

  it('opens the requested article', () => {
    renderGuide({ initialArticleId: 'sync-autenticador' })
    expect(heading()).toHaveTextContent('Cadastrar o autenticador')
  })

  it('falls back to the first article for an unknown id', () => {
    renderGuide({ initialArticleId: 'nao-existe' })
    expect(heading()).toHaveTextContent('O que é o Sagyou')
  })

  it('filters the list while typing, ignoring accents', () => {
    renderGuide()
    fireEvent.change(search(), { target: { value: 'sincronizacao' } })
    expect(
      within(nav()).getByRole('button', { name: 'O que é e o que o servidor vê' })
    ).toBeInTheDocument()
    expect(within(nav()).queryByRole('button', { name: 'Hábitos' })).not.toBeInTheDocument()
  })

  it('shows an empty state with a way back', () => {
    renderGuide()
    fireEvent.change(search(), { target: { value: 'xyzzy' } })
    expect(screen.getByText('Nada encontrado para "xyzzy".')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar busca' }))
    expect(search()).toHaveValue('')
    expect(within(nav()).getByRole('button', { name: 'Hábitos' })).toBeInTheDocument()
  })

  it('clears the search with Escape and keeps the article it found', () => {
    renderGuide()
    fireEvent.change(search(), { target: { value: 'wrangler' } })
    expect(heading()).toHaveTextContent('Criar o servidor na Cloudflare')
    fireEvent.keyDown(search(), { key: 'Escape' })
    expect(search()).toHaveValue('')
    expect(heading()).toHaveTextContent('Criar o servidor na Cloudflare')
    expect(within(nav()).getByRole('button', { name: 'Hábitos' })).toBeInTheDocument()
  })

  it('keeps the found article when the field is erased by hand', () => {
    renderGuide()
    fireEvent.change(search(), { target: { value: 'wrangler' } })
    fireEvent.change(search(), { target: { value: '' } })
    expect(heading()).toHaveTextContent('Criar o servidor na Cloudflare')
  })

  it('copies a command and says so for two seconds', async () => {
    vi.useFakeTimers()
    writeText.mockResolvedValue(undefined)
    renderGuide({ initialArticleId: 'sync-servidor' })
    const [first] = screen.getAllByRole('button', { name: 'Copiar comando' })
    await act(async () => {
      fireEvent.click(first)
    })
    expect(writeText).toHaveBeenCalledWith('npm install')
    expect(first).toHaveTextContent('Copiado')
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(first).toHaveTextContent('Copiar')
  })

  it('says so when copying fails', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    renderGuide({ initialArticleId: 'sync-servidor' })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Copiar comando' })[0])
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível copiar.')
    expect(screen.getAllByRole('button', { name: 'Copiar comando' })[0]).toHaveTextContent('Copiar')
  })

  it('opens the screen an article describes', () => {
    const { onNavigate } = renderGuide({
      initialArticleId: 'metas-habitos',
      enabledFeatures: ['habits']
    })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir esta tela' }))
    expect(onNavigate).toHaveBeenCalledWith({ view: 'habits' })
  })

  it('never leads to a hidden area, and points to where to show it', () => {
    const { onNavigate } = renderGuide({ initialArticleId: 'metas-habitos', enabledFeatures: [] })
    expect(screen.getByRole('button', { name: 'Abrir esta tela' })).toBeDisabled()
    expect(screen.getByText('Esta área está oculta na barra lateral.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar em Configurações' }))
    expect(onNavigate).toHaveBeenCalledWith({ view: 'settings', section: 'barra-lateral' })
  })

  it('opens settings sections even with every area hidden', () => {
    const { onNavigate } = renderGuide({ initialArticleId: 'sync-ativar', enabledFeatures: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir esta tela' }))
    expect(onNavigate).toHaveBeenCalledWith({ view: 'settings', section: 'sincronizacao' })
  })

  it('opens a picked article', () => {
    renderGuide()
    fireEvent.click(within(nav()).getByRole('button', { name: 'Conflitos' }))
    expect(heading()).toHaveTextContent('Conflitos')
  })
})
