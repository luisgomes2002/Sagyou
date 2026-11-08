# Recuperar a sincronização pelo código no PC

Status: approved by Luis on 2026-11-08
Branch: feature/recuperacao-codigo

## Por quê

Se todos os aparelhos se perderem, os dados continuam cifrados no Worker, e o código de
recuperação é a única forma de abri-los. O motor já sabe recuperar (`engine.recover`,
IPC `sync:recover`, preload `sync.recover`) e o celular já tem a tela ("Entrar com código
de recuperação", no pareamento), mas o **PC não tem**. Hoje o guia diz: "Esta versão do
app ainda não tem uma tela para recuperar a sincronização". Com o Luis no Japão e o PC
no Brasil, um PC reinstalado ou novo sem nenhum aparelho pareado fica sem saída.

## Objetivos

- Configurações → Sincronização, com a sincronização desligada, ganha a seção
  **"Perdi todos os aparelhos"**, que recupera com o código de recuperação, a senha de
  configuração do Worker e um código do autenticador (ou reserva).
- Recuperar no PC **sempre substitui** os dados deste PC pelos da nuvem, com backup antes.
- O guia deixa de dizer que a tela não existe, no PC e no celular.

## Fora do escopo

- Mudar a tela do celular. Ela continua como está (o celular não tem dados antes de
  parear, então juntar ou substituir dá no mesmo).
- Trocar a chave de sync depois de recuperar (o código de recuperação continua o mesmo).
- Revogar sozinho os aparelhos perdidos: a tela só avisa (ver Comportamento).
- Recuperar sem o autenticador: com aparelhos ativos, o Worker exige o fator (regra atual).

## Decisões (de Luis, 2026-11-08)

- Recuperar no PC sempre substitui pelos dados da nuvem, com backup antes (opção "c").

## Decisões do construtor (o agente decidiu; o humano pode mudar)

1. **O motor ganha o modo na recuperação:** `recover(code, setupToken, deviceName, factor,
   mode?: 'merge' | 'replace')`, padrão `'merge'` (o celular não muda). O PC passa sempre
   `'replace'`, com a mesma mecânica do `join` em `'replace'`: backup forçado **antes** de
   falar com o Worker (falhou → "Não foi possível fazer o backup antes de substituir. Nada
   foi alterado." e nada muda), config salva pausada como `'join'` até `takeCloud` terminar;
   se o download falhar, fica pausada e o PC oferece o "A nuvem manda" que já existe
   para a pausa `'join'`.
2. **Confirmação antes de enviar**, sempre: "Os dados deste PC serão substituídos pelos da
   nuvem. Um backup deste PC é feito antes." com **Recuperar e substituir** / **Cancelar**.
3. **Os três segredos vivem só no estado da seção.** Um erro mantém os campos (para corrigir
   um deles); sucesso, Cancelar ou sair da seção os limpa. Nunca vão a log.
4. **Rótulos iguais aos do celular:** "Código de recuperação", "Senha de configuração do
   Worker", "Código do autenticador ou reserva".
5. **Depois de recuperar**, um toast: "Sincronização recuperada. Revogue os aparelhos
   perdidos em Aparelhos." (eles continuam registrados no Worker).
6. **Versões:** desktop MINOR (tela nova); celular PATCH (só o texto do guia em
   `packages/core/src/sync/guide.ts`, que o celular mostra).

## Comportamento

**Onde.** Configurações → Sincronização, com a sincronização desligada (estado em que hoje
aparecem "Primeiro aparelho" e "Outro aparelho já sincroniza"), uma terceira seção
**"Perdi todos os aparelhos"**, com o texto:
"Use quando nenhum aparelho pareado está à mão. Os dados deste PC serão substituídos pelos
da nuvem (um backup é feito antes)."

**Campos.** Código de recuperação (área de texto, fonte mono, sem autocompletar), Senha de
configuração do Worker (`type="password"`), Código do autenticador ou reserva. O botão
**Recuperar** fica desligado até os três terem texto.

**Fluxo.**
1. Recuperar → confirmação (decisão 2). Cancelar fecha a confirmação e mantém os campos.
2. Recuperar e substituir → backup forçado → `/setup` com a prova da chave e o fator →
   baixa tudo da nuvem e substitui os dados do PC → sincronização ativa.
3. Sucesso: campos limpos, a tela passa ao estado ativo de sempre, toast da decisão 5.

**Erros** (texto do motor, mostrado na seção, campos mantidos):
- código malformado ou checksum errado: "Código de recuperação inválido.";
- backup falhou: "Não foi possível fazer o backup antes de substituir. Nada foi alterado.";
- senha do Worker, fator ou rede: as mensagens que o motor já devolve para a ativação
  (ex.: "Não foi possível ativar a sincronização.", "Sem conexão com o servidor de
  sincronização.", "Muitas tentativas. Aguarde 15 minutos e tente novamente.");
- download falhou depois do `/setup`: a sincronização fica pausada como `'join'` e a tela
  mostra a faixa de pausa ("A troca pelos dados da nuvem não terminou." com **A nuvem manda**), como depois de um "Entrar com
  código" que falhou.

**Bordas.**
- Sem chaveiro (`no-keychain`): a seção não aparece, como "Ativar" e "Entrar com código".
- Sincronização já ativa: a seção não aparece (o motor também recusa: "A sincronização já
  está ativa neste aparelho.").
- Clique duplo: o botão fica desligado enquanto `busy`.

## Dados

Sem mudança de formato. O backup forçado é o mesmo do "Entrar com código → Substituir"
(`userData/backups/`, timestamped). A substituição usa o `takeCloud` existente.

## Telas

- Desktop: a seção nova em `SyncSettings.tsx`, no padrão das duas vizinhas
  (`Subsection`, `fieldClass`, `primaryClass`, painel de confirmação como o do "Juntar /
  Substituir"), seguindo `UI_DESIGN.md`.
- Guia do desktop (`guide/sync-content.ts`, artigo "Perdi todos os aparelhos"): troca a
  frase "Esta versão do app ainda não tem uma tela…" pelos passos no PC (Configurações →
  Sincronização → Perdi todos os aparelhos; o que é pedido; que substitui com backup) e no
  celular (Entrar com código de recuperação). Remove o aviso do `CLAUDE.md` sobre
  `sync:recover` sem chamador.
- Guia compartilhado (`packages/core/src/sync/guide.ts`, tabela "Perdeu… → Usa…"): troca
  "(a tela de recuperar ainda não existe; enquanto isso, um backup)" por onde recuperar no
  PC e no celular.

## Perguntas em aberto

(nenhuma)
