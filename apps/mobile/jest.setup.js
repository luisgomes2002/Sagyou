// The same globals index.ts installs on the device. Node already has
// crypto.getRandomValues, URL and structuredClone; native modules are mocked.
/* global jest */
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default
)
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js')
)
// The tests use node:sqlite through src/data/__tests__/node-db.ts instead.
jest.mock('expo-sqlite', () => ({ openDatabaseSync: jest.fn() }))
jest.mock('expo-secure-store', () => ({
  getItem: jest.fn(() => null),
  setItem: jest.fn(),
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined)
}))
jest.mock('expo-device', () => ({ modelName: 'Pixel de teste' }))
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false }, jest.fn(async () => ({ granted: false }))]
}))
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(async () => 3),
  authenticateAsync: jest.fn(async () => ({ success: true }))
}))
jest.mock('expo-clipboard', () => {
  let text = ''
  return {
    setStringAsync: jest.fn(async (value) => {
      text = value
      return true
    }),
    getStringAsync: jest.fn(async () => text)
  }
})
// Tests drive the tap on a notification through getLastNotificationResponseAsync.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: false })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: 'android', data: '' })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  // Spec 2026-11-13: notifications received with the app open, the ones still in the bar and
  // the three Android channels.
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
  setNotificationChannelAsync: jest.fn(async () => null),
  AndroidImportance: { HIGH: 4, MAX: 5 }
}))
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(async () => undefined)
}))
require('react-native-gesture-handler/jestSetup')
jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined)
}))
// The native date dialog: a View the tests can find and drive through its props.
jest.mock('@react-native-community/datetimepicker', () => {
  const { createElement } = require('react')
  const { View } = require('react-native')
  return {
    __esModule: true,
    default: (props) => createElement(View, { testID: 'date-picker', ...props })
  }
})
