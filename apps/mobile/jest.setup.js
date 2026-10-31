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
