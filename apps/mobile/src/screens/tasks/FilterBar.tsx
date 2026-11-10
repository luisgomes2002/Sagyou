import type { Task } from '@sagyou/core/types'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { BottomSheet, Chip } from '../../components/ui'
import { useApp } from '../../store/app'
import {
  filterChipLabel,
  priorityOptions,
  sprintOptions,
  tagOptions,
  type FilterKind,
  type FilterOption,
  type TaskFilter
} from '../../store/taskFilters'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../../theme'

const SHEET_TITLES: Record<FilterKind, string> = {
  sprint: 'Sprint',
  priority: 'Prioridade',
  tag: 'Tag'
}

/**
 * The Tarefas filter chips ("Sprint: Sprint 2", "Prioridade: Todas", "Tag: …").
 * Each chip opens a sheet with its options as radios; picking one closes it.
 */
export function FilterBar({
  filter,
  onChange,
  kinds,
  scope
}: {
  filter: TaskFilter
  onChange: (next: TaskFilter) => void
  kinds: readonly FilterKind[]
  scope: { projectId: string | null; tasks: Task[] }
}): React.JSX.Element {
  const theme = useTheme()
  const state = useApp((s) => s.state)
  const [open, setOpen] = useState<FilterKind | null>(null)

  const optionsOf = (kind: FilterKind): FilterOption[] =>
    kind === 'sprint'
      ? scope.projectId
        ? sprintOptions(state, scope.projectId)
        : []
      : kind === 'priority'
        ? priorityOptions()
        : tagOptions(scope.tasks)
  const pick = (kind: FilterKind, value: string): void => {
    onChange({ ...filter, [kind]: value } as TaskFilter)
    setOpen(null)
  }

  return (
    <View style={styles.bar}>
      {kinds.map((kind) => (
        <Chip
          key={kind}
          label={filterChipLabel(kind, filter, state)}
          selected={filter[kind] !== 'all'}
          onPress={() => setOpen(kind)}
        />
      ))}
      <BottomSheet
        visible={open !== null}
        onClose={() => setOpen(null)}
        title={open ? SHEET_TITLES[open] : undefined}
      >
        {open
          ? optionsOf(open).map((option) => {
              const checked = filter[open] === option.value
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked }}
                  onPress={() => pick(open, option.value)}
                  style={[
                    styles.option,
                    {
                      backgroundColor: checked ? theme.selected : theme.surface,
                      borderColor: checked ? theme.primary : theme.border
                    }
                  ]}
                >
                  {/* The pick is shown by shape too, not only by colour. */}
                  <View
                    testID={checked ? 'radio-on' : 'radio-off'}
                    style={[styles.ring, { borderColor: checked ? theme.primary : theme.muted }]}
                  >
                    {checked ? (
                      <View style={[styles.dot, { backgroundColor: theme.primary }]} />
                    ) : null}
                  </View>
                  <Text style={[styles.optionText, { color: theme.text }]}>{option.label}</Text>
                </Pressable>
              )
            })
          : null}
      </BottomSheet>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  option: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingHorizontal: SPACE.md,
    borderWidth: 1,
    borderRadius: RADIUS.control,
    marginBottom: SPACE.sm
  },
  optionText: { fontSize: FONT.body, flexShrink: 1 },
  ring: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dot: { width: 10, height: 10, borderRadius: 5 }
})
