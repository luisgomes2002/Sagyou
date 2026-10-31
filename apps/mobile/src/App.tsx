import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { Pressable, Text } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { Placeholder } from './screens/Placeholder'
import { useTheme, type Theme } from './theme'

export const TAB_LABELS = ['Tarefas', 'Hábitos', 'Finanças', 'Notas', 'Busca'] as const

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
  navigation: { navigate(r: 'Ajustes'): void }
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
      {TAB_LABELS.map((label) => (
        <Tabs.Screen key={label} name={label}>
          {() => <Placeholder title={label} />}
        </Tabs.Screen>
      ))}
    </Tabs.Navigator>
  )
}

export default function App(): React.JSX.Element {
  const theme = useTheme()
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme(theme)}>
        <Stack.Navigator>
          <Stack.Screen name="Abas" component={TabsScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Ajustes">{() => <Placeholder title="Ajustes" />}</Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  )
}
