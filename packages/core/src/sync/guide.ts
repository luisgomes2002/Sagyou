/**
 * How sync behaves and what each key is for, as data both apps render: the
 * desktop's Como funciona and the phone's Como funciona screen read these
 * same objects, so they never say different things.
 *
 * Every number here must match the code (engine.ts: PUSH_DEBOUNCE_MS,
 * POLL_MS, MAX_BACKOFF_MS; merge: 30 days; sync-server: 10-min invites, 8
 * backup codes). Example values are fake on purpose: the recovery code below
 * fails its checksum, and none of them is ever offered for copying.
 */

export type SyncGuideBlock =
  | { type: 'p'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'callout'; tone: 'tip' | 'warning' | 'danger'; text: string }
  | {
      type: 'keyExample'
      name: string
      example: string
      lines: { label: string; text: string }[]
    }
  | { type: 'table'; head: [string, string]; rows: [string, string][] }

export interface SyncGuideArticle {
  id: string
  title: string
  blocks: SyncGuideBlock[]
}

export const EXAMPLE_LABEL = 'Exemplo'

/** What a screen reader says for an example, so it is never read as a real value. */
export function exampleA11yLabel(name: string): string {
  return `${EXAMPLE_LABEL} de ${name}, não é um valor real`
}

export const KEY_LINE_LABELS = [
  'Para que serve',
  'Quando é pedido',
  'Onde ver de novo',
  'Se perder',
  'Se alguém pegar',
  'Onde guardar'
] as const

type KeyLines = [string, string, string, string, string, string]

function keyExample(name: string, example: string, texts: KeyLines): SyncGuideBlock {
  return {
    type: 'keyExample',
    name,
    example,
    lines: KEY_LINE_LABELS.map((label, i) => ({ label, text: texts[i] }))
  }
}

export const EXAMPLE_RECOVERY_CODE =
  'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567-ABCD-EFGH-IJKL-MNOP-QRST-UVWX\nhttps://exemplo.workers.dev'
export const EXAMPLE_TOTP = '123 456'
export const EXAMPLE_BACKUP_CODE = '0A1B2C3D4E5F60718293'
export const EXAMPLE_SETUP_TOKEN = 'exemplo-de-senha-de-setup'
export const EXAMPLE_PAIR_CODE =
  'sagyou-sync:1:https://exemplo.workers.dev:CHAVE-DE-EXEMPLO:CONVITE-DE-EXEMPLO'

export const SYNC_BEHAVIOR_ARTICLE: SyncGuideArticle = {
  id: 'sync-comportamento',
  title: 'Como a sincronização se comporta',
  blocks: [
    {
      type: 'p',
      text: 'O Worker é uma caixa de correio: cada aparelho deixa ali as suas mudanças cifradas e busca as dos outros. Os aparelhos nunca falam direto entre si nem precisam estar na mesma rede.'
    },
    { type: 'p', text: 'Quando cada aparelho sincroniza:' },
    {
      type: 'steps',
      items: [
        'PC: só com o Sagyou aberto (na bandeja também vale). Envia 5 s depois de salvar, envia e busca ao abrir e a cada 60 s. Sem conexão, tenta de novo cada vez mais devagar, até a cada 15 min.',
        'Celular: só com o app na tela. Envia e busca ao abrir ou voltar para o app, a cada 60 s, 5 s depois de editar e quando a internet volta. Ao sair do app, envia na hora o que estava esperando e para.'
      ]
    },
    {
      type: 'p',
      text: 'Uma mudança leva de uns 5 s a pouco mais de 1 min para aparecer do outro lado, se os dois estiverem abertos e com internet.'
    },
    {
      type: 'p',
      text: 'Conflito é o mesmo item alterado em dois aparelhos antes de um receber a mudança do outro. A versão mais recente vale nos dois, e a outra fica guardada por 30 dias em Conflitos para você trocar se quiser. Uma dívida é a exceção: cada aparelho mantém o próprio valor até você escolher. A comparação é do item inteiro, não campo a campo; itens diferentes nunca conflitam.'
    },
    {
      type: 'p',
      text: 'Cada aparelho mostra os conflitos que ele mesmo viu: no PC em Configurações → Sincronização → Conflitos, no celular em Ajustes → N conflitos. Escolher num aparelho avisa os outros, e em geral o mesmo conflito fecha sozinho neles na próxima sincronização; um item removido (órfão) se dispensa em cada aparelho.'
    },
    {
      type: 'callout',
      tone: 'tip',
      text: 'Fora de casa com o Claude trabalhando no PC: o Sagyou precisa estar aberto no PC para o agente gravar pelo MCP e para a mudança subir. O celular recebe em até 1 min.'
    },
    { type: 'p', text: 'Como evitar conflitos:' },
    {
      type: 'steps',
      items: [
        'Espere sincronizar antes de editar no celular (o status em Ajustes diz há quanto tempo).',
        'Não mexa no item em que o agente está trabalhando, como uma tarefa com o cronômetro ligado.',
        'Deixe o Sagyou aberto no PC enquanto estiver fora.'
      ]
    }
  ]
}

export const SYNC_KEYS_ARTICLE: SyncGuideArticle = {
  id: 'sync-chaves',
  title: 'As chaves da sincronização',
  blocks: [
    keyExample('Código de recuperação', EXAMPLE_RECOVERY_CODE, [
      'É a chave que cifra os dados. Volta à sincronização quando nenhum aparelho pareado sobrou.',
      'Ao ativar: aparece uma vez, com "Guardei o código".',
      'No PC: Configurações → Sincronização → Ver código de recuperação (pede a senha do app, se houver).',
      'Com algum aparelho pareado, veja de novo nele. Sem nenhum, os dados na nuvem ficam ilegíveis; o backup local continua valendo.',
      'Lê seus dados se também conseguir os lotes do Worker. Desative e ative de novo num D1 novo.',
      'Num gerenciador de senhas ou em papel, fora do celular e longe dos códigos reserva.'
    ]),
    keyExample('Código do autenticador', EXAMPLE_TOTP, [
      'Confirma ações perigosas no Worker.',
      'Para revogar um aparelho apagando os dados e para trocar o autenticador.',
      'No app autenticador: são 6 dígitos que mudam a cada 30 s.',
      'Use um código reserva.',
      'Sozinho não serve: só vale junto com um aparelho pareado.',
      'No app autenticador; não precisa anotar.'
    ]),
    keyExample('Códigos reserva', EXAMPLE_BACKUP_CODE, [
      'São 8 códigos que substituem o código de 6 dígitos, uma vez cada.',
      'No lugar do código do autenticador.',
      'Não dá: aparecem uma vez só, ao cadastrar o autenticador.',
      'Cadastre o autenticador de novo para gerar outros.',
      'Pode usar um no lugar do autenticador: troque o autenticador.',
      'Num gerenciador de senhas ou em papel, separados do código de recuperação.'
    ]),
    keyExample('Senha de configuração do Worker', EXAMPLE_SETUP_TOKEN, [
      'Autoriza ativar a sincronização no Worker.',
      'Ao ativar e ao recuperar.',
      'Onde você a guardou ao criar o Worker (wrangler secret).',
      'Defina outra com npx wrangler secret put SETUP_TOKEN.',
      'Com aparelhos ativos, sozinha não registra aparelho (pede a prova da chave). Troque-a.',
      'Num gerenciador de senhas.'
    ]),
    keyExample('Código de pareamento / QR', EXAMPLE_PAIR_CODE, [
      'Adiciona um aparelho.',
      'Ao parear outro PC ou o celular.',
      'Gere outro em Parear novo aparelho (PC) ou Parear outro aparelho (celular), com o código do autenticador.',
      'Gere outro: vale 10 min e uma vez só.',
      'Expira em 10 min e serve uma vez; se suspeitar, revogue o aparelho que entrou.',
      'Não guarde: use na hora.'
    ]),
    {
      type: 'callout',
      tone: 'warning',
      text: 'Guarde o código de recuperação e os códigos reserva fora do celular e em lugares separados: um gerenciador de senhas, ou papel.'
    },
    {
      type: 'table',
      head: ['Perdeu…', 'Usa…'],
      rows: [
        [
          'Um aparelho',
          'Revogue-o em outro aparelho, apagando os dados se precisar (pede o autenticador).'
        ],
        [
          'O celular com o autenticador',
          'Um código reserva, depois cadastre o autenticador de novo.'
        ],
        [
          'Todos os aparelhos',
          'O código de recuperação (a tela de recuperar ainda não existe; enquanto isso, um backup).'
        ],
        ['O código de recuperação', 'Veja de novo num aparelho pareado.'],
        ['Os códigos reserva', 'Cadastre o autenticador de novo.'],
        ['A senha de configuração', 'Defina outra com npx wrangler secret put SETUP_TOKEN.'],
        [
          'O celular autorizado a controlar o PC',
          'Cortar acesso na aba PC de outro celular autorizado, se tiver; depois o código de recuperação, a senha do Worker, um código reserva e a senha do Sagyou (veja Trocar de celular longe de casa).'
        ]
      ]
    }
  ]
}

/** The phone that controls the PC was lost and you are away (spec 2026-11-03-controle-remoto-app). */
export const SYNC_SWITCH_PHONE_ARTICLE: SyncGuideArticle = {
  id: 'sync-trocar-celular',
  title: 'Trocar de celular longe de casa',
  blocks: [
    {
      type: 'p',
      text: 'Para quando o celular autorizado a controlar o PC foi perdido, roubado ou trocado e você está longe do PC. Antes de precisar, guarde fora do celular: o código de recuperação, a senha de configuração do Worker e os códigos reserva do autenticador. O Google Authenticator perdido junto com o celular só volta se tinha backup na conta Google.'
    },
    {
      type: 'steps',
      items: [
        'No celular novo, instale o Sagyou e toque em Entrar com código de recuperação: cole o código de recuperação e digite a senha de configuração do Worker e um código do autenticador ou um código reserva.',
        'Em Ajustes → Controlar o PC, toque em Estou longe do PC: digite a senha do Sagyou e um código novo do autenticador ou outro código reserva (o anterior já foi usado para entrar), e confirme com a biometria.',
        'Assim que o Worker confere o código, o celular novo já liga o PC pelo ESP32. Desbloquear, desligar e aprovar cartões esperam o PC ligado conferir a senha do Sagyou. O pedido espera o PC por 1 hora; depois disso, ligue o PC e peça de novo.',
        'Revogue o celular perdido na sincronização, apagando os dados dele (pede o código do autenticador).'
      ]
    },
    {
      type: 'callout',
      tone: 'warning',
      text: 'Os celulares autorizados antes perdem o controle do PC na hora. Senha do Sagyou errada conta para o limite de 5 erros seguidos: depois disso o controle remoto fica suspenso por 15 minutos.'
    },
    {
      type: 'callout',
      tone: 'tip',
      text: 'Quem tiver o código de recuperação, a senha do Worker e um código do autenticador consegue ligar o PC; para desbloquear o Sagyou ainda precisa da senha dele.'
    }
  ]
}

export const SYNC_GUIDE_ARTICLES: SyncGuideArticle[] = [
  SYNC_BEHAVIOR_ARTICLE,
  SYNC_KEYS_ARTICLE,
  SYNC_SWITCH_PHONE_ARTICLE
]
