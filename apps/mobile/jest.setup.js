// The same globals index.ts installs on the device. Node already has
// crypto.getRandomValues, URL and structuredClone; native modules are mocked.
/* global jest */
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default
)
