// Expo's default config already understands npm workspaces (it watches the
// repository root and resolves hoisted packages), which @sagyou/core needs.
const { getDefaultConfig } = require('expo/metro-config')

module.exports = getDefaultConfig(__dirname)
