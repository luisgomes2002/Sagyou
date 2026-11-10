import { createNavigationContainerRef } from '@react-navigation/native'
import type { RootStackParams } from './App'

/** The root navigator, shared with tests (App.tsx may only export components). */
export const navigationRef = createNavigationContainerRef<RootStackParams>()
