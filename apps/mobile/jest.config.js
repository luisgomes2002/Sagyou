// Habits and due dates key off the LOCAL day: pin a non-UTC zone, like the desktop suite.
process.env.TZ = 'America/Sao_Paulo'

module.exports = {
  preset: 'jest-expo',
  setupFiles: ['./jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  // Workspace packages are TypeScript source: let babel transform them.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sagyou/.*|@noble/.*|@scure/.*|fflate))'
  ]
}
