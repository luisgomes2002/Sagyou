import type { ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { FONT, RADIUS, SPACE, useTheme } from '../theme'

/**
 * A panel that slides up from the bottom over a dimmed scrim (functional
 * transparency, allowed by UI_DESIGN.md). Android's back button closes it.
 * `full` makes it take the whole height (forms).
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  full,
  animated
}: {
  visible: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  full?: boolean
  /** Forces the slide on or off; by default it follows "Remover animações". */
  animated?: boolean
}): React.JSX.Element {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const slide = animated ?? !reduced
  return (
    <Modal
      testID="bottom-sheet"
      visible={visible}
      transparent
      animationType={slide ? 'slide' : 'none'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {visible ? (
        <KeyboardAvoidingView behavior="height" style={styles.root}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={onClose}
            style={[styles.scrim, { backgroundColor: '#000000' }]}
          />
          <View
            style={[
              styles.panel,
              full && { flex: 1, marginTop: insets.top + SPACE.xl },
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                paddingBottom: insets.bottom + SPACE.lg
              }
            ]}
          >
            <View style={[styles.handle, { backgroundColor: theme.border }]} />
            {title ? (
              <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
                {title}
              </Text>
            ) : null}
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      ) : null}
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.5 },
  panel: {
    borderTopLeftRadius: RADIUS.card,
    borderTopRightRadius: RADIUS.card,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.sm,
    maxHeight: '90%',
    elevation: 8
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: SPACE.md },
  title: { fontSize: FONT.title, fontWeight: '600', marginBottom: SPACE.md },
  content: { gap: SPACE.md, paddingBottom: SPACE.sm }
})
