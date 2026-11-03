// Phone-only texts of the remote control; the shared ones live in @sagyou/core/control/texts.
export const REMOTE_TEXT = {
  noPc: 'O PC ainda não está no modo controlado. Ative em Configurações → Controle remoto, no PC.',
  revoked: 'Este celular não controla mais o PC. Peça autorização de novo.',
  refused: 'O PC recusou a autorização.',
  factor: 'Código do autenticador inválido.',
  locked: 'Muitas tentativas. Tente de novo em 15 minutos.',
  noEsp32Key: 'Este celular ainda não tem a chave do ESP32. Gere-a no PC.',
  noUpdate: 'Não há atualização pronta para instalar.',
  generic: 'Não foi possível concluir. Tente de novo.'
} as const
