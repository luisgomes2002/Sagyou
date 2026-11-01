// Polyfills first: @sagyou/core (crypto, sync engine) relies on these web
// globals, which Hermes does not fully provide.
import 'react-native-get-random-values'
import 'react-native-url-polyfill/auto'
import structuredClone from '@ungap/structured-clone'
import { registerRootComponent } from 'expo'
import App from './src/App'

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = structuredClone as typeof globalThis.structuredClone
}

registerRootComponent(App)
