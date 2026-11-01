// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  previousTag,
  pullRequestOf,
  renderNotes,
  tagInfo,
  touchesApp
} from '../../../scripts/release-notes.mjs'

// Desktop and Android releases come from one repository: each one's notes
// must list only the pull requests that changed that app.
describe('notas de release por app', () => {
  it('reconhece as tags de cada app', () => {
    expect(tagInfo('v1.1.0')).toEqual({ app: 'desktop', version: [1, 1, 0] })
    expect(tagInfo('mobile-v0.2.10')).toEqual({ app: 'mobile', version: [0, 2, 10] })
    expect(tagInfo('v1.1')).toBeNull()
    expect(tagInfo('mobile-1.0.0')).toBeNull()
  })

  it('compara com a versão anterior do mesmo app, ignorando tags maiores e as do outro', () => {
    const tags = ['v1.0.0', 'v1.3.0', 'v1.5.1', 'mobile-v0.0.1', 'mobile-v0.1.0', 'v0.9.0']
    expect(previousTag(tags, 'v1.1.0')).toBe('v1.0.0')
    expect(previousTag(tags, 'mobile-v0.1.1')).toBe('mobile-v0.1.0')
    expect(previousTag(tags, 'mobile-v0.0.1')).toBeNull()
    expect(previousTag(['v1.0.0', 'v1.0.10', 'v1.0.9'], 'v1.1.0')).toBe('v1.0.10')
  })

  it('separa o que é de cada app; o core conta para os dois', () => {
    expect(touchesApp(['apps/mobile/src/App.tsx'], 'desktop')).toBe(false)
    expect(touchesApp(['apps/mobile/src/App.tsx'], 'mobile')).toBe(true)
    expect(touchesApp(['apps/desktop/src/main/index.ts'], 'mobile')).toBe(false)
    expect(touchesApp(['packages/core/src/money.ts'], 'desktop')).toBe(true)
    expect(touchesApp(['packages/core/src/money.ts'], 'mobile')).toBe(true)
    expect(touchesApp(['docs/workflow.md', 'sync-server/src/routes.ts'], 'desktop')).toBe(false)
  })

  it('lê o pull request do merge ou do squash', () => {
    expect(
      pullRequestOf(
        'Merge pull request #36 from luisgomes2002/feature/motor-bandeja',
        'feat(desktop): motor na bandeja\n'
      )
    ).toEqual({ number: 36, title: 'feat(desktop): motor na bandeja' })
    expect(pullRequestOf('fix(mobile): data no fuso (#40)', '')).toEqual({
      number: 40,
      title: 'fix(mobile): data no fuso'
    })
    expect(pullRequestOf('docs: ajuste', '')).toBeNull()
  })

  it('deixa o lembrete de descrever as mudanças e a comparação', () => {
    const notes = renderNotes({
      app: 'desktop',
      tag: 'v1.1.0',
      previous: 'v1.0.0',
      repo: 'luisgomes2002/Sagyou',
      prs: [{ number: 36, title: 'feat(desktop): motor na bandeja' }]
    })
    expect(notes).toContain('**Antes de publicar:**')
    expect(notes).toContain('app desktop')
    expect(notes).toContain('- feat(desktop): motor na bandeja (#36)')
    expect(notes).toContain('https://github.com/luisgomes2002/Sagyou/compare/v1.0.0...v1.1.0')
    expect(notes).not.toContain('Latest')

    const mobile = renderNotes({
      app: 'mobile',
      tag: 'mobile-v0.0.1',
      previous: null,
      repo: 'luisgomes2002/Sagyou',
      prs: []
    })
    expect(mobile).toContain('app Android')
    expect(mobile).toContain('Nenhum pull request mexeu no app Android')
    expect(mobile).toContain('o Latest é do desktop')
    expect(mobile).toContain('**Primeira versão deste app.**')
  })
})
