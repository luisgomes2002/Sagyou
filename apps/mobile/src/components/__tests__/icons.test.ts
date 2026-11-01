import { FINANCIAL_CATEGORIES } from '@sagyou/core/finance'
import { Dumbbell, GraduationCap, Home, Repeat, Tag, Utensils, Zap } from 'lucide-react-native'
import { ACTION_ICONS, TAB_ICONS, categoryIcon } from '../icons'

describe('ícones do app', () => {
  it('cada aba tem um ícone', () => {
    for (const tab of ['Tarefas', 'Hábitos', 'Finanças', 'Notas', 'Busca'] as const)
      expect(TAB_ICONS[tab]).toBeTruthy()
    expect(ACTION_ICONS.settings).toBeTruthy()
    expect(ACTION_ICONS.add).toBeTruthy()
  })

  it('categorias conhecidas têm ícone próprio', () => {
    expect(categoryIcon('Alimentação')).toBe(Utensils)
    expect(categoryIcon('Aluguel')).toBe(Home)
    expect(categoryIcon('Conta de Luz')).toBe(Zap)
    expect(categoryIcon('Academia')).toBe(Dumbbell)
    expect(categoryIcon('Assinaturas')).toBe(Repeat)
    expect(categoryIcon('Curso')).toBe(GraduationCap)
  })

  it('toda categoria "Conta de …" do core tem ícone próprio', () => {
    for (const c of FINANCIAL_CATEGORIES.filter((c) => c.startsWith('Conta de')))
      expect([c, categoryIcon(c) !== Tag]).toEqual([c, true])
  })

  it('categoria vazia ou desconhecida usa a etiqueta', () => {
    expect(categoryIcon(undefined)).toBe(Tag)
    expect(categoryIcon('')).toBe(Tag)
    expect(categoryIcon('Categoria Inventada')).toBe(Tag)
  })
})
