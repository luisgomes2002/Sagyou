# Fuso horário: data explícita nas tools de MCP

Status: approved by Luis on 2026-11-08
Branch: feature/fuso-horario

Origem: item 8 do debate de segurança (`docs/seguranca/2026-11-04-ameacas-acesso-remoto.md`),
"Spec B" das decisões de 2026-11-07.

## Por quê

O PC fica no Brasil (UTC−3) e o Luis vai morar no Japão (UTC+9). `todayLocalISO()` usa o
relógio de cada aparelho, então durante metade do dia o PC e o celular discordam de qual
dia é hoje. O efeito que erra em silêncio é o Claude remoto: ele roda no PC e, quando a
data não vem, `create_transaction` e `add_goal_progress` gravam o "hoje" do Brasil. Às 8 h
de terça no Japão, "lança 1.000 ienes no mercado" vira um gasto de segunda.

## Objetivos

- `create_transaction` e `add_goal_progress` exigem a data. Sem ela, a tool recusa e o
  agente precisa perguntar ou informar uma.
- A descrição das duas tools e o texto de recusa dizem ao agente que a data é a do
  usuário, que pode estar em outro fuso do PC.

## Fora do escopo

- **Mudar o "hoje" dos aparelhos.** Cada aparelho continua no próprio fuso (decisão do Luis):
  hábitos, saldo atual, Próximas e prazos seguem `todayLocalISO()` de cada um.
- **Fuso do usuário sincronizado** ou fuso fixo nas configurações.
- **Puxar para o saldo do PC o que está 1 dia à frente.** Um gasto de terça lançado no
  Japão aparece como futuro no PC até o PC chegar na terça (decisão do Luis: aceito).
- Tools de hábito pelo MCP (não existem).
- `update_task` (`dueDate` já é sempre explícito), `update_transaction` (data opcional
  porque é edição), `criar_task`/`create_task` (sem data), timers e `completedAt`
  (instantes, não dias de calendário).

## Decisões (de Luis, 2026-11-08)

- PC e celular seguem o fuso do aparelho.
- As tools de data exigem a data (opção "a"): sem data, recusa.
- O efeito "futuro no PC" para o que o celular lançou à frente do PC é aceito.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

1. **Vale para o Fleet e para o token externo**, sem diferença: as mesmas tools, a mesma
   regra. Uma sessão do Fleet no PC também precisa dizer a data; o custo é pequeno e evita
   dois comportamentos.
2. **A recusa vem antes do cartão.** Sem data, o `prepare` recusa e nenhum cartão de
   aprovação é aberto (`create_transaction` pede cartão).
3. **`date` vazia (`""`) conta como ausente** e recusa, como hoje conta como "omita".
4. Os chamadores legados (`ler_*`, `save_memory`, `criar_task`) não mudam.

## Comportamento

- `create_transaction` sem `date` (ou com `date: ""`): recusa com
  **"date é obrigatória (YYYY-MM-DD): use a data do usuário, que pode estar em outro fuso do PC. Se não souber, pergunte."**
  Nada é gravado e nenhum cartão abre.
- `add_goal_progress` sem `date`: a mesma recusa, com o mesmo texto.
- Data inválida: continua a recusa de hoje
  ("date precisa ser uma data real no formato YYYY-MM-DD.").
- Com data válida: comportamento de hoje, inclusive para uma data futura (um gasto
  agendado continua possível).
- A descrição do parâmetro `date` nas duas tools passa de
  "Data YYYY-MM-DD; omita para hoje." para
  **"Data YYYY-MM-DD do usuário (obrigatória; o usuário pode estar em outro fuso do PC)."**
  e `date` entra na lista de obrigatórios do schema das duas.
- A resposta de sucesso já devolve o registro; nada muda nela.

## Dados

Sem mudança de dados. Nada persiste de novo; registros antigos não são tocados.

## Telas

Nenhuma. O guia (`guide/content.ts`) só muda se algum artigo disser que o agente usa a data
de hoje sozinho; o construtor confere e ajusta no mesmo branch.

## Perguntas em aberto

(nenhuma)
