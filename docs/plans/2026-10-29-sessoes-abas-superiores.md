# Plano de implementação: abas superiores nas sessões de código

Status: approved by Luis on 2026-10-29
Spec: docs/specs/2026-10-29-sessoes-abas-superiores.md
Branch: feature/sessoes-abas

**Objetivo:** substituir a coluna de sessões por abas no topo, liberando largura para o terminal.

**Arquitetura:** `FleetView` continua derivando as sessões de `useCodeAgentRuns` e mantendo a seleção atual. `SessionRail` vira `SessionTabs`, componente apenas de navegação em uma faixa horizontal; `LiveRunWorkspace` e os terminais não mudam. O layout externo de `FleetView` passa a empilhar abas e conteúdo verticalmente.

## Restrições globais

- Nenhuma mudança em IPC, schema, backup, estado persistido ou ciclo de vida de PTY.
- A faixa de abas deve conter a rolagem horizontal; a tela inteira não pode rolar lateralmente.
- **Nova sessão** fica alcançável com qualquer quantidade de abas e usa o formulário existente.
- Abas são botões com nome acessível que inclui título, projeto/executor e estado; foco visível e texto longo truncado visualmente.
- Mesmo com título, projeto e executor iguais, o nome acessível distingue as abas pelo ID da run (decisão do construtor); o ID não precisa ocupar espaço visual.
- Seguir `UI_DESIGN.md`: grafite sólido, borda neutra e cor semântica apenas no indicador pequeno.
- Não incluir dependência nova de UI.

## Foco de review

1. **Terminal reinicializado ao trocar de aba:** seleção continua reutilizando o xterm vivo. Coberto pelo teste existente de `AgentTerminal` executado na Task 1 e conferido no app na Task 3.
2. **Sessões com título igual indistinguíveis:** nome acessível inclui projeto/executor e estado. Testado na Task 1.
3. **Muitas abas ou título extenso quebram a janela:** rolagem restrita à faixa e botão de criação fixo. Testado na Task 1 e conferido na Task 3.
4. **Sessão encerrada deixa seleção inválida:** fallback atual continua mostrando outra sessão ou painel novo. Testado na Task 1.
5. **Dados persistidos existentes:** nenhum formato ou dado muda; a navegação consulta as runs do main como antes. Conferido pelo diff e suíte na Task 3.

### Task 1: trocar a lista lateral por abas

**Arquivos:** renomear `src/renderer/src/components/ai/fleet/SessionRail.tsx` para `src/renderer/src/components/ai/fleet/SessionTabs.tsx`; modificar `src/renderer/src/components/ai/FleetView.tsx`; testar em `src/renderer/src/__tests__/components/FleetView.test.tsx`.

**Interfaces:** `SessionTabs({ items: SessionItem[], selectedKey: string | null, onSelect: (key: string) => void, onNew: () => void, starting: boolean })`. `FleetView` mantém sua interface pública.

- [ ] Escrever testes que exigem região **Sessões** acima de `main`, abas para todas as runs, seleção com `aria-current`, nomes acessíveis distintos até com título/projeto/executor iguais, indicador de atenção, botão **Nova sessão** e estado vazio. Acrescentar cenário de sessão encerrada e de retorno ao formulário após **Nova sessão**. Testar no DOM que as abas ficam em um contêiner próprio, separado do botão de criação; conferir rolagem e truncamento visualmente na Task 3.
- [ ] Rodar `npx vitest run src/renderer/src/__tests__/components/FleetView.test.tsx`. Esperado: FALHA porque a região atual é uma coluna lateral e os nomes/estrutura das abas ainda não existem.
- [ ] Implementar `SessionTabs` como faixa de altura fixa com área rolável para abas e botão de criação fora da área rolável; usar `min-w-0`, truncamento e estados de foco. Empilhar `SessionTabs` acima de `main` em `FleetView`, preservando seleção e callbacks.
- [ ] Reexecutar o teste, `src/renderer/src/__tests__/components/AgentTerminal.test.tsx` e `npm run typecheck`. Esperado: PASSA.
- [ ] Commit `feat(fleet): mostrar sessoes em abas superiores`.

### Task 2: atualizar a documentação da tela

**Arquivos:** modificar `CLAUDE.md`, `GUIDE.md` e `README.md` para descrever o Fleet com abas superiores e terminal/inspetor abaixo.

**Interface:** nenhuma.

- [ ] Revisar as descrições atuais do Fleet e substituir somente as afirmações sobre a coluna lateral de sessões; preservar as regras de xterm e IPC.
- [ ] Conferir `git diff --check` e a consistência das três descrições.
- [ ] Commit `docs(fleet): documentar abas superiores`.

### Task 3: revisão, entrega e registro da task

- [ ] Rodar `npm run typecheck`, `npm test` e `npm run lint`; corrigir somente falhas novas.
- [ ] Conferir em `npm run dev` as situações sem sessões, com duas sessões, com atenção e com muitas abas; confirmar o terminal ao alternar abas, o botão **Nova sessão** e o uso da largura na janela mínima. Registrar o que foi possível verificar no PR.
- [ ] Revisar o diff segundo `UI_DESIGN.md`, acessibilidade e preservação dos dados e terminais; corrigir achados importantes.
- [ ] Abrir PR para `main` usando `.github/pull_request_template.md`, sem merge.
- [ ] Depois da entrega, criar uma task no projeto Sagyou, vinculá-la à sprint aberta **UI (Sagyou)**, registrar o tempo real gasto e marcá-la como concluída.
