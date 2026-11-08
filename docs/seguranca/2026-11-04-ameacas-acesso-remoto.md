# Ameaças do acesso remoto (para debate)

Status: rascunho para discussão, **não aprovado**. Nada aqui muda uma decisão já
tomada até o Luis decidir. Origem: conversa de 2026-11-04 numa sessão do Fleet.
Os requisitos que saíram dela estão resumidos no roteiro
([`2026-10-30-sync-mobile-roteiro.md`](../specs/2026-10-30-sync-mobile-roteiro.md),
seção "Requisitos para operar do exterior").

Cenário analisado: o projeto completo (etapas 1–6 do roteiro), com o ESP32
funcionando, o PC no Brasil e o Luis no Japão.

## 1. Decisões que abrem superfície

Tomadas em 2026-11-03 (spec `2026-11-03-acesso-remoto.md` e commit `9f1b3e0`):

| # | Decisão | O que ela abre |
|---|---|---|
| A | Um servidor de Remote Control por projeto, iniciado no logon | O PC fica comandável pela conta Anthropic sempre que estiver ligado |
| B | Login automático do Windows (risco aceito) | Quem está na frente do PC entra na sessão. Com o login automático, o BitLocker não protege contra roubo |
| C | Token MCP externo permanente e total | Não existe prazo que feche a porta sozinho |
| D | Escritas arriscadas sem card pelo token externo | Deletes, dinheiro e `save_memory` sem confirmação humana |
| E | "Funcionar com o Sagyou bloqueado" | A senha do Sagyou não protege mais contra o Claude remoto |
| F | Revogar o token só no PC | Longe de casa, não dá para cortar o acesso |
| G | Convite de pareamento no celular sem TOTP | Celular desbloqueado = aparelho novo no sync |

## 2. Caminhos de ataque (projeto completo)

1. **🔴 Celular desbloqueado na mão de outra pessoa.** Abre o Remote Control (shell
   no PC), pareia um aparelho dela (sem TOTP; ela escolhe o nome, então pode chamá-lo
   de "Pixel do Luis") e liga e desliga o PC. Só o desbloqueio do Sagyou e a aprovação
   de cards pedem biometria.
2. **🔴 Conta Anthropic invadida.** Shell como o usuário Windows. Daí: o MCP externo
   (deletes e dinheiro sem card, mesmo bloqueado); a chave de sync (o `safeStorage`/DPAPI
   é decifrável pelo próprio usuário); convites emitidos pelo token do aparelho, que dão
   acesso persistente; admin, se a conta for admin. Conferido no Worker: só a chave não
   basta para recriar o grupo (`/setup` com aparelhos ativos exige o setup token, a prova
   da chave e o TOTP). A porta de volta é o convite.
3. **🔴 Comandos forjados no canal Worker → ESP32 / PC.** Se a autorização for só o token
   do aparelho no Worker, quem invadir a conta Cloudflare desbloqueia e desliga. Todo
   comando precisa vir assinado pelo celular, com nonce e prazo curto.
4. **🟠 Rede local.** Filtrar pelo IP do ESP32 não autentica (dá para forjar o IP numa
   rede local). O script de escuta roda como SYSTEM (um bug de parse dá controle total).
   OTA sem senha permite trocar o firmware e levar o `secrets.h`. O Wake-on-LAN não tem
   autenticação, e com o login automático acordar o PC é o mesmo que entrar na sessão.
5. **🟠 Acesso físico.** O login automático anula o BitLocker. Existe uma janela entre o
   logon e a tarefa que bloqueia a tela. Do exterior, quem religa o PC entra na sessão.
6. **🟠 PC do trabalho.** É um aparelho completo do sync. Quem tem root nele (o TI da
   empresa) lê o chaveiro e, com isso, os dados.
7. **🟡 Prompt injection.** Todo aparelho pareado, o celular (tasks, notas, hábitos) e
   memórias salvas a partir da web escrevem texto que um agente com shell e MCP sem card
   lê.
8. **🟡 Releases do GitHub.** Ver a seção 4: hoje, o token no PC publica sozinho.

**A cadeia que mais preocupa:** celular desbloqueado ou conta Anthropic → shell no PC →
chave de sync + convite → acesso permanente a tudo, em todos os aparelhos. Nenhuma etapa
dessa cadeia pede um segundo fator.

## 3. Alternativas de isolamento avaliadas

**ai-jail (Fabio Akita):** bubblewrap, Landlock e seccomp no Linux; sandbox-exec no macOS;
sem suporte nativo ao Windows (o `.ai-jail` antigo, removido em `45b582a`, rodava pelo
WSL).
- Mitiga: uma shell vinda da conta Anthropic fica presa na pasta do projeto (sem
  `sync-config.json`, DPAPI, tarefas agendadas, script do ESP32 ou admin), e um prompt
  injection só alcança o worktree.
- Não mitiga: o MCP externo (o jail não filtra o MCP), a exfiltração pela rede, as
  credenciais mapeadas (`gh`, SSH), o token em `~/.claude.json` (a config do Claude é
  mapeada para ele autenticar) e todos os caminhos que não são de agente.
- Custo: tudo passa pelo WSL2 (o 9p no `/mnt/e` é lento; `node_modules` com ABIs
  diferentes; Electron e `build:win` só no Windows). O broker está no `127.0.0.1` do
  Windows (precisa de *mirrored networking*), e a bridge usa o interop do WSL, que dentro
  do bubblewrap provavelmente não existe — **não testado**. Pôr de volta no Fleet exige
  uma spec.
- Conclusão provisória: como requisito para o projeto funcionar, não vale. Como opção,
  só nos servidores de Remote Control.

**Docker:**
- O app em Docker não funciona: GUI, bandeja, login no Windows, `powerMonitor`, inatividade
  e `safeStorage` não existem no contêiner (o sync fica `no-keychain`).
- Os agentes em devcontainer, sim: o devcontainer de referência do Claude Code tem
  firewall de saída por allowlist, o que cobre a exfiltração. O custo é o mesmo do
  ai-jail, e o MCP precisaria de `host.docker.internal` — **não testado**.

**Mais barato, com efeito parecido:** conta Windows padrão (sem admin) para o login
automático e o Remote Control, o sandbox nativo de cada CLI e cards no celular para
deletes e dinheiro.

## 4. GitHub (conferido com o `gh` em 2026-11-04)

**Já protege:** Actions começam só leitura, não aprovam PR, e só os jobs `release` têm
`contents: write`. Releases do desktop e do mobile saem como rascunho. As chaves do APK
estão no environment `mobile-release`, com o Luis como revisor obrigatório. O Luis é o
único colaborador, e não há deploy keys. O token do `gh` **não tem o escopo `workflow`**,
então não faz push em `.github/workflows/`. O `.claude/settings.json` bloqueia
`push --force`/`--no-verify` para os agentes (protege contra erro, não contra ataque).

**Não protege:**
- Token `gho_` com escopo `repo` completo e sem validade, no Gerenciador de Credenciais
  do Windows. Qualquer processo rodando como o usuário lê com `gh auth token`.
- `main` sem proteção e nenhum ruleset: push direto na `main`.
- Sem regra para as tags `v*`/`mobile-v*`: o token cria a tag e o CI compila.
- O mesmo token publica o rascunho (`gh release edit --draft=false`), então **o
  rascunho não protege contra quem tem o token**, e o auto-update instala nos PCs.
- `mobile-release` sem restrição de branch. Quem tem o token aprova o deploy pela API
  (o revisor é o próprio dono).
- O repositório é público (não é falha, mas expõe a lógica de segurança e de sync).

**Cadeia:** token → push → tag → o CI compila → o token publica → o auto-update instala
em todos os PCs, a partir de qualquer agente no PC.

**Proposta:** conta bot (papel Write, PAT fine-grained de 90 dias, só Contents e Pull
requests) no PC dos agentes, e o token do dono só no navegador com passkey; ruleset na
`main` (PR com 1 aprovação, checks do `quality.yml`, sem force-push ou exclusão); tags de
release só por admin; `mobile-release` restrito a `mobile-v*`; exigir actions fixadas por
SHA. O custo é o merge e a tag passarem a ser feitos no navegador.

## 5. PC no Brasil, Luis no Japão

**Segurança que fica mais grave:**
- Perder o celular: sem outro aparelho para revogar ou parear. A recuperação por código
  existe no PC (Configurações → Sincronização → Perdi todos os aparelhos, desde 2026-11-08)
  e no celular. Levar um segundo aparelho pareado e os códigos impressos.
- 2FA por SMS de número brasileiro pode não chegar, e um login de outro país dispara
  verificação. Passkey ou TOTP em tudo.
- O kill switch remoto vira obrigatório. O script de desligar precisa sobreviver a um
  invasor com shell (rodar como SYSTEM, fora do alcance da conta dos agentes).
- Quem religa o PC entra na sessão (login automático).

**Operação:**

| Situação | O que fazer |
|---|---|
| Queda de energia | BIOS "Restore on AC power loss = Power On"; o ESP32 religa sozinho, com IP fixo |
| Roteador travado | Tomada inteligente ou timer que religa |
| Windows Update | Horário ativo ou pausa: um reboot travado deixa o PC fora do ar |
| PC travado | Relé no botão de power ou tomada inteligente (o WoL e o desligar pela rede não resolvem) |
| Sem nobreak | Quedas curtas reiniciam e podem corromper o disco |

A latência de 250–300 ms não afeta o Remote Control nem o sync. O RustDesk fica arrastado.

**Datas:** `todayLocalISO()` (`packages/core/src/dates.ts`) usa o relógio de cada
aparelho. Com 12 h de fuso, o PC e o celular discordam do dia durante metade do tempo:
hábitos, saldo atual (um gasto de hoje no Japão é futuro no PC), prazos, Próximas e o
"hoje" dos agentes do Remote Control. As tools de MCP de hábitos, transação e prazo devem
exigir a data explícita, ou ao menos devolver a data usada. Não quebram: a ordem do sync
(HLC), o TOTP e o dinheiro em JPY.

## 6. Para debater

1. Voltar a pedir card (pelo celular) para deletes e dinheiro no token externo?
2. Desbloqueado sim, bloqueado só leitura, até existir o desbloqueio pelo celular?
3. Kill switch numa spec própria, antes da etapa 6?
4. Isolar os servidores de Remote Control (devcontainer com firewall ou ai-jail)? Antes,
   testar se o MCP funciona de dentro deles.
5. Conta bot no GitHub + rulesets: aceitar o merge e a tag pelo navegador?
6. TOTP para gerar convite de pareamento?
7. O PC do trabalho precisa das finanças (escopo de sync por aparelho)?
8. Como tratar o fuso: data explícita nas tools, ou um "fuso do usuário" sincronizado em
   vez do relógio de cada aparelho?

## 7. Decisões de 2026-11-07

Decidido por Luis; construído na spec `docs/specs/2026-11-07-endurecer-acesso-remoto.md`
(desktop 1.7.0, celular 0.4.0, Worker reimplantado junto).

1. **Cartão no token externo: sim.** Excluir, dinheiro, arquivar projeto e tabelas ou
   perfis financeiros pedem aprovação no PC (diálogo) ou no celular (aba PC); 5 min, a
   primeira resposta vale, expirado = recusado. Criar e editar continuam sem cartão.
2. **Bloqueado = só leitura.** "Ler com o Sagyou bloqueado" substitui "Funcionar com o
   Sagyou bloqueado"; o portão que deixava o `store:save` passar pelo bloqueio saiu.
3. **Kill switch: sim, nesta spec.** "Cortar acesso" no celular suspende o token externo,
   encerra os `claude remote-control` (e de novo a cada 30 s), bloqueia o Sagyou e deixa o
   PC ligado. "Restaurar acesso": celular com biometria + autenticador, ou no PC.
4. **Isolar os servidores de Remote Control:** fora. Experimento com ai-jail v3.2 no WSL2;
   só vira spec se o MCP funcionar de dentro do jail.
5. **GitHub:** aplicado em 2026-11-07 (rulesets da `main` e das tags, environment
   `mobile-release` só para `mobile-v*`, PATs fine-grained que vencem em 2027-02-05). Exigir
   SHA nas actions entra depois do merge do PR #47. Renovar os PATs antes de julho de 2027
   é uma tarefa no Sagyou.
6. **Convite com autenticador: sim.** Gerar um código de pareamento (PC ou celular) pede o
   código do autenticador ou um código reserva.
7. **PC do trabalho com tudo:** risco aceito; sem escopo de sync por aparelho.
8. **Fuso:** spec própria (Spec B).

- **M5:** o pedido "Estou longe do PC" fica no Worker por no máximo 1 h (era 24 h).
- **M6:** a chave do ESP32 no celular sem `requireAuthentication` foi aceita: ela só assina
  ligar/desligar, e o app já pede biometria antes de mandar o comando.
- **Dívida:** a senha do "Estou longe do PC" vai cifrada só com a chave de sync; selá-la
  para a chave pública do PC muda o protocolo, e um celular novo ainda não conhece essa
  chave. Fica para uma spec futura.
