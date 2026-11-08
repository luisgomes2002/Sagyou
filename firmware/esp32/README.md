# Firmware do ESP32

O ESP32 que liga e desliga o PC de casa para o controle remoto do Sagyou. Spec
[`docs/specs/2026-11-07-esp32-firmware.md`](../../docs/specs/2026-11-07-esp32-firmware.md);
contrato com o Worker e com o PC em [`docs/esp32-api.md`](../../docs/esp32-api.md).

Placa: ESP32 DevKit (WROOM-32), USB pelo chip WCH CH9102 (driver do próprio Windows).
Ferramenta: PlatformIO.

> ⚠️ **Este repositório é público.** O `include/secrets.h` (Wi-Fi, token, `ESP32_KEY` e
> `LAN_KEY`) fica fora do git: está no `.gitignore`, e o teste
> `sync-server/src/__tests__/firmware-secrets.test.ts` falha se ele, o build `.pio/` ou uma
> chave de 64 hexadecimais forem versionados (a única exceção é `test/vectors.h`, com a chave
> **pública** de teste `00 01 02 … 1f`). Nunca cole esses valores em issue, PR ou chat.

## O que ele faz

A cada 10 s, com Wi-Fi e relógio (NTP) certos:

1. busca o próximo comando no Worker (`GET /power/next`, HTTPS com o certificado conferido);
2. confere o comando (MAC, contador, relógio, prazo), grava o contador na flash e só então
   age: `wake` → Wake-on-LAN; `shutdown`/`abort-shutdown` → pedido assinado ao PC (UDP 9999);
3. faz ping no PC e informa o estado assinado (`POST /power/state`).

Não escuta porta nenhuma e não tem OTA. LED azul: aceso = tudo certo; piscando devagar =
esperando Wi-Fi ou NTP; três piscadas = executou um comando; piscando rápido sem parar =
erro no `secrets.h`.

## Instalar no Windows (uma vez, como administrador)

O ouvinte `windows/ouvir-esp32.ps1` recebe o pedido de desligar e roda como SYSTEM.

```powershell
cd firmware\esp32\windows
.\instalar.ps1 -Esp32Ip 192.168.15.251
```

Ele copia o ouvinte para `C:\Program Files\Sagyou-ESP32\`, cria `C:\ProgramData\Sagyou-ESP32\`
(só SYSTEM e Administradores), a tarefa agendada "Sagyou ESP32" e duas regras de firewall
(UDP 9999 e ping) **só para o IP do ESP32**, e mostra a `LAN_KEY` **uma vez**: copie-a para
o `secrets.h`. Para remover tudo: `.\desinstalar.ps1`.

## Preencher o `secrets.h`

Copie `include/secrets.example.h` para `include/secrets.h` e preencha:

| Nome | De onde vem |
|---|---|
| `WIFI_SSID`, `WIFI_PASSWORD` | sua rede (2,4 GHz) |
| `ESP32_IP`, `GATEWAY_IP`, `SUBNET_MASK`, `DNS_IP` | IP fixo do ESP32 |
| `WORKER_URL` | o endereço do seu Worker, sem `/` no fim |
| `POWER_TOKEN`, `ESP32_KEY` | Sagyou → Configurações → Controle remoto → "Gerar token do ESP32" (aparecem uma vez) |
| `LAN_KEY` | mostrada pelo `instalar.ps1` |
| `PC_IP`, `PC_MAC` | IP fixo e MAC da placa de rede de cabo do PC |

## Gravar

Nesta pasta (`firmware/esp32/`):

1. Instale o PlatformIO: `py -m pip install --user platformio`.
2. Ligue a placa no USB com um cabo **de dados** (um cabo só de carga acende o LED, mas o
   Windows não vê a placa).
3. Segure o botão **BOOT** e rode `py -m platformio run -e esp32dev -t upload`; solte quando
   aparecer `Writing at 0x...`. No fim, aperte **EN**.
4. `py -m platformio device monitor` mostra o que o firmware imprime.

## Testes (locais)

- Regras do firmware: `py -m platformio test -e native` (usa o g++ do PC).
- Ouvinte do Windows: `powershell -NoProfile -File windows\testes.ps1`.
- No CI: `sync-server/src/__tests__/esp32-vectors.test.ts` confere que `test/vectors.h` bate
  com o `@sagyou/core`. Para regenerar os vetores: `node test/gen-vectors.mjs`.

## Teste de ponta a ponta

1. Monitor serial: "ESP32-PC-BOOT" e, em ~10 s, nenhum "Aguardando".
2. Celular, aba PC: "ESP32 sem contato" some.
3. "Forçar o desligamento" (com o Sagyou fechado) → o Windows avisa que vai desligar em 60 s →
   "Cancelar" → o aviso some. `ouvinte.log` mostra `executou: shutdown` e `executou: abort-shutdown`.
4. Com o PC desligado (BIOS e placa de rede configuradas): "Ligar" → o PC liga.

## Lista de CAs (`data/cert/x509_crt_bundle.bin`)

Gerada com o `gen_crt_bundle.py` e o `cacrt_all.pem` do ESP-IDF **v4.4.7**
(`components/mbedtls/esp_crt_bundle/`), sem filtro (135 CAs):

```bash
py -m pip install --user cryptography==43.0.3
py gen_crt_bundle.py --input cacrt_all.pem   # gera x509_crt_bundle
```

Regenere se o Worker trocar para uma CA que não esteja na lista.
