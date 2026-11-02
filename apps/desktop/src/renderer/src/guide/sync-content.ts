import { SYNC_BEHAVIOR_ARTICLE, SYNC_KEYS_ARTICLE } from '@sagyou/core/sync/guide'
import type { GuideArticle } from './types'

// Every claim here must match the code (SyncSettings.tsx, RestoreSyncDialog.tsx,
// sync-server/, apps/mobile). When the README disagrees, the code wins.

const SYNC_SETTINGS = { view: 'settings', section: 'sincronizacao' } as const

export const SYNC_ARTICLES: GuideArticle[] = [
  {
    id: 'sync-o-que-e',
    title: 'O que é e o que o servidor vê',
    blocks: [
      { type: 'diagram', id: 'sync' },
      {
        type: 'p',
        text: 'A sincronização mantém seus PCs e o celular com os mesmos dados. Ela usa um servidor seu: um Worker da Cloudflare com um banco D1, que cabe no plano gratuito. Não existe servidor do Sagyou no meio.'
      },
      {
        type: 'p',
        text: 'Tudo sai do aparelho já cifrado. O servidor guarda só lotes cifrados, identificadores opacos de aparelho e números (quantidades e horários). A chave nunca sai dos seus aparelhos, então nem a Cloudflare nem quem administra o Worker consegue ler seus dados.'
      },
      {
        type: 'steps',
        items: [
          'Crie o servidor na Cloudflare (uma vez só).',
          'Ative a sincronização no primeiro PC e guarde o código de recuperação.',
          'Cadastre o autenticador.',
          'Pareie os outros PCs e o celular.'
        ]
      },
      {
        type: 'callout',
        tone: 'tip',
        text: 'Sem a sincronização, nada muda: o Sagyou continua funcionando só neste computador.'
      }
    ],
    target: SYNC_SETTINGS
  },
  {
    id: 'sync-servidor',
    title: 'Criar o servidor na Cloudflare',
    blocks: [
      {
        type: 'p',
        text: 'Você precisa de uma conta gratuita na Cloudflare (cloudflare.com), do Node.js instalado e da pasta sync-server do repositório do Sagyou no GitHub. Abra um terminal dentro dessa pasta e rode os comandos abaixo, em ordem.'
      },
      {
        type: 'command',
        command: 'npm install',
        label: 'Instala o wrangler, a ferramenta da Cloudflare.'
      },
      {
        type: 'command',
        command: 'npx wrangler login',
        label: 'Abre o navegador para você entrar na sua conta Cloudflare.'
      },
      {
        type: 'command',
        command: 'npx wrangler d1 create sagyou-sync',
        label: 'Cria o banco. Copie o database_id que aparece para o arquivo wrangler.toml.'
      },
      {
        type: 'command',
        command: 'npx wrangler d1 execute sagyou-sync --remote --file schema.sql',
        label: 'Cria as tabelas do banco.'
      },
      {
        type: 'command',
        command: 'npx wrangler secret put SETUP_TOKEN',
        label: 'Pede um segredo longo, usado só para registrar o primeiro aparelho.'
      },
      {
        type: 'command',
        command: "node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
        label: 'Gera uma chave nova de 32 bytes para o próximo comando.'
      },
      {
        type: 'command',
        command: 'npx wrangler secret put TOTP_ENC_KEY',
        label: 'Cole a chave gerada acima. Sem ela, o cadastro do autenticador não funciona.'
      },
      {
        type: 'command',
        command: 'npx wrangler deploy',
        label: 'Publica o Worker e mostra a URL dele.'
      },
      {
        type: 'callout',
        tone: 'warning',
        text: 'Guarde o SETUP_TOKEN e o TOTP_ENC_KEY fora do repositório, num gerenciador de senhas. Nunca os coloque em arquivos que vão para o GitHub.'
      },
      {
        type: 'p',
        text: 'Anote a URL que o último comando mostra (algo como https://sagyou-sync.<sua-conta>.workers.dev). Ela é a "URL do servidor" no app.'
      }
    ]
  },
  {
    id: 'sync-ativar',
    title: 'Ativar no primeiro PC',
    blocks: [
      {
        type: 'steps',
        items: [
          'Abra Configurações → Sincronização.',
          'Se quiser, dê um nome a este aparelho (por exemplo, "PC do escritório").',
          'Em Primeiro aparelho, preencha a URL do servidor e o Token de configuração (o SETUP_TOKEN).',
          'Clique em Ativar.',
          'O app mostra o código de recuperação. Guarde-o, marque "Guardei o código" e clique em Concluir.'
        ]
      },
      {
        type: 'callout',
        tone: 'danger',
        text: 'O código de recuperação é a chave da sincronização. Quem tiver o código lê seus dados, e sem ele não há como recuperar a chave se você perder todos os aparelhos. Guarde fora deste computador.'
      },
      {
        type: 'p',
        text: 'Depois você pode vê-lo de novo em Este aparelho → Ver código de recuperação. Com a senha do app ativa, ela é pedida antes.'
      }
    ],
    target: SYNC_SETTINGS
  },
  {
    id: 'sync-autenticador',
    title: 'Cadastrar o autenticador',
    blocks: [
      {
        type: 'p',
        text: 'O autenticador é um app de códigos de 6 dígitos no celular, como o Google Authenticator. Ele protege as ações mais perigosas: apagar os dados de um aparelho perdido.'
      },
      {
        type: 'steps',
        items: [
          'Em Configurações → Sincronização → Google Authenticator, clique em Cadastrar ou trocar autenticador.',
          'No app do celular, escaneie o QR (ou digite o segredo mostrado abaixo dele).',
          'Digite o código de 6 dígitos em Código de confirmação e clique em Confirmar código.',
          'Guarde os códigos reserva que aparecem: eles são mostrados uma vez só. Cada um funciona uma vez, se você estiver sem o celular.'
        ]
      },
      {
        type: 'p',
        text: 'Para trocar um autenticador já cadastrado (celular novo, por exemplo), digite antes o código atual dele, ou um código reserva, em Código atual do autenticador ou reserva. No primeiro cadastro, deixe esse campo em branco.'
      },
      {
        type: 'callout',
        tone: 'warning',
        text: 'Cinco códigos errados seguidos bloqueiam o autenticador por 15 minutos.'
      }
    ],
    target: SYNC_SETTINGS
  },
  {
    id: 'sync-parear-pc',
    title: 'Parear outro PC',
    blocks: [
      {
        type: 'steps',
        items: [
          'No PC que já sincroniza, abra Configurações → Sincronização → Aparelhos e clique em Parear novo aparelho.',
          'Aparecem um QR e um Código de pareamento. Ele vale uma vez só e expira em 10 minutos.',
          'No outro PC, abra Configurações → Sincronização, cole o código em Outro aparelho já sincroniza e clique em Entrar com código.'
        ]
      },
      {
        type: 'p',
        text: 'Se esse PC já tiver dados, o app pergunta o que fazer. Juntar mantém o que está nos dois lados. Substituir fica só com o que está na nuvem, e faz um backup deste PC antes.'
      },
      {
        type: 'callout',
        tone: 'tip',
        text: 'Se o código expirar, gere outro: um código usado ou vencido não funciona mais.'
      }
    ],
    target: SYNC_SETTINGS
  },
  {
    id: 'sync-parear-celular',
    title: 'Parear o celular',
    blocks: [
      {
        type: 'p',
        text: 'O app Android entra na mesma sincronização como mais um aparelho. Ele tem tarefas (com Próximas), hábitos, gastos e receitas, notas dos projetos e busca, e funciona sem internet.'
      },
      {
        type: 'steps',
        items: [
          'Instale o APK do Sagyou no celular. O Android precisa ter um bloqueio de tela (PIN, padrão, senha ou biometria).',
          'No PC, abra Configurações → Sincronização → Parear novo aparelho.',
          'No celular, toque em Começar e depois em Ler QR, e aponte para a tela do PC. Sem câmera: cole o texto em Código de pareamento e toque em Colar código.',
          'O celular baixa tudo da nuvem e passa a sincronizar.'
        ]
      },
      {
        type: 'p',
        text: 'O celular sincroniza enquanto o app está aberto, e de novo quando a internet volta. Ele pede a biometria ou o bloqueio do Android ao abrir, e de novo depois de 5 minutos fora.'
      },
      {
        type: 'callout',
        tone: 'tip',
        text: 'No celular, Ajustes → Desconectar este aparelho apaga os dados só do celular. Eles continuam na nuvem e nos PCs.'
      }
    ],
    target: SYNC_SETTINGS
  },
  // Shared with the phone's Como funciona screen (packages/core/src/sync/guide.ts).
  { ...SYNC_BEHAVIOR_ARTICLE, target: SYNC_SETTINGS },
  { ...SYNC_KEYS_ARTICLE, target: SYNC_SETTINGS },
  {
    id: 'sync-conflitos',
    title: 'Conflitos',
    blocks: [
      {
        type: 'p',
        text: 'Quando a mesma coisa é editada em dois aparelhos sem conexão, a versão mais recente vale. A outra fica guardada em Configurações → Sincronização → Conflitos, lado a lado, com Usar esta para trocar.'
      },
      {
        type: 'callout',
        tone: 'warning',
        text: 'Uma dívida editada nos dois lados nunca muda sozinha: ela fica marcada como conflito até você escolher a versão.'
      },
      {
        type: 'p',
        text: 'Se um item foi apagado num aparelho enquanto outro mexia num item ligado a ele, aparece "Removido: o item de origem foi apagado em outro aparelho", com Dispensar.'
      },
      {
        type: 'p',
        text: 'Cada aparelho guarda os conflitos que ele mesmo viu. No celular, toque em Ajustes → "N conflitos" para ver as duas versões. Ao escolher num aparelho, a escolha viaja e o mesmo conflito fecha sozinho nos outros na próxima sincronização.'
      }
    ],
    target: SYNC_SETTINGS
  },
  {
    id: 'sync-perdi-aparelho',
    title: 'Perdi um aparelho',
    blocks: [
      {
        type: 'steps',
        items: [
          'Num aparelho que ainda sincroniza, abra Configurações → Sincronização → Aparelhos.',
          'Clique em Revogar ao lado do aparelho perdido.',
          'Para também apagar os dados dele, marque Também apagar os dados dele e digite o código do autenticador (ou um código reserva).',
          'Clique em Confirmar revogação.'
        ]
      },
      {
        type: 'p',
        text: 'O aparelho revogado deixa de sincronizar na hora. Com a opção de apagar, ele apaga os próprios dados, sem backup, na próxima vez que se conectar. Os dados continuam na nuvem e nos outros aparelhos.'
      },
      {
        type: 'callout',
        tone: 'warning',
        text: 'Revogar com apagar exige o autenticador cadastrado. Cadastre-o antes de precisar.'
      }
    ],
    target: SYNC_SETTINGS
  },
  {
    id: 'sync-perdi-todos',
    title: 'Perdi todos os aparelhos',
    blocks: [
      {
        type: 'p',
        text: 'Se todos os aparelhos se perderem, os dados continuam cifrados no seu Worker, e o código de recuperação é a única forma de abri-los. Sem ele, ninguém consegue ler os dados, nem você.'
      },
      {
        type: 'callout',
        tone: 'danger',
        text: 'Esta versão do app ainda não tem uma tela para recuperar a sincronização com o código de recuperação. Guarde o código mesmo assim e faça backups regulares em Dados e segurança: um backup restaura tudo num computador novo.'
      },
      {
        type: 'callout',
        tone: 'warning',
        text: 'Depois de restaurar o backup, ativar de novo no mesmo Worker não funciona sem a chave antiga. Para voltar a sincronizar, crie um banco D1 novo (refaça "Criar o servidor na Cloudflare") e ative nele.'
      }
    ],
    target: { view: 'guide', articleId: 'dados-backup' }
  },
  {
    id: 'sync-restaurar-backup',
    title: 'Restaurar um backup com a sincronização ligada',
    blocks: [
      {
        type: 'p',
        text: 'Depois de importar um backup com a sincronização ligada, o app pergunta "Restaurar também nos outros aparelhos?".'
      },
      {
        type: 'steps',
        items: [
          'Sim, restaurar nos outros: o backup restaurado vai para a nuvem e para os aparelhos pareados.',
          'Não, só neste aparelho: a sincronização fica pausada aqui até você escolher. Fechar a pergunta sem responder também pausa.',
          'Na pausa, Configurações → Sincronização mostra "Pausado: escolha o que vale". Este aparelho manda envia o que está aqui; A nuvem manda troca pelo que está na nuvem, com um backup daqui antes.'
        ]
      }
    ],
    target: SYNC_SETTINGS
  },
  {
    id: 'sync-problemas',
    title: 'Problemas comuns',
    blocks: [
      {
        type: 'p',
        text: '"O chaveiro do sistema não está disponível; a sincronização não liga.": a chave fica guardada no cofre de senhas do sistema. No Linux, instale e desbloqueie um chaveiro (como o GNOME Keyring) e abra o app de novo.'
      },
      {
        type: 'p',
        text: '"Este aparelho foi desconectado da sincronização": ele foi revogado em outro aparelho, ou a sessão dele deixou de valer. Desative a sincronização aqui e pareie de novo com um código novo.'
      },
      {
        type: 'p',
        text: '"Pausado: escolha o que vale": um backup foi restaurado só aqui, ou a troca pelos dados da nuvem não terminou. Escolha Este aparelho manda ou A nuvem manda.'
      },
      {
        type: 'p',
        text: '"Sincronização em espera: começa depois da atualização": há uma versão nova do app esperando para ser instalada. Reinicie para instalar e a sincronização volta.'
      },
      {
        type: 'p',
        text: '"Sem conexão: as alterações ficam guardadas": sem internet, nada se perde. Tudo é enviado quando a conexão volta.'
      }
    ],
    target: SYNC_SETTINGS
  }
]
