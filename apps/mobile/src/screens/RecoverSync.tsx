import { useState } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { Button, Field, Screen } from '../components/ui'
import { FONT, useTheme } from '../theme'

export const RECOVER_TITLE = 'Entrar com código de recuperação'
export const RECOVER_TEXT =
  'Para quando nenhum aparelho pareado está à mão (celular perdido longe de casa). Use o código de recuperação, a senha de configuração do Worker e um código do autenticador ou um código reserva.'

interface Props {
  busy: boolean
  error: string | null
  onSubmit: (code: string, setupToken: string, factor: string) => void
  onBack: () => void
}

/**
 * The three secrets stay only in this component's state: never a log, a pref or
 * SQLite. They survive a failed try (to fix one field) and go away with the screen.
 */
export function RecoverSync({ busy, error, onSubmit, onBack }: Props): React.JSX.Element {
  const theme = useTheme()
  const [code, setCode] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [factor, setFactor] = useState('')
  const ready = code.trim() !== '' && setupToken !== '' && factor.trim() !== ''

  return (
    <ScrollView testID="recover-scroll" keyboardShouldPersistTaps="handled">
      <Screen>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {RECOVER_TITLE}
        </Text>
        <Text style={[styles.lead, { color: theme.muted }]}>{RECOVER_TEXT}</Text>
        <Field
          label="Código de recuperação"
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          // It is the sync key: keep it out of keyboard learning and autofill.
          keyboardType="visible-password"
          importantForAutofill="no"
          multiline
        />
        <Field
          label="Senha de configuração do Worker"
          value={setupToken}
          onChangeText={setSetupToken}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          importantForAutofill="no"
        />
        <Field
          label="Código do autenticador ou reserva"
          value={factor}
          onChangeText={setFactor}
          autoCapitalize="characters"
          autoCorrect={false}
          importantForAutofill="no"
        />
        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.red, fontSize: FONT.body }}>
            {error}
          </Text>
        ) : null}
        <Button
          variant="primary"
          label={busy ? 'Entrando…' : 'Entrar'}
          disabled={!ready || busy}
          onPress={() => onSubmit(code.trim(), setupToken, factor.trim())}
        />
        <Button label="Voltar" onPress={onBack} disabled={busy} />
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: FONT.title, fontWeight: '700', textAlign: 'center' },
  lead: { fontSize: FONT.bodyLg, textAlign: 'center' }
})
