# Contrato do firmware do ESP32

Como o ESP32 que liga e desliga o PC de casa conversa com o Worker do Sagyou. O firmware
mora em [`firmware/esp32/`](../firmware/esp32/) (task "Sync 6.6") e deve seguir este
documento. O repositório é público: o `secrets.h` fica fora do git (`.gitignore` e o teste
`sync-server/src/__tests__/firmware-secrets.test.ts`).
Spec: `docs/specs/2026-11-03-controle-remoto-app.md`. Para testar sem o hardware, use o
simulador `sync-server/scripts/esp32-sim.mjs` (no fim deste documento).

## O que o ESP32 faz

- A cada **10 s**, busca o próximo comando no Worker (`GET /power/next`).
- Confere o comando (MAC, contador, relógio e prazo, nessa ordem) e só então executa:
  - `wake`: envia o pacote mágico (Wake-on-LAN) para o MAC do PC.
  - `shutdown`: pede ao `ouvir-esp32.ps1` do PC o desligamento (`shutdown /s /t 60`).
  - `abort-shutdown`: pede ao `ouvir-esp32.ps1` o cancelamento (`shutdown /a`).
- Faz ping no IP fixo do PC e informa o estado assinado (`POST /power/state`) a cada
  consulta, com o resultado do último comando.

O ESP32 nunca vê dados do Sagyou. O token dele só abre `/power/next` e `/power/state`.

## Segredos (`secrets.h`, fora do git)

| Nome | Origem | Formato |
|---|---|---|
| `WORKER_URL` | o endereço do seu Worker | `https://sagyou-sync.<conta>.workers.dev` |
| `POWER_TOKEN` | Sagyou → Configurações → Controle remoto → "Gerar token do ESP32" | texto, até 128 caracteres `[A-Za-z0-9_-]` |
| `ESP32_KEY` | mostrada junto com o token, uma vez | 64 caracteres hexadecimais (32 bytes) |
| Wi-Fi, MAC e IP do PC | sua rede | — |

Gerar um token novo invalida o anterior. A chave do ESP32 também é trocada ao gerar de novo;
os celulares autorizados recebem a nova pelo PC.

## Rotas

Toda chamada leva `Authorization: Bearer <POWER_TOKEN>`. Sem ele, ou com token errado: `401
{"error":"unauthorized"}`. Worker sem as tabelas do controle remoto: `501
{"error":"control not deployed"}`.

### `GET /power/next`

Marca a hora da consulta (é o que faz o app mostrar ou não "ESP32 sem contato") e entrega o
comando pendente, uma vez só:

```json
{ "command": { "cmd": "wake", "at": 1800000000000, "exp": 1800000120000, "mac": "<64 hex>" } }
```

ou `{ "command": null }`. O Worker repassa o comando como o celular o enviou, sem conferir o
MAC (ele não tem a chave). Um comando não buscado em 2 min expira no Worker.

### `POST /power/state`

```json
{ "pcPing": true, "lastResult": "ok", "at": 1800000005000, "mac": "<64 hex>" }
```

- `pcPing`: o PC respondeu ao ping agora.
- `lastResult`: resultado do último comando recebido: `ok`, `mac`, `old`, `clock`, `expired`,
  ou `""` antes do primeiro comando.
- `at`: hora NTP do relatório, em ms.
- `mac`: ver abaixo. O app ignora um estado com MAC errado e mostra "ESP32 sem contato".

Resposta `200 {"ok":true}`; campo inválido: `400`.

## MAC (HMAC-SHA256, hexadecimal minúsculo)

A chave é a `ESP32_KEY` decodificada do hexadecimal (32 bytes). A mensagem é texto UTF-8:

- Comando: `sagyou-power|1|<cmd>|<at>|<exp>`
- Estado: `sagyou-power-state|1|<pcPing ? 1 : 0>|<lastResult>|<at>`

Números em decimal, sem espaços. Exemplo: `sagyou-power|1|wake|1800000000000|1800000120000`.
Compare o MAC em tempo constante.

## Regras para executar um comando

Na ordem; a primeira que falhar define o `lastResult` e o comando é ignorado:

1. **MAC** confere e `cmd` é `wake`, `shutdown` ou `abort-shutdown` → senão `mac`.
2. **Contador**: `at` é **estritamente maior** que o último `at` executado → senão `old`.
   O último `at` fica guardado **na flash** (sobrevive a reinício e falta de luz), assim
   ninguém consegue repetir um comando capturado.
   O `at` vem do relógio do celular que mandou o comando: um celular adiantado (até 5 min,
   o limite da regra 3) faz os comandos seguintes de outro celular serem recusados como `old`
   por esse tempo.
3. **Relógio**: `|at − agora NTP| ≤ 5 min` → senão `clock` (o app mostra "O ESP32 recusou o
   comando: relógio do celular errado.").
4. **Prazo**: `exp > agora NTP` → senão `expired`.

Executou: grave o novo `at` na flash **antes** de agir e informe `lastResult: "ok"`.

Sem NTP sincronizado, **não consulte `/power/next` nem informe o estado**: o comando é
entregue uma vez só e não daria para conferi-lo (regra 3), e o `at` e o MAC do estado
dependem da hora. O app mostra "ESP32 sem contato" até o relógio acertar (uns 10 s depois
de ligar). (Spec `docs/specs/2026-11-07-esp32-firmware.md`.)

## Rede local: o pedido de desligar ao PC

`shutdown` e `abort-shutdown` não vão direto ao Windows: o ESP32 manda um pedido assinado ao
ouvinte `ouvir-esp32.ps1` (`firmware/esp32/windows/`), que roda como SYSTEM.

- **Transporte:** UDP para o IP fixo do PC, porta **9999**, 3 envios com 200 ms entre eles
  (o contador descarta as cópias).
- **Mensagem (texto):** `sagyou-lan|1|<cmd>|<at>|<hmac>`
  - `cmd`: `shutdown` ou `abort-shutdown`;
  - `at`: hora NTP do ESP32 em ms, 13 dígitos;
  - `hmac`: HMAC-SHA256 hexadecimal minúsculo de `sagyou-lan|1|<cmd>|<at>` com a **`LAN_KEY`**
    (32 bytes, gerada pelo `instalar.ps1` e mostrada uma vez; diferente da `ESP32_KEY`).
- **O ouvinte**, nesta ordem: IP de origem igual ao do ESP32 (o firewall já filtra), no
  máximo 200 bytes, a expressão exata
  `^sagyou-lan\|1\|(shutdown|abort-shutdown)\|([0-9]{13})\|([0-9a-f]{64})$`, HMAC em tempo
  constante, `at` maior que o último aceito (em `C:\ProgramData\Sagyou-ESP32\ultimo-at.txt`,
  gravado antes de agir), `|at − agora| ≤ 60 s`. Aceito: roda só
  `C:\Windows\System32\shutdown.exe /s /t 60 /c "Sagyou: desligando pelo ESP32"` ou
  `shutdown.exe /a`.
- **Log:** `C:\ProgramData\Sagyou-ESP32\ouvinte.log` (`recusado: origem|formato|assinatura|repetido|relógio`,
  `executou: shutdown|abort-shutdown`), no máximo 1 MB; nunca a chave nem o datagrama.

O ESP32 não escuta porta nenhuma e não tem OTA: só faz conexões de saída.

## Intervalos

| O quê | Intervalo |
|---|---|
| Consulta a `/power/next` e relatório em `/power/state` | 10 s |
| "ESP32 sem contato" no app | sem consulta há ≥ 2 min |
| Validade de um comando | 2 min |
| Desligamento pedido ao Windows | `shutdown /s /t 60` (cancelável por 60 s) |

## Simulador

```bash
node sync-server/scripts/esp32-sim.mjs --url https://<worker> --token <POWER_TOKEN> --key <ESP32_KEY> --ping on
```

Consulta o Worker a cada 10 s, aplica as mesmas regras, imprime o que executaria e informa o
estado assinado. Com `--ping off` o PC aparece desligado para o app; um `wake` aceito liga o
ping. Não liga nem desliga nada e guarda o contador só na memória. As regras estão testadas em
`sync-server/src/__tests__/esp32-sim.test.ts`, com o MAC conferido contra o do
`@sagyou/core`.
