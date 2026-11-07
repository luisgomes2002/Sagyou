# Firmware do ESP32

O ESP32 que liga e desliga o PC de casa para o controle remoto do Sagyou. O contrato com o
Worker está em [`docs/esp32-api.md`](../../docs/esp32-api.md).

Placa: ESP32 DevKit (WROOM-32), USB pelo chip WCH CH9102 (driver do próprio Windows).
Ferramenta: PlatformIO.

> ⚠️ **Este repositório é público.** O `include/secrets.h` (Wi-Fi e, nas próximas etapas,
> o token e a chave do ESP32) fica fora do git: está no `.gitignore`, e o teste
> `sync-server/src/__tests__/firmware-secrets.test.ts` falha se ele, o build `.pio/` ou uma
> chave de 64 hexadecimais forem versionados. Nunca cole esses valores em issue, PR ou chat.

## Etapas

1. **Teste da placa** (agora): Wi-Fi, NTP, MAC e IP no monitor serial.
2. Rede local: Wake-on-LAN, ping no PC e o pedido de desligar assinado ao script do Windows.
3. Worker: `GET /power/next` e `POST /power/state` a cada 10 s, com HMAC, contador na flash,
   relógio e prazo (`docs/esp32-api.md`).

## Gravar

Nesta pasta (`firmware/esp32/`):

1. Instale o PlatformIO: `py -m pip install --user platformio` (ou a extensão do VS Code).
2. Copie `include/secrets.example.h` para `include/secrets.h` e preencha o Wi-Fi (rede de
   2,4 GHz: o ESP32 não conecta em 5 GHz).
3. Ligue a placa no USB com um cabo **de dados** (um cabo só de carga acende o LED, mas o
   Windows não vê a placa).
4. `py -m platformio run -t upload` e, quando aparecer `Connecting...`, segure o botão
   **BOOT** até começar a gravar. Depois aperte **EN** para reiniciar.
5. `py -m platformio device monitor` mostra o que o firmware imprime.
