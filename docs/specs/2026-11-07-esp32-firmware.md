# Firmware do ESP32: ligar e desligar o PC

Status: approved by Luis on 2026-11-07
Branch: feature/esp32-firmware

Etapas 2 e 3 do firmware em `firmware/esp32/` (a etapa 1, teste da placa, entrou no PR #49).
O lado do Sagyou (Worker, app, celular) já existe: spec
`docs/specs/2026-11-03-controle-remoto-app.md` e o contrato `docs/esp32-api.md`. Esta spec
cobre o que roda **no ESP32** e **no Windows** para cumprir esse contrato.

## Por quê

O celular já sabe pedir "Ligar", "Forçar o desligamento" e "Cancelar" ao Worker, e o
simulador (`sync-server/scripts/esp32-sim.mjs`) já aplica as regras, mas nenhum hardware
executa nada. Com o ESP32 na rede de casa, o PC pode ser ligado do Japão (Wake-on-LAN) e
desligado à força quando o Sagyou não responde, que também é o último recurso de
segurança ("Cortar acesso" não basta se o Sagyou travou).

O documento de segurança (`docs/seguranca/2026-11-04-ameacas-acesso-remoto.md`, seção 2.4)
aponta os riscos que o desenho tem de fechar: o filtro por IP não autentica numa rede local;
um script que roda como SYSTEM com um bug de parse dá controle total do PC; OTA sem senha
deixa trocar o firmware e levar os segredos.

## Objetivos

- **Ligar:** um `wake` válido vindo do Worker envia o pacote mágico ao PC.
- **Desligar e cancelar:** um `shutdown` ou `abort-shutdown` válido vira um pedido
  **assinado** ao PC, que roda `shutdown /s /t 60` ou `shutdown /a`.
- **Estado:** a cada 10 s o ESP32 consulta o Worker e informa, assinado, se o PC responde
  ao ping e o resultado do último comando.
- Todas as regras de `docs/esp32-api.md` (MAC, contador na flash, relógio, prazo).
- O ESP32 **não escuta nenhuma porta**: só faz conexões de saída.

## Fora do escopo

- **OTA** (atualizar o firmware pela rede): decidido por Luis em 2026-11-07, só USB por
  agora. Uma spec futura pode trazer OTA assinado.
- Relé ou optoacoplador no botão de power da placa-mãe (hardware; fica para quando o
  Wake-on-LAN não bastar).
- Página web, botão físico ou qualquer comando local no ESP32.
- PC com Linux ou macOS; mais de um PC.
- Mudanças no Worker, no app desktop ou no celular (o contrato já está implementado).
- Configurar a BIOS, a placa de rede e o roteador (tarefas de montagem; o README do
  firmware lista os passos).

## Decisões (de Luis, 2026-11-07)

- **Sem OTA por agora.**
- **Testes do firmware rodam localmente** (`pio test -e native`, e os do script do Windows):
  exceção à regra de testar só no CI, porque o CI não cobre o firmware e o token dos
  agentes não altera workflows.
- **Rede:** PC em `192.168.15.250` (cabo, Realtek, MAC `3C:7C:3F:3B:0A:F3`), ESP32 em
  `192.168.15.251`, ambos com IP fixo enquanto não há reserva no roteador. Os valores ficam
  só no `secrets.h` e no instalador, nunca no git.

## Decisões do construtor (o agente decidiu; o humano pode mudar)

1. **Regras num módulo C++ puro** (`firmware/esp32/lib/power_rules/`), sem Arduino nem
   rede, testado com `pio test -e native` contra **os mesmos vetores** de MAC do
   `@sagyou/core` (`powerCommandMac`/`powerStateMac`), gerados uma vez num arquivo de teste.
   Uma divergência entre firmware e app aparece no teste, não no Japão.
2. **HTTPS com verificação de certificado** por um pacote de CAs embutido no firmware
   (`WiFiClientSecure::setCACertBundle`). Nunca `setInsecure()`: sem verificação, quem
   controla o Wi-Fi ou o DNS de casa recebe o `POWER_TOKEN`.
3. **Sem NTP, o ESP32 não consulta `/power/next`**: o comando é entregue uma vez só, e
   buscá-lo sem relógio para conferir o perderia. O app mostra "ESP32 sem contato" até o
   NTP acertar (leva ~10 s após ligar).
4. **Protocolo ESP32 → PC, na rede local (UDP 9999):** um datagrama de texto
   `sagyou-lan|1|<cmd>|<at>|<hmac>`, com `cmd` = `shutdown` ou `abort-shutdown`, `at` = hora
   NTP do ESP32 em ms (13 dígitos) e `hmac` = HMAC-SHA256 hexadecimal minúsculo de
   `sagyou-lan|1|<cmd>|<at>` com a **`LAN_KEY`**. Enviado 3 vezes com 200 ms de intervalo
   (UDP pode perder pacote; o contador descarta as repetições).
5. **`LAN_KEY` separada da `ESP32_KEY`**: 32 bytes gerados pelo instalador do Windows,
   mostrados uma vez para o `secrets.h`. Quem lê o arquivo da chave no PC só forja pedidos
   de desligar na rede local, nunca comandos do Worker.
6. **O ouvinte do Windows (`ouvir-esp32.ps1`) roda como SYSTEM**, para continuar
   funcionando se a conta do usuário for invadida (é o último recurso). Por isso ele é
   mínimo e estrito:
   - lê no máximo 200 bytes por datagrama; descarta o que vier de outro IP que não o do
     ESP32 (o firewall já filtra; isto é a segunda camada);
   - aceita só a expressão exata `^sagyou-lan\|1\|(shutdown|abort-shutdown)\|(\d{13})\|([0-9a-f]{64})$`;
   - confere o HMAC em tempo constante, depois `at` > último `at` aceito (guardado em
     arquivo), depois `|at − agora| ≤ 60 s` pelo relógio do PC;
   - grava o novo `at` **antes** de agir;
   - executa só `C:\Windows\System32\shutdown.exe` com argumentos fixos; nada do datagrama
     vira argumento, caminho ou comando.
7. **Instalação no Windows por um script de admin** (`instalar.ps1`), na pasta
   `firmware/esp32/windows/`:
   - copia o ouvinte para `C:\Program Files\Sagyou-ESP32\` (só administradores escrevem
     ali: o usuário comum não consegue trocar o script que roda como SYSTEM);
   - cria `C:\ProgramData\Sagyou-ESP32\` com permissão só para SYSTEM e Administradores,
     com `lan.key`, `ultimo-at.txt` e `ouvinte.log`;
   - gera a `LAN_KEY` se não existir e a mostra **uma vez**;
   - cria a tarefa agendada "Sagyou ESP32" (ao iniciar, como SYSTEM, reiniciar se falhar);
   - cria duas regras de firewall de entrada **só para o IP do ESP32**: UDP 9999 e ICMPv4
     eco (para o ping).
   `desinstalar.ps1` desfaz tudo (tarefa, regras, pastas).
8. **O ping no PC é ICMP** (biblioteca `ESP32Ping` em versão fixa). O Windows bloqueia eco
   por padrão; a regra do item 7 libera só para o ESP32.
9. **Wake-on-LAN:** o pacote mágico vai para o broadcast da sub-rede
   (`192.168.15.255`) na porta 9, 3 vezes.
10. **Vigia:** o watchdog do ESP32 reinicia a placa se o laço travar por mais de 60 s; sem
    Wi-Fi por 5 min, reinicia também.
11. **LED azul:** aceso = Wi-Fi e relógio certos; piscando devagar = sem Wi-Fi ou sem NTP;
    três piscadas rápidas = executou um comando.

## Comportamento

### Ciclo do ESP32 (a cada 10 s)

1. Sem Wi-Fi ou sem NTP: não consulta o Worker (decisão 3); LED piscando.
2. `GET /power/next` com `Authorization: Bearer <POWER_TOKEN>`.
   - `{ "command": null }`: nada a fazer.
   - Com comando: aplica as regras de `docs/esp32-api.md` na ordem (MAC, contador, relógio,
     prazo). A primeira que falha vira o `lastResult` (`mac`, `old`, `clock`, `expired`).
   - Passou: grava o `at` na flash (NVS), executa e `lastResult = "ok"`.
     - `wake`: pacote mágico (decisão 9).
     - `shutdown` / `abort-shutdown`: datagrama assinado ao PC (decisão 4).
3. Ping ao PC (1 tentativa, 1 s).
4. `POST /power/state` com `{ pcPing, lastResult, at, mac }` assinado como no contrato.
5. Respostas `401` ou `501` do Worker: log no monitor serial, tenta de novo no próximo
   ciclo; o firmware não muda de comportamento.

### Ouvinte do Windows

| Situação | O que acontece | Log (`ouvinte.log`, sem a chave nem o datagrama inteiro) |
|---|---|---|
| Datagrama de outro IP | descarta | `recusado: origem` |
| Formato diferente da expressão | descarta | `recusado: formato` |
| HMAC errado | descarta | `recusado: assinatura` |
| `at` ≤ último aceito | descarta (inclui as 2 repetições) | `recusado: repetido` |
| `|at − agora| > 60 s` | descarta | `recusado: relógio` |
| `shutdown` válido | `shutdown.exe /s /t 60 /c "Sagyou: desligando pelo ESP32"` | `executou: shutdown` |
| `abort-shutdown` válido | `shutdown.exe /a` | `executou: abort-shutdown` |

O log guarda no máximo 1 MB (o mais antigo sai).

### Instalar

1. No PC, como administrador: `.\instalar.ps1 -Esp32Ip 192.168.15.251`.
2. O script mostra a `LAN_KEY` uma vez: copiar para o `secrets.h`.
3. Gravar o firmware com o `secrets.h` completo.
4. Teste: "Forçar o desligamento" pelo celular → o PC mostra o aviso de 60 s → "Cancelar"
   → o aviso some.

## Dados

Sem mudança no Sagyou (SQLite, backup, Worker, D1).

- **ESP32, NVS:** `lastAt` (int64, ms), o último comando executado; sobrevive a reinício e
  falta de luz.
- **ESP32, `secrets.h`** (fora do git; o teste `firmware-secrets.test.ts` barra):
  `WIFI_*`, `ESP32_IP`/`GATEWAY_IP`/`SUBNET_MASK`/`DNS_IP` (já existem), e os novos
  `WORKER_URL`, `POWER_TOKEN`, `ESP32_KEY`, `LAN_KEY`, `PC_IP`, `PC_MAC`. O
  `secrets.example.h` ganha os mesmos nomes com valores de exemplo.
- **PC, `C:\ProgramData\Sagyou-ESP32\`** (SYSTEM e Administradores): `lan.key`,
  `ultimo-at.txt`, `ouvinte.log`. Fora do Sagyou, do backup e do sync.

## Telas

Nenhuma tela nova. O que o usuário vê já existe na aba "PC" do celular (estado, "ESP32 sem
contato", "O ESP32 recusou o comando: relógio do celular errado."). `docs/esp32-api.md`
ganha a seção do protocolo da rede local e do ouvinte; o README do firmware ganha a
instalação no Windows e o teste de ponta a ponta.

## Perguntas em aberto

(nenhuma)
