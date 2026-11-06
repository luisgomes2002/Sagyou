import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  createNavigationContainerRef,
  type NavigatorScreenParams,
  useIsFocused,
  useNavigation
} from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import * as Notifications from 'expo-notifications'
import { createContext, useContext, useEffect, useState, type ComponentType } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { bootstrap } from './bootstrap'
import { AppMark } from './components/AppMark'
import { QuickCreate } from './components/QuickCreate'
import { StatusBanner } from './components/StatusBanner'
import { UpdateBanner } from './components/UpdateBanner'
import { TabIcon } from './components/TabIcon'
import { ACTION_ICONS, type TabLabel } from './components/icons'
import { useLockState } from './lock/lockState'
import { notificationTarget, registerPush } from './remote/push'
import { useRemote } from './remote/store'
import { PcScreen } from './screens/PcScreen'
import { Fab, Snackbar } from './components/ui'
import { useEditing } from './store/editing'
import { useUndo } from './store/undo'
import { MIN_TOUCH, SPACE } from './theme'
import { LockGate } from './lock/LockGate'
import { useAutoUpdateCheck } from './update/useAutoUpdateCheck'
import { FinanceScreen } from './screens/FinanceScreen'
import { HabitsScreen } from './screens/HabitsScreen'
import { NotesScreen } from './screens/NotesScreen'
import { PairScreen } from './screens/PairScreen'
import { SearchScreen } from './screens/SearchScreen'
import type { SearchHit } from './data/search'
import { Placeholder } from './screens/Placeholder'
import { ConflictsScreen } from './screens/ConflictsScreen'
import { PAIR_DEVICE_TITLE, PairDeviceScreen } from './screens/PairDeviceScreen'
import { CONTROL_TITLE, ControlSetupScreen } from './screens/ControlSetupScreen'
import { SyncGuideScreen } from './screens/SyncGuideScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TasksStack } from './screens/tasks/TasksStack'
import { useApp, type AppMode } from './store/app'
import { useTheme, type Theme } from './theme'

export const TAB_LABELS = ['Tarefas', 'Hábitos', 'Finanças', 'Notas', 'Busca'] as const

/** Opens a search hit in its tab (tasks and projects go straight to the record). */
function SearchTab(): React.JSX.Element {
  const navigation = useNavigation() as unknown as {
    navigate(name: string, params?: object): void
  }
  const open = (hit: SearchHit): void => {
    if (hit.kind === 'task' && hit.parentId)
      navigation.navigate('Tarefas', {
        screen: 'Tarefa',
        params: { projectId: hit.parentId, taskId: hit.id }
      })
    else if (hit.kind === 'project')
      navigation.navigate('Tarefas', { screen: 'Projeto', params: { projectId: hit.id } })
    else if (hit.kind === 'note') navigation.navigate('Notas')
    else if (hit.kind === 'habit') navigation.navigate('Hábitos')
    else navigation.navigate('Finanças')
  }
  return <SearchScreen onOpen={open} />
}

/** The PC tab asks the Worker only while it is on screen and the app is unlocked. */
function PcTab(): React.JSX.Element {
  const focused = useIsFocused()
  const hidden = useLockState((s) => s.hidden)
  return <PcScreen focused={focused && !hidden} />
}

/** Each tab's content; a tab without one shows a placeholder until its task lands. */
const TAB_SCREENS: Partial<Record<TabLabel, ComponentType>> = {
  Tarefas: TasksStack,
  Hábitos: HabitsScreen,
  Finanças: FinanceScreen,
  Notas: NotesScreen,
  Busca: SearchTab,
  PC: PcTab
}

export type RootStackParams = {
  Abas: NavigatorScreenParams<Record<TabLabel, undefined>> | undefined
  Ajustes: undefined
  Conflitos: undefined
  ComoFunciona: undefined
  ParearAparelho: undefined
  ControlarPC: undefined
}

const Tabs = createBottomTabNavigator()
const Stack = createNativeStackNavigator<RootStackParams>()
const navigationRef = createNavigationContainerRef<RootStackParams>()

function navigationTheme(theme: Theme): typeof DefaultTheme {
  const base = theme.dark ? DarkTheme : DefaultTheme
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: theme.purple,
      background: theme.bg,
      card: theme.surface,
      text: theme.text,
      border: theme.border,
      notification: theme.red
    }
  }
}

/** Tabs where the (+) shows; in Busca the keyboard owns the bottom of the screen. */
const FAB_TABS: ReadonlySet<string> = new Set(['Tarefas', 'Hábitos', 'Finanças', 'Notas'])

const OpenCreate = createContext<() => void>(() => undefined)

/** The bottom notice ("Tarefa concluída · Desfazer") shared by every tab. */
function UndoBar(): React.JSX.Element {
  const message = useUndo((s) => s.message)
  const canUndo = useUndo((s) => s.canUndo)
  const run = useUndo((s) => s.run)
  return (
    <Snackbar
      visible={!!message}
      message={message}
      actionLabel={canUndo ? 'Desfazer' : undefined}
      onAction={canUndo ? run : undefined}
    />
  )
}

/** One tab's page: status line on top, content, then the (+) and the notice over it. */
function TabPage({ label }: { label: TabLabel }): React.JSX.Element {
  const Content = TAB_SCREENS[label]
  const openCreate = useContext(OpenCreate)
  const readOnly = useApp((s) => s.readOnly)
  const notice = useUndo((s) => s.message)
  const editing = useEditing((s) => s.count > 0)
  return (
    <View style={styles.page}>
      <StatusBanner />
      <UpdateBanner />
      <View style={styles.page}>{Content ? <Content /> : <Placeholder title={label} />}</View>
      <View pointerEvents="box-none" style={styles.overlay}>
        {FAB_TABS.has(label) && !editing ? (
          <View style={styles.fab}>
            <Fab a11yLabel="Criar" onPress={openCreate} disabled={readOnly} />
          </View>
        ) : null}
        {notice ? (
          <View style={styles.notice}>
            <UndoBar />
          </View>
        ) : null}
      </View>
    </View>
  )
}

function TabsScreen({
  navigation
}: {
  navigation: {
    navigate(route: 'Ajustes'): void
    navigate(route: 'Abas', params: object): void
  }
}): React.JSX.Element {
  const theme = useTheme()
  const [creating, setCreating] = useState(false)
  const Gear = ACTION_ICONS.settings
  // The PC tab exists only on an authorized phone that may still send (not read-only).
  const authorized = useRemote((s) => s.authorized)
  const readOnly = useApp((s) => s.readOnly)
  const labels: readonly TabLabel[] =
    authorized === 'yes' && !readOnly ? [...TAB_LABELS, 'PC'] : TAB_LABELS
  return (
    <OpenCreate.Provider value={() => setCreating(true)}>
      <Tabs.Navigator
        screenOptions={({ route }) => ({
          tabBarActiveTintColor: theme.purple,
          tabBarInactiveTintColor: theme.muted,
          tabBarActiveBackgroundColor: theme.selected,
          tabBarItemStyle: { borderRadius: 999, marginHorizontal: 4, marginVertical: 4 },
          tabBarAccessibilityLabel: route.name,
          tabBarButtonTestID: `tab-${route.name}`,
          tabBarIcon: ({ color }) => <TabIcon label={route.name as TabLabel} color={color} />,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ajustes"
              onPress={() => navigation.navigate('Ajustes')}
              style={styles.gear}
            >
              <Gear size={22} color={theme.onSurfaceIcon} />
            </Pressable>
          )
        })}
      >
        {labels.map((label) => (
          <Tabs.Screen key={label} name={label}>
            {() => <TabPage label={label} />}
          </Tabs.Screen>
        ))}
      </Tabs.Navigator>
      <QuickCreate
        visible={creating}
        onClose={() => setCreating(false)}
        onMoreFields={(projectId, draftTitle) =>
          navigation.navigate('Abas', {
            screen: 'Tarefas',
            params: { screen: 'Tarefa', params: { projectId, draftTitle } }
          })
        }
      />
    </OpenCreate.Provider>
  )
}

/** What is on screen for each mode; no tab exists before the phone is paired. */
/** Looks for a newer APK once the app is in use (read-only too), never before pairing. */
function AutoUpdateCheck(): null {
  useAutoUpdateCheck()
  return null
}

/**
 * Notifications of the remote control: on an authorized phone, hands the FCM
 * token to the Worker once per launch; a tapped notification opens the PC tab.
 */
function PushBridge(): null {
  const authorized = useRemote((s) => s.authorized)
  const readOnly = useApp((s) => s.readOnly)
  const controls = authorized === 'yes' && !readOnly

  useEffect(() => {
    if (!controls) return
    void registerPush(
      { notifications: Notifications, putPushToken: (t) => useRemote.getState().putPushToken(t) },
      authorized
    )
  }, [controls, authorized])

  useEffect(() => {
    if (!controls) return
    let live = true
    const open = (response: unknown): void => {
      if (!live || notificationTarget(response) !== 'pc' || !navigationRef.isReady()) return
      navigationRef.navigate('Abas', { screen: 'PC' })
    }
    // The tap that launched the app, then every later one.
    void Notifications.getLastNotificationResponseAsync()
      .then(open)
      .catch(() => undefined)
    const sub = Notifications.addNotificationResponseReceivedListener(open)
    return () => {
      live = false
      sub.remove()
    }
  }, [controls])
  return null
}

export function AppShell({ mode }: { mode: AppMode }): React.JSX.Element {
  const theme = useTheme()
  if (mode === 'loading')
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.bg
        }}
      >
        <AppMark size={88} a11yLabel="Carregando o Sagyou" />
      </View>
    )
  if (mode === 'pair')
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <PairScreen />
      </SafeAreaView>
    )
  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme(theme)}>
      <AutoUpdateCheck />
      <PushBridge />
      <Stack.Navigator>
        <Stack.Screen name="Abas" component={TabsScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Ajustes" component={SettingsScreen} />
        <Stack.Screen name="Conflitos" component={ConflictsScreen} />
        <Stack.Screen
          name="ComoFunciona"
          component={SyncGuideScreen}
          options={{ title: 'Como funciona' }}
        />
        <Stack.Screen
          name="ParearAparelho"
          component={PairDeviceScreen}
          options={{ title: PAIR_DEVICE_TITLE }}
        />
        <Stack.Screen
          name="ControlarPC"
          component={ControlSetupScreen}
          options={{ title: CONTROL_TITLE }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

export default function App(): React.JSX.Element {
  const mode = useApp((s) => s.mode)
  useEffect(() => bootstrap(), [])
  return (
    <GestureHandlerRootView style={styles.page}>
      <SafeAreaProvider>
        <LockGate>
          <AppShell mode={mode} />
        </LockGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 },
  fab: { position: 'absolute', right: SPACE.lg, bottom: SPACE.lg },
  notice: {
    position: 'absolute',
    left: SPACE.lg,
    right: SPACE.lg + 56 + SPACE.md,
    bottom: SPACE.lg
  },
  gear: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACE.sm
  }
})
