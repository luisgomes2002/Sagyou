import { useState } from 'react'

interface GuideTopic {
  title: string
  points: string[]
}

interface GuideSection {
  id: string
  label: string
  intro: string
  topics: GuideTopic[]
}

const sections: GuideSection[] = [
  {
    id: 'visao-geral',
    label: 'Visão geral',
    intro: 'O Sagyou reúne trabalho, rotina e finanças pessoais em um só lugar.',
    topics: [
      {
        title: 'Onde ficam seus dados',
        points: [
          'O app funciona localmente. Projetos, tarefas, hábitos, metas e registros financeiros são salvos neste computador; não há uma conta online sincronizando esses dados.',
          'O Início reúne um retrato das áreas do app. Os números financeiros respeitam o perfil selecionado; ao escolher uma tabela, os valores aparecem na moeda própria dela.',
          'A busca global encontra registros e conversas. Ela ajuda a localizar informações, mas os dados continuam em suas áreas de origem.'
        ]
      },
      {
        title: 'Backup e exportação',
        points: [
          'O app guarda uma cópia automática por dia enquanto é usado. No menu de opções você pode abrir a pasta dessas cópias ou exportar um backup manual.',
          'Importar um backup substitui os dados atuais; antes disso, o app tenta criar um ponto de restauração. Guarde uma cópia fora do computador para se proteger contra perda do dispositivo.',
          'A exportação para Excel é um relatório para leitura. A opção “Todas transações” abrange todos os perfis, tabelas e meses, independentemente do período aberto na tela.'
        ]
      }
    ]
  },
  {
    id: 'projetos',
    label: 'Projetos e tarefas',
    intro: 'Organize o trabalho por projeto, coluna e, quando fizer sentido, sprint.',
    topics: [
      {
        title: 'Projetos e board',
        points: [
          'Cada projeto tem seu próprio quadro de colunas. Ao criar um projeto, o quadro começa com Backlog, In Progress, Review e Done; você pode organizar as colunas e mover tarefas entre elas.',
          'Arquivar tira o projeto da lista principal sem apagar seu conteúdo. Excluir o projeto remove também suas tarefas; excluir uma coluna remove as tarefas que estiverem nela.',
          'O projeto pode guardar descrição e links úteis. A seleção de projeto define o contexto do board, canvas, arquivos e chat.'
        ]
      },
      {
        title: 'Tarefas, conclusão e tempo',
        points: [
          'Uma tarefa pode ter descrição, prioridade, prazo, etiquetas, imagens e vínculo com uma sprint. O prazo alimenta a tela Próximas.',
          'Mover uma tarefa para a coluna Done registra sua conclusão e a leva para Concluídas. Restaurá-la a devolve para a primeira coluna ativa do projeto.',
          'O cronômetro registra tempo gasto na tarefa. A tarefa conserva o total acumulado mesmo depois que o cronômetro é parado.'
        ]
      },
      {
        title: 'Sprints e próximas entregas',
        points: [
          'Sprints agrupam tarefas de um projeto em ciclos. O filtro de sprint muda o que aparece no board; uma tarefa sem sprint continua no projeto.',
          'Fechar uma sprint registra o fim do ciclo. Reabri-la permite continuar usando-a. Os relatórios usam as conclusões para mostrar o andamento dos ciclos.',
          'Próximas reúne tarefas com prazo, para enxergar o que vence em breve e abrir a tarefa no projeto correspondente.'
        ]
      }
    ]
  },
  {
    id: 'organizacao',
    label: 'Planejamento e notas',
    intro: 'As visões de organização conectam compromissos, ideias e tarefas.',
    topics: [
      {
        title: 'Planejamento',
        points: [
          'Blocos de tempo reservam um intervalo em um dia. Eles podem representar uma tarefa, um hábito, uma rotina, uma pausa ou um compromisso livre.',
          'Uma rotina define horário e dias da semana. Você pode ativá-la ou desativá-la; os blocos do planejamento e as rotinas têm papéis diferentes, então ajuste o dia conforme a realidade.',
          'Vincular um bloco a uma tarefa ou hábito facilita encontrar o contexto do compromisso, sem concluir automaticamente esse registro.'
        ]
      },
      {
        title: 'Canvas e grafo',
        points: [
          'O Canvas é um espaço visual por projeto para notas livres. Você pode posicionar notas, conectá-las e vinculá-las a tarefas ou metas.',
          'O Grafo mostra as relações entre registros. Ele serve para explorar e navegar até um projeto, tarefa, nota, meta, hábito ou arquivo.'
        ]
      },
      {
        title: 'Arquivos',
        points: [
          'A biblioteca guarda arquivos locais e permite associá-los a um projeto. Comprovantes financeiros usam arquivos dessa mesma biblioteca.',
          'Ao excluir um arquivo, os vínculos dele com lançamentos financeiros deixam de existir. Backups incluem os arquivos, além dos registros que os mencionam.'
        ]
      }
    ]
  },
  {
    id: 'metas-habitos',
    label: 'Metas e hábitos',
    intro: 'Acompanhe resultados acumulados e a constância da rotina.',
    topics: [
      {
        title: 'Metas gerais',
        points: [
          'Uma meta geral tem título, alvo, unidade e registros de progresso. O valor atual é a soma dos registros; ela aparece como concluída quando a soma alcança ou supera o alvo.',
          'Você pode associar a meta a um projeto. Estas metas são independentes das metas financeiras de uma tabela.'
        ]
      },
      {
        title: 'Hábitos',
        points: [
          'Marque os dias em que cumpriu um hábito. A visão mostra o que foi feito hoje e o histórico de constância.',
          'Desmarcar um dia corrige o histórico daquele hábito. Hábitos são compartilhados no app, sem depender do projeto ativo.'
        ]
      },
      {
        title: 'Relatórios e concluídas',
        points: [
          'Relatórios resumem tarefas concluídas, ritmo por sprint e hábitos usando os registros existentes. Mudanças nesses registros alteram os indicadores.',
          'Concluídas reúne tarefas finalizadas de todos os projetos e permite abri-las ou restaurá-las ao fluxo de trabalho.'
        ]
      }
    ]
  },
  {
    id: 'financeiro-base',
    label: 'Financeiro: estrutura',
    intro:
      'Comece escolhendo um perfil e criando tabelas que representem suas contas, cartões ou controles.',
    topics: [
      {
        title: 'Perfis, tabelas e moedas',
        points: [
          'O perfil separa contextos financeiros, como pessoal e trabalho. O perfil padrão é “Minhas finanças”. Tabelas, consolidado, comprovantes e seletores financeiros mostram apenas o perfil ativo.',
          'Cada tabela tem uma moeda fixa: real, dólar ou iene. Os lançamentos e metas de uma tabela usam essa moeda. Crie tabelas diferentes para contas ou moedas diferentes.',
          'Você pode informar banco ou app e um saldo real conferido manualmente. O saldo real é uma referência informada por você; ele não substitui o saldo calculado pelos lançamentos.',
          'Categorias personalizadas são sugestões compartilhadas entre tabelas do mesmo perfil. Remover uma sugestão não reclassifica lançamentos antigos; as categorias já usadas continuam nos filtros do histórico.'
        ]
      },
      {
        title: 'O que entra no saldo',
        points: [
          'Entradas aumentam o saldo e saídas diminuem. O valor do lançamento é contado uma vez, na data registrada e na moeda da tabela.',
          'Os valores exibidos podem ser arredondados para a moeda, mas o registro original é preservado. Em ienes, os resumos mostram valores inteiros.',
          'Não há orçamento nem recorrência automática no financeiro atual. Para representar um pagamento futuro, registre um lançamento com a data futura.'
        ]
      },
      {
        title: 'Excluir uma tabela',
        points: [
          'Excluir uma tabela remove seus itens de compras, lançamentos, metas e rendimentos. Vínculos de lançamentos de outras tabelas com ela são desfeitos.',
          'A exclusão pede confirmação. Se você precisa conservar o histórico fora do app, faça um backup ou exporte o Excel antes.'
        ]
      }
    ]
  },
  {
    id: 'financeiro-compras',
    label: 'Financeiro: compras',
    intro: 'A lista de compras pode alimentar os lançamentos da mesma tabela.',
    topics: [
      {
        title: 'Itens e valores',
        points: [
          'Cada item pode ter nome, quantidade, preço por unidade e link. O total estimado do item é quantidade × preço; os resumos distinguem o total planejado do total marcado como concluído.',
          'Ao marcar um item com preço como concluído, o app cria uma saída vinculada em Finanças. Desmarcar remove o lançamento vinculado. Alterar nome, quantidade ou preço de um item marcado atualiza esse lançamento.',
          'Excluir um item concluído também remove a transação criada por ele. Antes de excluir, confira se ela representa um gasto que você deseja manter no histórico.'
        ]
      }
    ]
  },
  {
    id: 'financeiro-lancamentos',
    label: 'Financeiro: lançamentos',
    intro: 'A data e o tipo de cada lançamento determinam quando e como ele afeta os saldos.',
    topics: [
      {
        title: 'Entradas, saídas e período',
        points: [
          'A aba Finanças lista os lançamentos do mês selecionado. Uma entrada soma e uma saída subtrai. O saldo do mês é entradas menos saídas daquele mês.',
          '“Saldo até hoje” soma o histórico até a data local atual, limitado ao fim do mês selecionado. Se você estiver olhando um mês passado, ele mostra o saldo até aquele mês.',
          '“Saldo projetado” inclui os lançamentos datados até o último dia do mês selecionado. No mês atual, a diferença entre os dois saldos revela o efeito de lançamentos futuros já cadastrados.',
          'Filtros de categoria e de comprovantes ajudam a examinar a lista. O filtro de comprovantes não altera os cartões de saldo.'
        ]
      },
      {
        title: 'Detalhes e categorias',
        points: [
          'Você pode dividir um lançamento em detalhes, cada um com descrição, valor, categoria e, opcionalmente, data da compra. A soma dos detalhes não pode ultrapassar o valor principal.',
          'Detalhes repartem o lançamento: eles não criam novas entradas ou saídas no saldo. Na análise por categoria, cada detalhe usa sua categoria e só o restante fica na categoria do lançamento principal.',
          'Se uma fatura estiver na categoria Cartão, os itens detalhados aparecem nas categorias deles e somente o valor não detalhado permanece em Cartão. A data do lançamento principal continua sendo a data contábil; a data de um detalhe pode orientar a análise da compra.'
        ]
      },
      {
        title: 'Documentação e conferência',
        points: [
          'Em “Documentar”, você pode registrar banco ou app, contraparte, referência bancária ou Pix e anexar comprovantes. A aba Comprovantes reúne os arquivos vinculados a lançamentos de todas as tabelas e meses do perfil ativo.',
          'Conferir um lançamento com o extrato marca essa verificação. Alterar valor, data ou dados bancários remove a conferência, pois o lançamento precisa ser verificado de novo.',
          'Edições novas ficam no histórico do lançamento. Um registro antigo pode não ter data de criação conhecida; isso não significa que foi criado na data da primeira edição.'
        ]
      }
    ]
  },
  {
    id: 'financeiro-vinculos',
    label: 'Financeiro: vínculos e câmbio',
    intro:
      'Vincule movimentos entre tabelas para ler o consolidado sem contar a mesma despesa duas vezes.',
    topics: [
      {
        title: 'Fatura e transação espelho',
        points: [
          'Uma transação de outra tabela pode representar um item já incluído na fatura. Ao vincular esse espelho ao detalhe da fatura, o consolidado mantém a fatura e omite somente o espelho.',
          'Um vínculo antigo feito diretamente entre lançamentos segue a regra legada: o consolidado omite o lançamento principal vinculado. Revise os vínculos ao interpretar totais antigos.',
          'O vínculo afeta a soma do Consolidado; os lançamentos continuam visíveis em suas tabelas de origem.'
        ]
      },
      {
        title: 'Transferência entre moedas',
        points: [
          'Para representar câmbio, cadastre uma saída em uma tabela e uma entrada em outra tabela do mesmo perfil, com moedas diferentes, e vincule as duas pontas.',
          'As duas pontas continuam nos saldos nativos. A taxa mostrada é calculada a partir dos valores originais informados. A tarifa do par é apenas informativa: se ela também saiu de uma conta, registre essa saída separadamente.',
          'O par de câmbio não é um espelho de fatura. Ele liga os dois movimentos sem esconder uma das pontas.'
        ]
      }
    ]
  },
  {
    id: 'financeiro-leitura',
    label: 'Financeiro: análise e metas',
    intro: 'Use as visões de leitura para entender resultados sem alterar seus lançamentos.',
    topics: [
      {
        title: 'Consolidado e conversão',
        points: [
          'O Consolidado reúne as tabelas do perfil ativo e exclui espelhos para evitar duplicidade. Entradas, saídas e saldos nativos são mostrados separadamente por moeda: reais, dólares e ienes não são somados entre si.',
          'A equivalência convertida, quando disponível, usa cotações consultadas em tempo real. É uma referência de leitura: não modifica valores salvos nem substitui os totais por moeda.',
          'O recorte mensal também limita os saldos do Consolidado. Você pode expandir o saldo de cada tabela para entender sua contribuição.'
        ]
      },
      {
        title: 'Análise por período e categoria',
        points: [
          'A aba Análise mostra evolução de entradas e saídas e distribuição por categoria na tabela selecionada. O fluxo de caixa usa a data do lançamento principal.',
          'Um detalhe com data de compra própria pode ser atribuído a essa data na análise por categoria. Ele continua sendo apenas uma parte do lançamento original.'
        ]
      },
      {
        title: 'Metas financeiras',
        points: [
          'A meta financeira pertence a uma tabela e define um valor alvo e um mês de prazo. Ela acompanha o saldo daquela tabela, na moeda da tabela.',
          'O app compara a meta com o saldo dentro do período selecionado e até o prazo da própria meta. Quando o alvo só é alcançado por lançamentos futuros, isso aparece como previsão.',
          'Você pode registrar a conclusão com data e observação e consultar o histórico. As metas financeiras são separadas das metas gerais da seção Metas.'
        ]
      },
      {
        title: 'Rendimentos',
        points: [
          'Crie fontes de rendimento e registre valores por dia. O app soma os registros do mês e cria ou atualiza um único lançamento de entrada “Rendimentos” na tabela.',
          'O resumo mensal usa o dia 1 para participar do saldo desde o começo do mês. Se você apagar todos os registros daquele mês, o resumo correspondente é removido.',
          'Se existirem resumos mensais duplicados, o app pede que você escolha qual manter. Rendimentos entram no saldo por meio do resumo, sem somar cada registro diário outra vez.'
        ]
      }
    ]
  },
  {
    id: 'assistente',
    label: 'Assistente e agentes',
    intro:
      'O chat ajuda a consultar e organizar informações; ações que escrevem dados exigem sua aprovação.',
    topics: [
      {
        title: 'Chat e contexto',
        points: [
          'O Chat pode responder sobre projetos, tarefas e outras áreas, usando o contexto disponível. Nas leituras financeiras, ele respeita o perfil financeiro ativo.',
          'A conversa fica no histórico local. Ao enviar arquivos ou imagens, considere que o conteúdo pode ser encaminhado ao serviço de IA configurado para responder.',
          'Quando uma ação do assistente cria ou modifica registros, o app apresenta uma aprovação antes de executá-la. Revise especialmente valores, datas e exclusões.'
        ]
      },
      {
        title: 'Memória e agentes',
        points: [
          'Memória guarda fatos e decisões úteis entre conversas. Você pode inspecionar, fixar, arquivar, restaurar ou excluir essas lembranças.',
          'Agentes mostram execuções em andamento e atividades de trabalho mais longas. O resultado produzido por IA merece revisão antes de ser usado como decisão final.'
        ]
      }
    ]
  }
]

function VisualBox({
  label,
  value,
  detail,
  color = 'text-[#d4d4d4]'
}: {
  label: string
  value: string
  detail?: string
  color?: string
}): React.JSX.Element {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-[#3b3b3b] bg-[#2a2a2a] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#999999]">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${color}`}>{value}</p>
      {detail && <p className="mt-1 text-[11px] leading-4 text-[#999999]">{detail}</p>}
    </div>
  )
}

function GuideVisual({ sectionId }: { sectionId: string }): React.JSX.Element {
  if (sectionId === 'projetos') {
    return (
      <div className="grid gap-2 sm:grid-cols-4">
        {[
          ['Backlog', 'Ideias e tarefas'],
          ['In Progress', 'Em andamento'],
          ['Review', 'Para revisar'],
          ['Done', 'Concluída']
        ].map(([name, detail], index) => (
          <div key={name} className="rounded-lg border border-[#3b3b3b] bg-[#2a2a2a] p-3">
            <p className="text-xs font-semibold text-white">{name}</p>
            <div className="mt-3 rounded border border-[#4a4a4a] bg-[#232323] px-2 py-2 text-[11px] text-[#b8b8b8]">
              {detail}
            </div>
            {index < 3 && <p className="mt-2 text-right text-xs text-[#a080f0]">→</p>}
          </div>
        ))}
      </div>
    )
  }

  if (sectionId === 'organizacao') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-lg border border-[#3b3b3b] bg-[#2a2a2a] p-3">
          <span className="w-16 shrink-0 text-xs text-[#999999]">09:00</span>
          <div className="flex-1 rounded border-l-2 border-[#a080f0] bg-[#232323] px-3 py-2 text-xs text-white">
            Bloco: trabalhar na tarefa
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-[#3b3b3b] bg-[#2a2a2a] p-3">
          <span className="w-16 shrink-0 text-xs text-[#999999]">11:00</span>
          <div className="flex-1 rounded border-l-2 border-[#46d478] bg-[#232323] px-3 py-2 text-xs text-white">
            Rotina: fazer uma pausa
          </div>
        </div>
        <p className="text-xs text-[#999999]">
          Vincular organiza o dia; cumprir ou concluir é uma ação separada.
        </p>
      </div>
    )
  }

  if (sectionId === 'metas-habitos') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[#3b3b3b] bg-[#2a2a2a] p-4">
          <div className="flex justify-between text-xs">
            <span>Meta: ler 10 livros</span>
            <strong>6 / 10</strong>
          </div>
          <div className="mt-3 h-2 rounded-full bg-[#3b3b3b]">
            <div className="h-2 w-3/5 rounded-full bg-[#a080f0]" />
          </div>
          <p className="mt-2 text-[11px] text-[#999999]">Os registros somam o progresso.</p>
        </div>
        <div className="rounded-lg border border-[#3b3b3b] bg-[#2a2a2a] p-4">
          <p className="text-xs">Hábito: caminhar</p>
          <div className="mt-3 flex gap-1.5">
            {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((day, index) => (
              <span
                key={index}
                className={`flex h-7 w-7 items-center justify-center rounded text-[10px] ${index < 4 ? 'bg-[#2e7a48] text-white' : 'bg-[#3b3b3b] text-[#999999]'}`}
              >
                {day}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[#999999]">
            Cada marcação representa um dia cumprido.
          </p>
        </div>
      </div>
    )
  }

  if (sectionId === 'financeiro-base') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[#3b3b3b] bg-[#2a2a2a] p-4">
          <p className="text-xs font-semibold text-[#a080f0]">Perfil pessoal</p>
          <div className="mt-3 space-y-2 text-xs text-[#d4d4d4]">
            <p className="rounded bg-[#232323] p-2">Conta corrente · BRL</p>
            <p className="rounded bg-[#232323] p-2">Cartão · BRL</p>
          </div>
        </div>
        <div className="rounded-lg border border-[#3b3b3b] bg-[#2a2a2a] p-4">
          <p className="text-xs font-semibold text-[#46d478]">Perfil trabalho</p>
          <div className="mt-3 space-y-2 text-xs text-[#d4d4d4]">
            <p className="rounded bg-[#232323] p-2">Recebimentos · USD</p>
            <p className="rounded bg-[#232323] p-2">Despesas · BRL</p>
          </div>
        </div>
        <p className="sm:col-span-2 text-xs text-[#999999]">
          O Consolidado reúne somente as tabelas do perfil escolhido.
        </p>
      </div>
    )
  }

  if (sectionId === 'financeiro-compras') {
    return (
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <VisualBox label="Lista de compras" value="2 × R$ 15,00" detail="Item com preço" />
        <span className="text-center text-lg text-[#a080f0]">→</span>
        <VisualBox
          label="Ao marcar como feito"
          value="Saída de R$ 30,00"
          detail="Lançamento vinculado em Finanças"
          color="text-[#e88282]"
        />
        <span className="text-center text-lg text-[#a080f0]">→</span>
        <VisualBox
          label="Ao desmarcar"
          value="Saída removida"
          detail="O item volta à lista pendente"
        />
      </div>
    )
  }

  if (sectionId === 'financeiro-lancamentos') {
    return (
      <div>
        <div className="grid gap-2 sm:grid-cols-3">
          <VisualBox label="Saldo anterior" value="R$ 500,00" />
          <VisualBox
            label="Até hoje"
            value="R$ 400,00"
            detail="Saída de R$ 100 já registrada"
            color="text-[#a080f0]"
          />
          <VisualBox
            label="Projetado"
            value="R$ 350,00"
            detail="Inclui saída futura de R$ 50"
            color="text-[#e0a040]"
          />
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-[#999999]">
          <span>Passado</span>
          <span className="h-px flex-1 bg-[#4a4a4a]" />
          <span className="text-[#a080f0]">Hoje</span>
          <span className="h-px flex-1 bg-[#4a4a4a]" />
          <span>Fim do mês</span>
        </div>
        <p className="mt-3 text-xs text-[#999999]">
          Exemplo ilustrativo. O período selecionado determina o corte dos saldos.
        </p>
      </div>
    )
  }

  if (sectionId === 'financeiro-vinculos') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[#3b3b3b] bg-[#2a2a2a] p-4">
          <p className="text-xs font-semibold text-white">Fatura e espelho</p>
          <p className="mt-2 text-xs text-[#b8b8b8]">Fatura R$ 100,00 + espelho R$ 30,00</p>
          <p className="mt-2 text-sm font-semibold text-[#46d478]">Consolidado: R$ 100,00</p>
          <p className="mt-1 text-[11px] text-[#999999]">
            Com vínculo no detalhe, o espelho sai da soma.
          </p>
        </div>
        <div className="rounded-lg border border-[#3b3b3b] bg-[#2a2a2a] p-4">
          <p className="text-xs font-semibold text-white">Câmbio entre tabelas</p>
          <p className="mt-2 text-xs text-[#b8b8b8]">Saída em BRL → entrada em USD</p>
          <p className="mt-2 text-sm font-semibold text-[#a080f0]">Ambas as pontas permanecem</p>
          <p className="mt-1 text-[11px] text-[#999999]">
            Cada saldo continua na moeda da sua tabela.
          </p>
        </div>
      </div>
    )
  }

  if (sectionId === 'financeiro-leitura') {
    return (
      <div className="grid gap-2 sm:grid-cols-3">
        <VisualBox
          label="Saldo em reais"
          value="R$ 1.200,00"
          detail="Valor nativo"
          color="text-[#46d478]"
        />
        <VisualBox
          label="Saldo em dólares"
          value="US$ 80,00"
          detail="Valor nativo"
          color="text-[#46d478]"
        />
        <VisualBox
          label="Equivalência"
          value="Cotação do momento"
          detail="Somente para consulta; não altera lançamentos"
          color="text-[#a080f0]"
        />
      </div>
    )
  }

  if (sectionId === 'assistente') {
    return (
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <VisualBox label="Você pede" value="Criar uma tarefa" />
        <span className="text-center text-lg text-[#a080f0]">→</span>
        <VisualBox
          label="Você revisa"
          value="Ação proposta"
          detail="Confira os dados antes de aprovar"
        />
        <span className="text-center text-lg text-[#a080f0]">→</span>
        <VisualBox label="Após aprovação" value="Registro criado" />
      </div>
    )
  }

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <VisualBox label="Organizar" value="Projetos e tarefas" />
      <VisualBox label="Acompanhar" value="Metas e hábitos" />
      <VisualBox label="Controlar" value="Finanças por perfil" />
    </div>
  )
}

export function GuideView(): React.JSX.Element {
  const [activeId, setActiveId] = useState(sections[0].id)
  const activeSection = sections.find((section) => section.id === activeId) ?? sections[0]

  return (
    <div className="flex h-full min-h-0 bg-[#1b1b1b] text-[#d4d4d4]">
      <nav
        aria-label="Seções do guia"
        className="w-56 shrink-0 overflow-y-auto border-r border-[#3b3b3b] bg-[#232323] px-3 py-5"
      >
        <p className="px-2 pb-3 text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
          Guia do app
        </p>
        <div className="space-y-1">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveId(section.id)}
              aria-current={activeId === section.id ? 'page' : undefined}
              className={`w-full rounded-md px-3 py-2 text-left text-xs transition-colors ${activeId === section.id ? 'bg-[#3b3b3b] font-medium text-white' : 'text-[#999999] hover:bg-[#2a2a2a] hover:text-[#d4d4d4]'}`}
            >
              {section.label}
            </button>
          ))}
        </div>
      </nav>
      <div key={activeSection.id} className="min-w-0 flex-1 overflow-y-auto px-5 py-7 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-7 border-b border-[#3b3b3b] pb-6">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#a080f0]">
              Como funciona
            </p>
            <h1 className="text-2xl font-semibold text-white">{activeSection.label}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#a8a8a8]">{activeSection.intro}</p>
          </div>
          <div className="mb-5 rounded-xl border border-[#3b3b3b] bg-[#232323] p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
              Exemplo visual
            </p>
            <GuideVisual sectionId={activeSection.id} />
          </div>
          <div className="space-y-4">
            {activeSection.topics.map((topic) => (
              <section
                key={topic.title}
                className="rounded-xl border border-[#3b3b3b] bg-[#232323] p-5"
              >
                <h2 className="text-sm font-semibold text-white">{topic.title}</h2>
                <ul className="mt-3 space-y-3">
                  {topic.points.map((point) => (
                    <li key={point} className="flex gap-3 text-[13px] leading-6 text-[#b8b8b8]">
                      <span
                        aria-hidden="true"
                        className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#a080f0]"
                      />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
