import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useEffect, type ComponentType } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { bootstrap } from './bootstrap'
import { StatusBanner } from './components/StatusBanner'
import { FinanceScreen } from './screens/FinanceScreen'
import { HabitsScreen } from './screens/HabitsScreen'
import { NotesScreen } from './screens/NotesScreen'
import { PairScreen } from './screens/PairScreen'
import { Placeholder } from './screens/Placeholder'
import { SettingsScreen } from './screens/SettingsScreen'
import { TasksStack } from './screens/tasks/TasksStack'
import { useApp, type AppMode } from './store/app'
import { useTheme, type Theme } from './theme'

export const TAB_LABELS = ['Tarefas', 'Hábitos', 'Finanças', 'Notas', 'Busca'] as const

/** Each tab's content; a tab without one shows a placeholder until its task lands. */
const TAB_SCREENS: Partial<Record<(typeof TAB_LABELS)[number], ComponentType>> = {
  Tarefas: TasksStack,
  Hábitos: HabitsScreen,
  Finanças: FinanceScreen,
  Notas: NotesScreen
}

export type RootStackParams = {
  Abas: undefined
  Ajustes: undefined
}

const Tabs = createBottomTabNavigator()
const Stack = createNativeStackNavigator<RootStackParams>()

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

function TabsScreen({
  navigation
}: {
  navigation: { navigate(route: 'Ajustes'): void }
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <Tabs.Navigator
      screenOptions={{
        tabBarActiveTintColor: theme.purple,
        tabBarInactiveTintColor: theme.muted,
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ajustes"
            onPress={() => navigation.navigate('Ajustes')}
            style={{ paddingHorizontal: 16, paddingVertical: 8 }}
          >
            <Text style={{ color: theme.muted }}>Ajustes</Text>
          </Pressable>
        )
      }}
    >
      {TAB_LABELS.map((label) => {
        const Content = TAB_SCREENS[label]
        return (
          <Tabs.Screen key={label} name={label}>
            {() => (Content ? <Content /> : <Placeholder title={label} />)}
          </Tabs.Screen>
        )
      })}
    </Tabs.Navigator>
  )
}

/** What is on screen for each mode; no tab exists before the phone is paired. */
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
        <ActivityIndicator color={theme.purple} />
      </View>
    )
  if (mode === 'pair')
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <PairScreen />
      </SafeAreaView>
    )
  return (
    <NavigationContainer theme={navigationTheme(theme)}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: theme.bg }}>
        <StatusBanner />
      </SafeAreaView>
      <Stack.Navigator>
        <Stack.Screen name="Abas" component={TabsScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Ajustes" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

export default function App(): React.JSX.Element {
  const mode = useApp((s) => s.mode)
  useEffect(() => bootstrap(), [])
  return (
    <SafeAreaProvider>
      <AppShell mode={mode} />
    </SafeAreaProvider>
  )
}
