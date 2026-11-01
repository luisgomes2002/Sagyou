import * as LocalAuthentication from 'expo-local-authentication'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, StyleSheet, Text, View } from 'react-native'
import { AppMark } from '../components/AppMark'
import { ACTION_ICONS } from '../components/icons'
import { Button } from '../components/ui'
import { FONT, SPACE, useTheme } from '../theme'
import { LOCKED_TITLE, LOCK_AFTER_MS, NO_DEVICE_LOCK_TEXT, UNLOCK_PROMPT } from './texts'

export interface LockDeps {
  getEnrolledLevelAsync: () => Promise<number>
  authenticateAsync: (options: { promptMessage: string }) => Promise<{ success: boolean }>
  appState: {
    addEventListener(type: 'change', listener: (state: string) => void): { remove(): void }
  }
  now: () => number
}

const defaultDeps: LockDeps = {
  getEnrolledLevelAsync: LocalAuthentication.getEnrolledLevelAsync,
  authenticateAsync: LocalAuthentication.authenticateAsync,
  appState: AppState,
  now: Date.now
}

type Lock = 'checking' | 'no-device-lock' | 'locked' | 'open'

/**
 * Nothing of the app renders until the person unlocks: biometrics, with the
 * Android screen lock (PIN, pattern or password) as the alternative. It locks
 * again when the app comes back after 5 minutes or more in the background.
 * A phone without any screen lock never shows the data.
 */
export function LockGate({
  children,
  deps = defaultDeps
}: {
  children: ReactNode
  deps?: LockDeps
}): React.JSX.Element {
  const theme = useTheme()
  const [lock, setLock] = useState<Lock>('checking')
  const backgroundAt = useRef<number | null>(null)
  const prompting = useRef(false)
  const [everOpened, setEverOpened] = useState(false)

  const unlock = useCallback(async (): Promise<void> => {
    if (prompting.current) return
    prompting.current = true
    try {
      const level = await deps.getEnrolledLevelAsync()
      if (level === LocalAuthentication.SecurityLevel.NONE) {
        setLock('no-device-lock')
        return
      }
      setLock('locked')
      const result = await deps.authenticateAsync({ promptMessage: UNLOCK_PROMPT })
      if (result.success) {
        setLock('open')
        setEverOpened(true)
      }
    } catch {
      setLock('locked')
    } finally {
      prompting.current = false
    }
  }, [deps])

  useEffect(() => {
    // Asked right after the first paint (never during the effect itself).
    const first = setTimeout(() => void unlock(), 0)
    const sub = deps.appState.addEventListener('change', (state) => {
      if (state === 'background') backgroundAt.current = deps.now()
      else if (state === 'active' && backgroundAt.current !== null) {
        const away = deps.now() - backgroundAt.current
        backgroundAt.current = null
        if (away >= LOCK_AFTER_MS) {
          setLock('locked')
          void unlock()
        }
      }
    })
    return () => {
      clearTimeout(first)
      sub.remove()
    }
  }, [deps, unlock])

  const covered = lock !== 'open'
  return (
    <View style={styles.fill}>
      {/* Never mounted before the first unlock; afterwards it stays mounted
          (a form in progress survives a re-lock) but hidden from screen readers. */}
      {everOpened ? (
        <View
          style={styles.fill}
          importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={covered}
        >
          {children}
        </View>
      ) : null}
      {covered ? (
        <View style={[styles.cover, { backgroundColor: theme.bg }]}>
          {lock === 'no-device-lock' ? (
            <>
              <Text accessibilityRole="alert" style={[styles.text, { color: theme.text }]}>
                {NO_DEVICE_LOCK_TEXT}
              </Text>
              <Button label="Tentar de novo" onPress={() => void unlock()} />
            </>
          ) : (
            <>
              <AppMark size={88} />
              <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
                {lock === 'locked' ? LOCKED_TITLE : 'Sagyou'}
              </Text>
              {lock === 'locked' ? (
                <View style={styles.action}>
                  <Button
                    variant="primary"
                    label="Desbloquear"
                    icon={ACTION_ICONS.readOnly}
                    onPress={() => void unlock()}
                  />
                </View>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16
  },
  title: { fontSize: FONT.title, fontWeight: '700' },
  text: { fontSize: FONT.bodyLg, textAlign: 'center' },
  action: { alignSelf: 'stretch', marginTop: SPACE.sm }
})
