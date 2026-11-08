import type { GuideArticle, GuideChapter } from './types'
import { SYNC_ARTICLES } from './sync-content'

export { articleText, normalizeForSearch, searchGuide } from './search'

const primeirosPassos: GuideArticle[] = [
  {
    id: 'inicio-o-que-e',
    title: 'O que é o Sagyou',
    blocks: [
      {
        type: 'p',
        text: 'O Sagyou reúne trabalho, rotina e finanças pessoais num só lugar: projetos e tarefas, planejamento do dia, metas, hábitos, finanças e sessões de agentes de código.'
      },
      {
        type: 'p',
        text: 'O Início mostra um retrato das áreas do app. Os números financeiros respeitam o perfil selecionado; ao escolher uma tabela, os valores aparecem na moeda própria dela.'
      }
    ],
    target: { view: 'home' }
  },
  {
    id: 'inicio-barra-lateral',
    title: 'A barra lateral',
    blocks: [
      {
        type: 'p',
        text: 'A barra lateral leva a cada área e lista os projetos. Áreas que você não usa podem ser ocultadas; ocultar uma área não apaga os dados dela.'
      },
      {
        type: 'steps',
        items: [
          'Abra Configurações, no rodapé da barra lateral.',
          'Escolha a seção Barra lateral.',
          'Desmarque as áreas que não quer ver. Marque de novo para que voltem.'
        ]
      }
    ],
    target: { view: 'settings', section: 'barra-lateral' }
  },
  {
    id: 'inicio-busca',
    title: 'Busca global (Ctrl+K)',
    blocks: [
      {
        type: 'p',
        text: 'Ctrl+K abre a busca em qualquer tela. Ela encontra tarefas, notas, metas, hábitos, arquivos, registros financeiros e memórias, agrupados por área.'
      },
      {
        type: 'steps',
        items: [
          'Pressione Ctrl+K e digite parte do que procura.',
          'Use as setas para escolher um resultado e Enter para abri-lo.',
          'O Sagyou leva até a tela de origem e destaca o registro.'
        ]
      },
      {
        type: 'callout',
        tone: 'tip',
        text: 'Resultados financeiros mostram apenas o perfil financeiro ativo.'
      }
    ]
  },
  {
    id: 'inicio-onde-ficam-dados',
    title: 'Onde ficam seus dados',
    blocks: [
      {
        type: 'p',
        text: 'Tudo fica salvo neste computador. Nada sai dele, a não ser que você ative a sincronização com o seu próprio servidor ou rode um agente de código, que é um programa externo com a própria conta.'
      },
      {
        type: 'callout',
        tone: 'tip',
        text: 'Para ter os mesmos dados em outro PC ou no celular, veja o capítulo Sincronização e celular.'
      }
    ],
    target: { view: 'guide', articleId: 'sync-o-que-e' }
  }
]

const projetos: GuideArticle[] = [
  {
    id: 'projetos-board',
    title: 'Projetos e board',
    blocks: [
      { type: 'visual', id: 'board' },
      {
        type: 'p',
        text: 'Cada projeto tem seu próprio quadro de colunas. Ao criar um projeto, o quadro começa com Backlog, In Progress, Review e Done; você pode organizar as colunas e mover tarefas entre elas arrastando ou pelo teclado.'
      },
      {
        type: 'p',
        text: 'O projeto pode guardar descrição e links úteis. Ele também define o contexto do board, do canvas e dos arquivos.'
      },
      {
        type: 'callout',
        tone: 'warning',
        text: 'Arquivar tira o projeto da lista sem apagar nada. Excluir o projeto remove também suas tarefas, e excluir uma coluna remove as tarefas que estiverem nela.'
      }
    ],
    target: { view: 'board' }
  },
  {
    id: 'projetos-tarefas',
    title: 'Tarefas, conclusão e cronômetro',
    blocks: [
      {
        type: 'p',
        text: 'Uma tarefa pode ter descrição, prioridade, prazo, etiquetas, imagens e sprint. O prazo alimenta a tela Próximas.'
      },
      {
        type: 'p',
        text: 'Mover uma tarefa para a coluna Done registra a conclusão e a leva para Concluídas. Restaurá-la a devolve para a primeira coluna ativa do projeto.'
      },
      {
        type: 'p',
        text: 'O cronômetro registra o tempo gasto. Várias tarefas podem ser cronometradas ao mesmo tempo, e cada uma guarda o total acumulado quando o cronômetro para.'
      }
    ],
    target: { view: 'board' }
  },
  {
    id: 'projetos-sprints',
    title: 'Sprints e Próximas',
    blocks: [
      {
        type: 'p',
        text: 'Sprints agrupam tarefas de um projeto em ciclos. O filtro de sprint muda o que aparece no board; uma tarefa sem sprint continua no projeto.'
      },
      {
        type: 'p',
        text: 'Fechar uma sprint registra o fim do ciclo; reabri-la permite continuar usando-a.'
      },
      {
        type: 'p',
        text: 'Próximas reúne as tarefas com prazo, para ver o que vence em breve e abrir a tarefa no projeto.'
      }
    ],
    target: { view: 'upcoming' }
  },
  {
    id: 'projetos-concluidas',
    title: 'Concluídas',
    blocks: [
      {
        type: 'p',
        text: 'Concluídas reúne as tarefas finalizadas de todos os projetos e permite abri-las ou devolvê-las ao fluxo de trabalho.'
      }
    ],
    target: { view: 'done' }
  }
]

const organizacao: GuideArticle[] = [
  {
    id: 'organizacao-planejamento',
    title: 'Planejamento',
    blocks: [
      { type: 'visual', id: 'planejamento' },
      {
        type: 'p',
        text: 'Blocos de tempo reservam um intervalo num dia. Eles podem representar uma tarefa, um hábito, uma rotina, uma pausa ou um compromisso livre.'
      },
      {
        type: 'p',
        text: 'Uma rotina define horário e dias da semana, e pode ser ativada ou desativada. O fim precisa ser depois do início.'
      },
      {
        type: 'p',
        text: 'Vincular um bloco a uma tarefa ou hábito ajuda a achar o contexto, mas não conclui o registro sozinho.'
      }
    ],
    target: { view: 'planejamento' }
  },
  {
    id: 'organizacao-canvas',
    title: 'Canvas',
    blocks: [
      {
        type: 'p',
        text: 'O Canvas é um espaço visual por projeto para notas livres. Você pode posicionar notas, conectá-las e vinculá-las a tarefas ou metas. Blocos de texto servem só de rótulo: têm tamanho e largura, mas não se conectam.'
      }
    ],
    target: { view: 'canvas' }
  },
  {
    id: 'organizacao-grafo',
    title: 'Grafo',
    blocks: [
      {
        type: 'p',
        text: 'O Grafo mostra as relações entre projetos, tarefas, notas, metas, hábitos, arquivos e memórias. O que não tem projeto fica ligado ao nó Geral. Dê dois cliques num nó para ir até o registro.'
      }
    ],
    target: { view: 'graph' }
  },
  {
    id: 'organizacao-arquivos',
    title: 'Arquivos',
    blocks: [
      {
        type: 'p',
        text: 'A biblioteca guarda arquivos neste computador e permite associá-los a um projeto. Comprovantes financeiros usam essa mesma biblioteca, e o texto de documentos entra na busca.'
      },
      {
        type: 'callout',
        tone: 'warning',
        text: 'Excluir um arquivo desfaz os vínculos dele com lançamentos financeiros.'
      }
    ],
    target: { view: 'files' }
  }
]

const metasHabitos: GuideArticle[] = [
  {
    id: 'metas-gerais',
    title: 'Metas',
    blocks: [
      { type: 'visual', id: 'meta-habito' },
      {
        type: 'p',
        text: 'Uma meta pode ser de quantidade (soma registros até o alvo, como "ler 10 livros") ou de conclusão (um objetivo único que você marca como feito).'
      },
      {
        type: 'p',
        text: 'A meta pode ser ligada a um projeto. Estas metas são independentes das metas financeiras de uma tabela.'
      }
    ],
    target: { view: 'goals' }
  },
  {
    id: 'metas-habitos',
    title: 'Hábitos',
    blocks: [
      {
        type: 'p',
        text: 'Marque os dias em que cumpriu um hábito. A tela mostra o que foi feito hoje e a sequência de dias.'
      },
      {
        type: 'p',
        text: 'Desmarcar um dia corrige o histórico. Hábitos valem para o app todo, sem depender do projeto ativo.'
      }
    ],
    target: { view: 'habits' }
  },
  {
    id: 'metas-relatorios',
    title: 'Relatórios',
    blocks: [
      {
        type: 'p',
        text: 'Relatórios resumem tarefas concluídas, ritmo por sprint e hábitos a partir dos registros existentes. Mudar esses registros muda os indicadores.'
      }
    ],
    target: { view: 'reports' }
  }
]

const financeiro: GuideArticle[] = [
  {
    id: 'financeiro-perfis',
    title: 'Perfis, tabelas e moedas',
    blocks: [
      { type: 'visual', id: 'perfis' },
      {
        type: 'p',
        text: 'O perfil separa contextos financeiros, como pessoal e trabalho. O perfil padrão é "Minhas finanças". Tabelas, consolidado, comprovantes e seletores mostram apenas o perfil ativo.'
      },
      {
        type: 'p',
        text: 'Cada tabela tem uma moeda fixa: real, dólar ou iene. Crie tabelas diferentes para contas ou moedas diferentes. Você pode informar banco ou app e um saldo real conferido à mão, que serve só de referência.'
      },
      {
        type: 'p',
        text: 'Categorias personalizadas são sugestões compartilhadas entre as tabelas do mesmo perfil. Remover uma sugestão não reclassifica lançamentos antigos.'
      }
    ],
    target: { view: 'financial' }
  },
  {
    id: 'financeiro-saldo',
    title: 'O que entra no saldo',
    blocks: [
      { type: 'visual', id: 'saldo' },
      {
        type: 'p',
        text: 'Entradas aumentam o saldo e saídas diminuem. Cada lançamento conta uma vez, na data registrada e na moeda da tabela.'
      },
      {
        type: 'p',
        text: '"Saldo até hoje" soma o histórico até hoje, limitado ao fim do mês selecionado. "Saldo projetado" inclui os lançamentos futuros já cadastrados até o fim do mês selecionado.'
      },
      {
        type: 'callout',
        tone: 'tip',
        text: 'Não há orçamento nem recorrência automática. Para um pagamento futuro, registre um lançamento com a data futura.'
      }
    ],
    target: { view: 'financial' }
  },
  {
    id: 'financeiro-compras',
    title: 'Lista de compras',
    blocks: [
      { type: 'visual', id: 'compras' },
      {
        type: 'p',
        text: 'Cada item tem nome, quantidade, preço por unidade e link. Ao marcar um item com preço como concluído, o app cria uma saída vinculada; desmarcar remove essa saída, e editar o item a atualiza.'
      },
      {
        type: 'callout',
        tone: 'warning',
        text: 'Excluir um item concluído também remove a transação criada por ele.'
      }
    ],
    target: { view: 'financial' }
  },
  {
    id: 'financeiro-detalhes',
    title: 'Detalhes, categorias e documentação',
    blocks: [
      {
        type: 'p',
        text: 'Um lançamento pode ser dividido em detalhes, cada um com descrição, valor, categoria e data da compra. A soma dos detalhes não pode passar do valor principal, e eles não criam novas entradas ou saídas.'
      },
      {
        type: 'p',
        text: 'Em "Documentar" você registra banco ou app, contraparte, referência bancária ou Pix e anexa comprovantes. Conferir com o extrato marca a verificação; mudar valor, data ou dados bancários remove a conferência.'
      }
    ],
    target: { view: 'financial' }
  },
  {
    id: 'financeiro-vinculos',
    title: 'Fatura, espelho e câmbio',
    blocks: [
      { type: 'visual', id: 'vinculos' },
      {
        type: 'p',
        text: 'Uma transação de outra tabela pode ser o espelho de um item da fatura. Vinculando o espelho ao detalhe da fatura, o Consolidado mantém a fatura e omite só o espelho.'
      },
      {
        type: 'p',
        text: 'Para câmbio, cadastre uma saída numa tabela e uma entrada noutra do mesmo perfil, com moedas diferentes, e vincule as duas. As duas pontas continuam nos saldos; a tarifa é só informativa.'
      }
    ],
    target: { view: 'financial' }
  },
  {
    id: 'financeiro-leitura',
    title: 'Consolidado, análise e metas financeiras',
    blocks: [
      { type: 'visual', id: 'leitura' },
      {
        type: 'p',
        text: 'O Consolidado reúne as tabelas do perfil ativo, sem espelhos. Reais, dólares e ienes nunca são somados entre si; a equivalência convertida usa a cotação do momento e serve só para consulta.'
      },
      {
        type: 'p',
        text: 'A meta financeira pertence a uma tabela, com valor alvo e mês de prazo. Quando o alvo só é alcançado por lançamentos futuros, aparece como previsão.'
      },
      {
        type: 'p',
        text: 'Rendimentos registrados por dia viram um único lançamento "Rendimentos" por mês, no dia 1.'
      }
    ],
    target: { view: 'financial' }
  },
  {
    id: 'financeiro-excluir-tabela',
    title: 'Excluir uma tabela',
    blocks: [
      {
        type: 'callout',
        tone: 'danger',
        text: 'Excluir uma tabela remove seus itens de compras, lançamentos, metas e rendimentos, e desfaz os vínculos de outras tabelas com ela. Faça um backup ou exporte o Excel antes, se quiser guardar o histórico.'
      }
    ],
    target: { view: 'financial' }
  }
]

const sessoesCodigo: GuideArticle[] = [
  {
    id: 'sessoes-o-que-e',
    title: 'O que são as sessões de código',
    blocks: [
      {
        type: 'p',
        text: 'Em Sessões de código você abre um agente de código (Codex, Claude Code ou OpenCode) num terminal dentro do Sagyou. O agente precisa estar instalado e com a sua conta configurada nele; o Sagyou não usa chave de API.'
      },
      {
        type: 'steps',
        items: [
          'Abra Sessões de código na barra lateral.',
          'Escolha o escopo: um projeto com pasta de código autorizada, ou uma sessão geral.',
          'Escolha o agente. A sessão abre direto na tela do próprio agente.',
          'Escreva o pedido no terminal, como faria fora do Sagyou.'
        ]
      }
    ],
    target: { view: 'ai' }
  },
  {
    id: 'sessoes-pasta-isolada',
    title: 'Pasta isolada e alterações',
    blocks: [
      {
        type: 'p',
        text: 'Cada sessão trabalha numa cópia isolada do código, nunca na pasta original. Ao sair do agente, o Sagyou guarda o registro do terminal e as alterações feitas, que você revisa no histórico da sessão.'
      },
      {
        type: 'callout',
        tone: 'tip',
        text: 'O histórico de cada sessão fica guardado por 24 horas.'
      }
    ],
    target: { view: 'ai' }
  },
  {
    id: 'sessoes-mcp',
    title: 'Como o agente acessa seus dados',
    blocks: [
      { type: 'visual', id: 'sessoes' },
      {
        type: 'p',
        text: 'O agente lê e altera projetos, tarefas, metas, notas, finanças e memórias só por uma ponte própria do Sagyou (MCP), válida enquanto o terminal estiver aberto.'
      },
      {
        type: 'p',
        text: 'Exclusões, valores em dinheiro, arquivar projetos e criar tabelas ou perfis financeiros sempre mostram um cartão de aprovação. O cartão espera 5 minutos; sem resposta, a ação é recusada.'
      },
      {
        type: 'callout',
        tone: 'warning',
        text: 'O modo automático da sessão aprova escritas simples, mas nunca responde um cartão de exclusão ou de dinheiro.'
      }
    ],
    target: { view: 'ai' }
  },
  {
    id: 'sessoes-memoria',
    title: 'Memória e resumo da sessão',
    blocks: [
      {
        type: 'p',
        text: 'Memória guarda decisões e fatos úteis entre sessões. Você pode fixar, arquivar, restaurar ou excluir cada memória. Memórias pouco usadas são arquivadas sozinhas com o tempo; as fixadas nunca.'
      },
      {
        type: 'p',
        text: 'Ao fechar um terminal, o Sagyou atualiza uma memória de resumo da sessão daquele projeto, com o pedido, o resultado e os arquivos alterados.'
      }
    ],
    target: { view: 'memory' }
  },
  {
    id: 'mcp-externo',
    title: 'Acesso MCP externo (Claude fora do Fleet)',
    blocks: [
      {
        type: 'p',
        text: 'Para um Claude Code aberto fora das Sessões de código (por exemplo, com o Remote Control pelo app do Claude no celular) ler e editar o Sagyou neste PC. O token dá acesso total: todos os projetos, todos os perfis financeiros e todas as ações. Ele não vence: vale até você gerar outro ou revogar.'
      },
      {
        type: 'steps',
        items: [
          'Abra Configurações → Acesso MCP externo.',
          'Clique em Gerar acesso e em Copiar comando: o token só aparece agora.',
          'Cole o comando num terminal do PC. Ele registra o servidor sagyou-externo no Claude Code.',
          'Abra o Claude Code e peça, por exemplo, as tarefas do projeto.'
        ]
      },
      {
        type: 'callout',
        tone: 'warning',
        text: 'Excluir, mexer em dinheiro, arquivar projeto e criar tabelas ou perfis financeiros pede aprovação: um cartão abre no PC e no celular autorizado (aba PC), e a primeira resposta vale. Sem resposta em 5 minutos, a ação é recusada. Criar e editar tarefas, notas, metas e memórias não pedem. Nas finanças, o Claude escolhe o perfil pela tabela ou pelo profileId; sem ele, usa o perfil ativo no PC.'
      },
      {
        type: 'p',
        text: 'O Sagyou precisa estar aberto. Gerar novo token troca o token na hora (o comando do Claude Code precisa ser trocado também), e Revogar corta o acesso imediatamente.'
      },
      {
        type: 'p',
        text: 'Com senha no Sagyou, o token para quando a tela bloqueia, a não ser que você ligue Ler com o Sagyou bloqueado. Ligado, o Claude continua lendo com a tela na senha, mas não escreve: para escrever, desbloqueie no PC ou pelo celular (aba PC).'
      },
      {
        type: 'callout',
        tone: 'tip',
        text: 'Para usar de longe, deixe o PC ligado sem suspender (Windows → Energia) e o Sagyou aberto. Se ele bloquear, desbloqueie pelo celular (aba PC) para o Claude voltar a escrever.'
      },
      {
        type: 'p',
        text: 'Se o celular cortar o acesso (Cortar acesso, na aba PC), o token para de responder até alguém tocar em Restaurar acesso: no celular, com o código do autenticador, ou aqui, em Configurações → Acesso MCP externo. Gerar outro token não desfaz o corte.'
      },
      {
        type: 'callout',
        tone: 'tip',
        text: 'O token fica salvo em texto na configuração do Claude Code (~/.claude.json). Se o PC sumir, revogue o aparelho na sincronização com apagar dados: o token vai junto.'
      }
    ],
    target: { view: 'settings', section: 'mcp-externo' }
  },
  {
    id: 'controle-remoto',
    title: 'Controle remoto pelo celular',
    blocks: [
      {
        type: 'p',
        text: 'Com o modo controlado ligado, o celular autorizado liga, desliga, desbloqueia e bloqueia este PC, e aprova os cartões do Fleet e do acesso MCP externo. Só funciona no Windows, com a sincronização ativa e a senha do Sagyou configurada.'
      },
      {
        type: 'steps',
        items: [
          'Abra Configurações → Controle remoto e ligue Controlar este PC pelo celular (pede o código do autenticador).',
          'No celular, abra Ajustes → Controlar o PC → Pedir autorização.',
          'Confira se o código de 6 dígitos é o mesmo nas duas telas e clique em Autorizar, com a senha do Sagyou.',
          'Em Servidores de Remote Control, adicione os nomes usados em --name: o PC só aparece Pronto com todos rodando.'
        ]
      },
      {
        type: 'p',
        text: 'Os pedidos passam cifrados pelo seu Worker, que não lê os dados: ele só vê identificadores de aparelho, tamanhos e horários. Cada pedido é assinado pela chave do celular e vale 60 segundos, e repetir um pedido não funciona. Cinco pedidos recusados seguidos suspendem o desbloqueio e o desligamento remotos por 15 minutos.'
      },
      {
        type: 'p',
        text: 'Para ligar o PC desligado, um ESP32 na mesma rede envia o pacote mágico. Em Token do ESP32, gere o token e a chave e cole os dois no secrets.h. O comando do ESP32 é assinado com essa chave: nem o Worker consegue forjar ou repetir um comando.'
      },
      {
        type: 'callout',
        tone: 'warning',
        text: 'Desligar salva o Sagyou e agenda o desligamento do Windows em 60 segundos, que o celular pode cancelar. Se o Sagyou não conseguir salvar, o PC não desliga.'
      },
      {
        type: 'p',
        text: 'Cortar acesso, na aba PC do celular, é o botão de emergência: o acesso MCP externo para, os servidores de Remote Control são encerrados (e de novo a cada 30 segundos, se voltarem) e o Sagyou é bloqueado. O PC continua ligado. Se o PC não responder em 1 minuto, o celular oferece desligar pelo ESP32.'
      },
      {
        type: 'p',
        text: 'Para voltar, toque em Restaurar acesso no celular, com a biometria e o código do autenticador ou um código reserva, ou clique em Restaurar acesso no PC, em Configurações → Controle remoto. Enquanto o acesso está cortado, a bandeja mostra Acesso cortado pelo celular.'
      },
      {
        type: 'p',
        text: 'As notificações no celular (PC pronto, aprovação pendente, PC não desligado) são opcionais: precisam de um projeto no Firebase, do segredo FCM_SERVICE_ACCOUNT no Worker e de um APK gerado com o google-services.json. Sem isso, tudo funciona, só sem notificações.'
      },
      {
        type: 'callout',
        tone: 'tip',
        text: 'Perdeu o celular autorizado longe de casa? Veja Trocar de celular longe de casa, na sincronização.'
      }
    ],
    target: { view: 'settings', section: 'controle-remoto' }
  }
]

const dadosSeguranca: GuideArticle[] = [
  {
    id: 'dados-backup',
    title: 'Backup e exportação',
    blocks: [
      {
        type: 'p',
        text: 'O app guarda cópias automáticas enquanto é usado e mantém as sete mais recentes. No menu de opções da barra lateral você abre a pasta dessas cópias, exporta um backup manual ou importa um.'
      },
      {
        type: 'callout',
        tone: 'warning',
        text: 'Importar um backup substitui todos os dados atuais. Antes disso o app cria um ponto de restauração. Guarde uma cópia fora do computador.'
      },
      {
        type: 'p',
        text: 'A exportação para Excel é um relatório para leitura. A planilha "Todas transações" abrange todos os perfis, tabelas e meses.'
      }
    ]
  },
  {
    id: 'dados-senha',
    title: 'Senha e bloqueio automático',
    blocks: [
      {
        type: 'p',
        text: 'A senha do app bloqueia o acesso ao abrir o Sagyou. Com ela ativa, você pode bloquear o app sozinho depois de um tempo sem uso ou quando o Windows bloquear a tela.'
      },
      {
        type: 'callout',
        tone: 'danger',
        text: 'A senha não pode ser recuperada pelo app e não faz parte dos backups: restaurar um backup não troca a senha deste computador. Guarde-a num lugar seguro.'
      }
    ],
    target: { view: 'settings', section: 'seguranca' }
  },
  {
    id: 'dados-atualizacao',
    title: 'Atualização automática',
    blocks: [
      {
        type: 'p',
        text: 'Ao abrir, o Sagyou procura uma versão nova. Quando encontra, baixa em segundo plano e oferece reiniciar para instalar; seus dados são salvos antes.'
      },
      {
        type: 'p',
        text: 'Enquanto uma atualização espera para ser instalada, a sincronização fica em espera, para que versões diferentes não troquem dados.'
      }
    ],
    target: { view: 'settings', section: 'sistema' }
  },
  {
    id: 'dados-diagnostico',
    title: 'Registro de diagnóstico',
    blocks: [
      {
        type: 'p',
        text: 'O app anota eventos técnicos (erros, sincronização, atualizações) na pasta logs, dentro da pasta de dados do app, por 14 dias. O registro nunca guarda o texto de tarefas e notas, valores em dinheiro ou senhas.'
      }
    ]
  }
]

export const GUIDE_CHAPTERS: GuideChapter[] = [
  { id: 'primeiros-passos', label: 'Primeiros passos', articles: primeirosPassos },
  { id: 'projetos', label: 'Projetos e tarefas', articles: projetos },
  { id: 'organizacao', label: 'Organização', articles: organizacao },
  { id: 'metas-habitos', label: 'Metas e hábitos', articles: metasHabitos },
  { id: 'financeiro', label: 'Financeiro', articles: financeiro },
  { id: 'sessoes-codigo', label: 'Sessões de código', articles: sessoesCodigo },
  { id: 'sincronizacao', label: 'Sincronização e celular', articles: SYNC_ARTICLES },
  { id: 'dados-seguranca', label: 'Dados e segurança', articles: dadosSeguranca }
]

export function findArticle(id: string): { chapter: GuideChapter; article: GuideArticle } | null {
  for (const chapter of GUIDE_CHAPTERS) {
    const article = chapter.articles.find((candidate) => candidate.id === id)
    if (article) return { chapter, article }
  }
  return null
}
