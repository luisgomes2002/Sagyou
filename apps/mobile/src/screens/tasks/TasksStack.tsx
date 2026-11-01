import {
  createNativeStackNavigator,
  type NativeStackScreenProps
} from '@react-navigation/native-stack'
import { useEffect } from 'react'
import { useApp } from '../../store/app'
import { TaskForm } from './TaskForm'
import { ProjectBoard, ProjectList, UPCOMING_TITLE, UpcomingList } from './TaskLists'

type TasksParams = {
  Projetos: undefined
  Projeto: { projectId: string }
  Tarefa: { projectId: string; taskId?: string; columnId?: string; draftTitle?: string }
  [UPCOMING_TITLE]: undefined
}

const Stack = createNativeStackNavigator<TasksParams>()

function ProjectsRoute({
  navigation
}: NativeStackScreenProps<TasksParams, 'Projetos'>): React.JSX.Element {
  return (
    <ProjectList
      onOpen={(projectId) => navigation.navigate('Projeto', { projectId })}
      onUpcoming={() => navigation.navigate(UPCOMING_TITLE)}
    />
  )
}

function ProjectRoute({
  navigation,
  route
}: NativeStackScreenProps<TasksParams, 'Projeto'>): React.JSX.Element {
  const { projectId } = route.params
  const name = useApp((s) => s.state.projects.find((p) => p.id === projectId)?.name)
  useEffect(() => {
    if (name) navigation.setOptions({ title: name })
  }, [navigation, name])
  return (
    <ProjectBoard
      projectId={projectId}
      onOpenTask={(taskId) => navigation.navigate('Tarefa', { projectId, taskId })}
      onNewTask={(columnId) => navigation.navigate('Tarefa', { projectId, columnId })}
    />
  )
}

function TaskRoute({
  navigation,
  route
}: NativeStackScreenProps<TasksParams, 'Tarefa'>): React.JSX.Element {
  return <TaskForm {...route.params} onDone={() => navigation.goBack()} />
}

function UpcomingRoute({
  navigation
}: NativeStackScreenProps<TasksParams, typeof UPCOMING_TITLE>): React.JSX.Element {
  return (
    <UpcomingList
      onOpenTask={(projectId, taskId) => navigation.navigate('Tarefa', { projectId, taskId })}
    />
  )
}

/** The Tarefas tab: projects → board → task form, plus "Próximas". */
export function TasksStack(): React.JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Projetos" component={ProjectsRoute} options={{ headerShown: false }} />
      <Stack.Screen name="Projeto" component={ProjectRoute} />
      <Stack.Screen
        name="Tarefa"
        component={TaskRoute}
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen name={UPCOMING_TITLE} component={UpcomingRoute} />
    </Stack.Navigator>
  )
}
