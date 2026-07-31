// ── Permission Registry ──────────────────────────────────────────────────────
//
// Documents why each tool is classified as read, write, or destructive.
// Replaces the ad-hoc `write: true` boolean with structured metadata
// (rationale, guard, and provenance) so the classification is auditable
// and future maintainers know the design intent behind each level.
//
// Step 5 of the AI agent construction framework:
// "Classificar permissões com linhagem — leituras certificadas,
//  gravações aprovadas, bloqueio destrutivo."

export type PermissionLevel = 'read' | 'write' | 'destructive'

export interface PermissionEntry {
  /** Tool name (the key in REGISTRY). */
  name: string
  /** Classification level. */
  level: PermissionLevel
  /** Why this level was chosen. */
  rationale: string
  /** What protects the user from misuse. */
  guard: string
  /** When this classification was first established. */
  since: string
}

// ── All tools ─────────────────────────────────────────────────────────────────

const REGISTRY: PermissionEntry[] = [
  // ── Read tools ────────────────────────────────────────────────────────────
  {
    name: 'ler_projetos',
    level: 'read',
    rationale: 'Só lista projetos e colunas existentes. Nenhuma mutação.',
    guard: 'Nenhum — a ferramenta é idempotente e não altera estado.',
    since: '2024-03'
  },
  {
    name: 'ler_tasks',
    level: 'read',
    rationale: 'Só lista tasks com filtros. A mais chamada do agente — o default exclui tasks concluídas (45% do board real) para economizar tokens.',
    guard: 'Total + truncado + concluidas_ocultas reportados para que o corte não minta sobre o tamanho real do board.',
    since: '2024-03'
  },
  {
    name: 'ler_financeiro',
    level: 'read',
    rationale: 'Resumo financeiro: saldo, receitas/despesas do mês, metas. Leitura pura.',
    guard: 'Nenhum.',
    since: '2024-03'
  },
  {
    name: 'ler_metas',
    level: 'read',
    rationale: 'Lista metas com progresso derivado das entradas. Sem mutação.',
    guard: 'Nenhum.',
    since: '2024-03'
  },
  {
    name: 'ler_habitos',
    level: 'read',
    rationale: 'Resumo de hábitos com streaks. Leitura pura.',
    guard: 'Nenhum.',
    since: '2024-03'
  },
  {
    name: 'ler_notas',
    level: 'read',
    rationale: 'Lista notas do canvas. Leitura pura.',
    guard: 'Nenhum.',
    since: '2024-03'
  },
  {
    name: 'listar_arquivos',
    level: 'read',
    rationale: 'Lista arquivos dentro da raiz de código confinada. Sem mutação.',
    guard: 'Confinado à raiz do projeto por confineToRoot(). Paginado para não entupir o contexto.',
    since: '2024-06'
  },
  {
    name: 'ler_arquivo',
    level: 'read',
    rationale: 'Lê trechos de arquivos de código por caminho, símbolo ou range de linhas. Sem mutação.',
    guard: 'Confinado por confineToRoot(). Cache de 5s no code-agent. Brake de releitura cega (2x).',
    since: '2024-06'
  },
  {
    name: 'buscar_no_codigo',
    level: 'read',
    rationale: 'Grep no código dentro das raízes confinadas. Resultados agrupados por arquivo.',
    guard: 'Confinado por confineToRoot(). Cache de 30s com TTL. Cap de 60 matches.',
    since: '2024-06'
  },
  {
    name: 'buscar_na_web',
    level: 'read',
    rationale: 'Fetch HTTP de páginas web. A URL vem do modelo e é input não-confiável.',
    guard: 'Só http/https. IPs privados/loopback/metadata bloqueados. Redirects seguidos à mão com política reaplicada. Rate limit (10/60s). Cap de 8000 chars. Sem cookies/authorization/referer.',
    since: '2024-06'
  },
  {
    name: 'renderizar_js',
    level: 'read',
    rationale: 'Renderiza páginas SPA em headless browser (via Electron).',
    guard: 'Mesma política de URL do buscar_na_web aplicada a toda requisição (documento + sub-recursos) via session.webRequest. Sessão efêmera, sem cookies, sandbox on, sem node.',
    since: '2024-09'
  },
  {
    name: 'buscar_memoria',
    level: 'read',
    rationale: 'Busca fatos duráveis na memória do assistente. Leitura pura.',
    guard: 'Os resultados são reenviados ao modelo a cada passo seguinte — o bump de access_count é deliberadamente separado da leitura (decay-neutral).',
    since: '2024-10'
  },
  {
    name: 'buscar_conversas',
    level: 'read',
    rationale: 'Busca no histórico de conversas. Acesso somente ao que já foi dito.',
    guard: 'Retorna snippets, não o corpo inteiro. Status lines (trace de ferramentas) são puladas na busca.',
    since: '2024-10'
  },
  {
    name: 'ler_conversa',
    level: 'read',
    rationale: 'Lê o transcript completo de uma conversa por id.',
    guard: 'Transcript capado em 8000 chars. Status lines removidas. O conteúdo é reenviado ao modelo a cada passo seguinte.',
    since: '2024-10'
  },
  {
    name: 'verificar_memorias',
    level: 'read',
    rationale: 'Detecta pares de memórias com mesmo título e corpo diferente (sinal de contradição).',
    guard: 'É um aviso, nunca um bloqueio. Skips handoffs (compartilham título por design).',
    since: '2024-11'
  },
  {
    name: 'ler_linhagem',
    level: 'read',
    rationale: 'Consulta o event log de uma entidade: quando foi criada, atualizada ou removida.',
    guard: 'Leitura pura do entity_events (append-only). Máximo 200 eventos por consulta.',
    since: '2026-07'
  },

  // ── Write tools ──────────────────────────────────────────────────────────
  {
    name: 'criar_projeto',
    level: 'write',
    rationale: 'Cria um projeto novo com colunas padrão. Também troca o projeto ativo — side effect significativo que captura as próximas criações.',
    guard: 'Cartão de aprovação. Recusa nome duplicado (retorna o existente). Nome truncado. Cor validada contra PROJECT_COLORS.',
    since: '2024-03'
  },
  {
    name: 'criar_tasks',
    level: 'write',
    rationale: 'Cria tasks em lote — a ferramenta de escrita mais poderosa em volume. Um modelo confiante pode criar dezenas de tasks de uma vez.',
    guard: 'Cartão de aprovação mostra o nome de cada task. Validação de projectId. Tags truncadas. Prioridade default = medium.',
    since: '2024-03'
  },
  {
    name: 'atualizar_task',
    level: 'write',
    rationale: 'Edita campos de uma task existente: prioridade, descrição, prazo, tags. Pode apagar campos (string vazia limpa descrição; array vazio limpa tags).',
    guard: 'Cartão de aprovação mostra cada campo alterado. Lease de task (multi-agente). Validação de prioridade contra PRIORITY_CONFIG. Validação de dueDate com isCalendarDate.',
    since: '2024-03'
  },
  {
    name: 'mover_task',
    level: 'write',
    rationale: 'Move uma task entre colunas. Cruzar a fronteira de Done conclui/reabre a task e pode parar um cronômetro.',
    guard: 'Cartão de aprovação. Lease de task. Resolve coluna por nome no projeto da task (nunca args.projectId).',
    since: '2024-03'
  },
  {
    name: 'concluir_task',
    level: 'write',
    rationale: 'Move a task para a coluna Done. Atalho para mover_task com a coluna correta.',
    guard: 'Cartão de aprovação. Lease de task. Só funciona se o projeto tiver coluna Done.',
    since: '2024-06'
  },
  {
    name: 'deletar_task',
    level: 'destructive',
    rationale: 'Hard-delete + tombstone. Única ferramenta cujo efeito não tem desfazer — o backup não ressuscita tasks com tombstone.',
    guard: 'Cartão de aprovação com destaque de PERMANENTE. Erra em título ambíguo em vez de escolher. Lease de task.',
    since: '2024-03'
  },
  {
    name: 'iniciar_cronometro',
    level: 'write',
    rationale: 'Inicia o cronômetro de uma task para rastrear tempo gasto. Side effect: o timer corre em background até ser parado.',
    guard: 'Cartão de aprovação. Não reinicia um timer já rodando. Multi-timer: não para outros timers.',
    since: '2024-06'
  },
  {
    name: 'criar_sprints',
    level: 'write',
    rationale: 'Cria uma sprint dentro de um projeto.',
    guard: 'Cartão de aprovação. Validação de projectId.',
    since: '2024-09'
  },
  {
    name: 'atribuir_sprint',
    level: 'write',
    rationale: 'Atribui uma task a uma sprint existente.',
    guard: 'Cartão de aprovação. Lease de task. Resolve sprint por nome no projeto da task.',
    since: '2024-09'
  },
  {
    name: 'criar_meta',
    level: 'write',
    rationale: 'Cria uma meta de progresso (Goal) com target > 0. O target é divisor em GoalView — target 0 quebra a UI.',
    guard: 'Cartão de aprovação. Valida target > 0. Valida projectId. A meta criada tem 0 entradas — o progresso é preenchido pelo usuário.',
    since: '2024-06'
  },
  {
    name: 'atualizar_meta',
    level: 'write',
    rationale: 'Edita campos de uma meta existente. Não mexe nas entradas (progresso é do usuário).',
    guard: 'Cartão de aprovação. Erra em título ambíguo. Valida target > 0 se alterado.',
    since: '2024-06'
  },
  {
    name: 'marcar_habito',
    level: 'write',
    rationale: 'Marca um hábito como concluído hoje. Idempotente — não desmarca se já estiver marcado.',
    guard: 'Cartão de aprovação. Verifica completions antes de marcar (toggle faria unmark). Data é local (todayISO), não UTC.',
    since: '2024-06'
  },
  {
    name: 'criar_nota',
    level: 'write',
    rationale: 'Cria uma nota sticky no canvas do projeto.',
    guard: 'Cartão de aprovação. Posicionamento automático (freeNoteSpot) evita stacking. Cor validada contra NOTE_COLORS.',
    since: '2024-06'
  },
  {
    name: 'criar_transacao',
    level: 'write',
    rationale: 'Registra uma transação financeira. Dinheiro real do usuário — erro de valor ou tabela errada tem consequência.',
    guard: 'Cartão de aprovação. parseMoney rejeita separadores de milhar. amount é decimal string com 2 casas. type define o sinal. Data default é local (todayISO). Erra em tabela ambígua.',
    since: '2024-06'
  },
  {
    name: 'salvar_memoria',
    level: 'write',
    rationale: 'Salva um fato duradouro na memória do assistente. A memória é reenviada ao modelo a cada passo — dados errados ou vazamento de segredos são permanentes.',
    guard: 'Cartão de aprovação. scrubSecrets() sanitiza chaves/tokens antes de persistir. Corpo truncado em 4000 chars. Tipo validado contra enum.',
    since: '2024-10'
  },
  {
    name: 'rodar_agente_codigo',
    level: 'write',
    rationale: 'Dispara o agente de código nativo — um loop autônomo que lê, edita e executa comandos no projeto de código. Fire-and-forget: o chat não espera o resultado.',
    guard: 'Cartão de aprovação + aprovação por ação dentro do agente (escrever_arquivo, executar_comando). confineToRoot + ai-jail. Aprovação humana por ação de escrita/comando. Max steps = 60.',
    since: '2024-10'
  },
  {
    name: 'ajustar_bloco_e_deslocar_posteriores',
    level: 'write',
    rationale: 'Altera o fim de um bloco de agenda e move em lote os blocos posteriores do mesmo dia.',
    guard: 'Cartão de aprovação. Exige data e bloco inequívoco; em empate, horário inválido ou cruzamento de meia-noite não grava nada.',
    since: '2026-07'
  }
]

const byName = new Map<string, PermissionEntry>(REGISTRY.map((e) => [e.name, e]))

export function getPermission(name: string): PermissionEntry | undefined {
  return byName.get(name)
}

export function isWriteTool(name: string): boolean {
  const p = byName.get(name)
  return p?.level === 'write' || p?.level === 'destructive'
}

export function isDestructive(name: string): boolean {
  return byName.get(name)?.level === 'destructive'
}

export function getPermissionLevel(name: string): PermissionLevel {
  return byName.get(name)?.level ?? 'read'
}
