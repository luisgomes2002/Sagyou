# Plano de implementação: Firmware do ESP32 (ligar e desligar o PC)

Status: approved by Luis on 2026-11-07
Spec: docs/specs/2026-11-07-esp32-firmware.md
Branch: feature/esp32-firmware

**Objetivo:** o ESP32 cumpre `docs/esp32-api.md` (Wake-on-LAN, estado assinado, comandos do
Worker) e desliga o PC por um pedido assinado na rede local a um ouvinte SYSTEM no Windows.

**Arquitetura:** a lógica que decide (SHA-256/HMAC, hex, regras do comando, mensagem da rede
local) fica numa biblioteca C++ pura, `firmware/esp32/lib/power_rules/`, sem Arduino, testada
no PC com `pio test -e native` contra vetores ligados ao `@sagyou/core` por um teste do CI.
O `src/main.cpp` só faz rede e hardware. No Windows, `ouvir-esp32.ps1` separa a decisão
(função pura `Test-SagyouLanDatagram`, testada por `testes.ps1`) do laço UDP e do `shutdown.exe`.

## Restrições Globais

- Testes do firmware e do script **rodam localmente** (decisão de Luis): `pio test -e native`
  em `firmware/esp32/` e `powershell -NoProfile -File firmware/esp32/windows/testes.ps1`. O
  resto (o teste que liga os vetores ao core, o guarda de segredos) roda no CI pelo PR.
- Nunca `setInsecure()`; HTTPS sempre com o pacote de CAs.
- Sem OTA, sem servidor no ESP32 (nenhum `WiFiServer`, `WebServer`, `ArduinoOTA`).
- Mensagem da rede local: `sagyou-lan|1|<cmd>|<at>|<hmac>`, `cmd` ∈ {`shutdown`,
  `abort-shutdown`}, `at` = 13 dígitos, `hmac` = HMAC-SHA256 hex minúsculo de
  `sagyou-lan|1|<cmd>|<at>` com a `LAN_KEY`; UDP porta **9999**; 3 envios, 200 ms.
- Expressão do ouvinte: `^sagyou-lan\|1\|(shutdown|abort-shutdown)\|(\d{13})\|([0-9a-f]{64})$`;
  máximo 200 bytes; relógio `|at − agora| ≤ 60 000` ms.
- Ordem das regras do comando do Worker: MAC, contador (`at > lastAt`), relógio
  (`|at − agora| ≤ 300 000` ms), prazo (`exp > agora`); resultados `mac`, `old`, `clock`,
  `expired`, `ok` (igual a `decideCommand` em `sync-server/scripts/esp32-sim.mjs`).
- Comando de desligar: `C:\Windows\System32\shutdown.exe /s /t 60 /c "Sagyou: desligando pelo ESP32"`;
  cancelar: `C:\Windows\System32\shutdown.exe /a`.
- Pastas no PC: `C:\Program Files\Sagyou-ESP32\` (script) e `C:\ProgramData\Sagyou-ESP32\`
  (`lan.key`, `ultimo-at.txt`, `ouvinte.log`, ACL só SYSTEM e Administradores). Tarefa
  agendada: `Sagyou ESP32`. Regras de firewall: `Sagyou ESP32 UDP 9999` e `Sagyou ESP32 ping`.
- Ciclo 10 s; WoL para `192.168.15.255`:9, 3 vezes; ping 1 tentativa, 1 s; watchdog 60 s;
  sem Wi-Fi por 5 min → reinicia.
- Nada de segredo no git: o `firmware-secrets.test.ts` continua valendo; a única exceção é
  `firmware/esp32/test/vectors.h`, que usa a chave pública de teste `000102…1f`.

## Decisões do plano

1. **SHA-256 e HMAC próprios** (`lib/power_rules/sha256.*`, ~120 linhas, domínio público
   no estilo do FIPS 180-4), usados no ESP32 e no teste nativo. Assim o código que roda na
   placa é o mesmo testado no PC (o mbedtls não existe no `native`).
2. **Vetores:** `firmware/esp32/test/gen-vectors.mjs` (Node, `node:crypto`) gera
   `test/vectors.h` uma vez com a chave de teste `000102…1f`; o teste
   `sync-server/src/__tests__/esp32-vectors.test.ts` confere no CI que os MACs de comando e
   de estado do arquivo são os de `powerCommandMac`/`powerStateMac` do `@sagyou/core`. Se o
   core mudar, o CI quebra antes de a placa discordar do celular.
3. **Pacote de CAs:** `data/cert/x509_crt_bundle.bin`, gerado com o `gen_crt_bundle.py` e o
   `cacrt_all.pem` do ESP-IDF **v4.4.7** (o README diz como regenerar), embutido por
   `board_build.embed_files` e usado com `WiFiClientSecure::setCACertBundle`.
4. **Ping:** biblioteca `marian-craciunescu/ESP32Ping@1.7` (versão fixa em `lib_deps`).
5. **Testes do PowerShell sem Pester:** `windows/testes.ps1` com um `Assert-Equal` próprio
   (o Windows traz um Pester 3.4 antigo; não instalar nada).
6. **Só `test/vectors.h` tem 64 hex no git** (checagem do construtor). O `testes.ps1` **lê o
   vetor `LAN` de `../test/vectors.h` em tempo de execução**; o `gen-vectors.mjs` monta a
   chave com `Uint8Array.from({ length: 32 }, (_, i) => i)`; o README não mostra chave. O
   guarda continua com uma única exceção.
7. **Sem NTP, o ESP32 nem busca comando nem posta estado** (o `at` e o MAC do estado dependem
   da hora): o app mostra "ESP32 sem contato" até o NTP acertar. A linha 93 de
   `docs/esp32-api.md` ("continue informando o estado") é corrigida na Task 7.
8. **`lastResult` só em memória:** começa `""` a cada ligação e repete o último valor a cada
   ciclo até o próximo comando. Depois de uma queda de luz o celular vê `""`, que é verdade
   (nenhum comando desde que ligou).
9. **O "gravar antes de agir" e o "sem NTP não consulta" ficam testáveis**: a Task 6 começa
   extraindo para `lib/power_rules/power_cycle.h` as funções `bool shouldPollWorker(bool wifi, bool ntp)`
   e `bool runCommand(const Decision& d, bool (*persist)(int64_t), void (*act)())`
   (grava; só age se gravou), testadas no `native`.
10. **Nomes:** a tolerância do relógio na lib é `POWER_CLOCK_SKEW_MS = 300000` (não confundir com
    o `CLOCK_SKEW_MS` de 30 s do envelope do controle remoto no core); a da rede local é
    `LAN_CLOCK_SKEW_MS = 60000`.
11. **Vetor `LAN`:** não há função de rede local no core para comparar no CI; o HMAC é o mesmo
    já ligado ao core pelos vetores de comando e estado. Risco aceito.
12. **Pré-requisito:** `pio test -e native` usa o g++ do PC (MinGW-W64 15.2 já instalado em
    2026-11-07).

## Foco de Review

1. **Datagrama forjado ou repetido na rede local** → nunca chama `shutdown.exe`; repetido
   (as 3 cópias, ou um capturado) cai em `repetido`. Testado na Task 4.
2. **ESP32 sem NTP depois de uma queda de luz** → não busca `/power/next` (não perde
   comando), não posta estado, não executa. Testado na Task 6 (`shouldPollWorker`).
3. **`lastAt` gravado antes de agir** → depois de reiniciar no meio da execução, o mesmo
   comando não roda duas vezes; se gravar falhar, não age. Testado nas Tasks 2 e 6
   (`runCommand`).
4. **Vetores do firmware divergirem do core** → o CI quebra. Testado na Task 1.
5. **Algum segredo no git** (`secrets.h`, `lan.key`, chave real em `vectors.h`) → o guarda
   falha. Testado na Task 1.

### Task 1: SHA-256, HMAC e hex (biblioteca pura) + vetores ligados ao core
**Arquivos:** Criar `firmware/esp32/lib/power_rules/sha256.h`, `sha256.cpp`, `hex.h`,
`hex.cpp`; `firmware/esp32/test/test_crypto/test_main.cpp`; `firmware/esp32/test/vectors.h`;
`firmware/esp32/test/gen-vectors.mjs`; `sync-server/src/__tests__/esp32-vectors.test.ts`.
Modificar `firmware/esp32/platformio.ini` (`[env:native]`, `test_framework = unity`),
`sync-server/src/__tests__/firmware-secrets.test.ts` (exceção do `vectors.h`).
**Interfaces:** Produz `void hmacSha256(const uint8_t* key, size_t keyLen, const char* msg, size_t msgLen, uint8_t out[32])`,
`void toHexLower(const uint8_t* in, size_t n, char* out)`, `bool parseHex32(const char* hex, uint8_t out[32])`,
`bool sameHexConstantTime(const char* a, const char* b)`.
- [ ] Passo 1: testes: HMAC dos casos 1, 2 e 4 da RFC 4231; o MAC de comando e o de estado
  de `vectors.h` saem iguais; `parseHex32` recusa 63/65 caracteres e não-hex;
  `sameHexConstantTime` com tamanhos diferentes → false. `esp32-vectors.test.ts`: cada
  linha de `vectors.h` bate com `powerCommandMac`/`powerStateMac`.
  `firmware-secrets.test.ts`: `vectors.h` é a única exceção e contém a chave `000102…1f`.
- [ ] Passo 2: `pio test -e native -f test_crypto`. Esperado: FALHA (funções não existem).
- [ ] Passo 3: implemente.
- [ ] Passo 4: `pio test -e native -f test_crypto` PASSA; push e CI PASSA.
- [ ] Passo 5: commit `feat(firmware): SHA-256, HMAC e vetores ligados ao core`

### Task 2: Regras do comando do Worker e MAC do estado
**Arquivos:** Criar `firmware/esp32/lib/power_rules/power_rules.h`, `power_rules.cpp`;
`firmware/esp32/test/test_rules/test_main.cpp`.
**Interfaces:** Consome a Task 1. Produz
`struct Decision { bool run; const char* result; int64_t lastAt; }`,
`Decision decideCommand(const char* cmd, int64_t at, int64_t exp, const char* mac, const uint8_t key[32], int64_t lastAt, int64_t now)`,
`void commandMac(const char* cmd, int64_t at, int64_t exp, const uint8_t key[32], char out[65])`,
`void stateMac(bool pcPing, const char* lastResult, int64_t at, const uint8_t key[32], char out[65])`,
`constexpr int64_t POWER_CLOCK_SKEW_MS = 300000`.
- [ ] Passo 1: testes espelhando `esp32-sim.test.ts`: MAC certo e `at` novo → `ok` e
  `lastAt = at`; `at` igual ou menor → `old`; MAC errado ou `cmd` trocado → `mac`;
  `exp ≤ agora` → `expired`; `|at − agora| > 300 000` → `clock`; `cmd` desconhecido → `mac`;
  ordem (MAC antes de contador). `stateMac` bate com o vetor da Task 1.
- [ ] Passo 2: `pio test -e native -f test_rules`. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: PASSA.
- [ ] Passo 5: commit `feat(firmware): regras do comando do Worker`

### Task 3: Mensagem da rede local (lado do ESP32)
**Arquivos:** Criar `firmware/esp32/lib/power_rules/lan_message.h`, `lan_message.cpp`;
`firmware/esp32/test/test_lan/test_main.cpp`. Modificar `test/vectors.h` (vetor `LAN`).
**Interfaces:** Produz `bool lanMessage(const char* cmd, int64_t at, const uint8_t key[32], char* out, size_t outLen)`
(false para `cmd` fora da lista ou `at` sem 13 dígitos).
- [ ] Passo 1: testes: `shutdown` com `at = 1800000000000` e a chave de teste gera exatamente
  o texto do vetor (`sagyou-lan|1|shutdown|1800000000000|<hmac>`); `wake` → false;
  `at = 999` → false; buffer curto → false. O mesmo vetor vai para o `testes.ps1` (Task 4).
- [ ] Passo 2: `pio test -e native -f test_lan`. Esperado: FALHA.
- [ ] Passo 3: implemente.
- [ ] Passo 4: PASSA.
- [ ] Passo 5: commit `feat(firmware): mensagem assinada da rede local`

### Task 4: Ouvinte do Windows
**Arquivos:** Criar `firmware/esp32/windows/ouvir-esp32.ps1`, `firmware/esp32/windows/testes.ps1`.
**Interfaces:** Consome o vetor `LAN`, lido de `../test/vectors.h` em tempo de execução
(decisão 6). Produz
`Test-SagyouLanDatagram -Bytes <byte[]> -RemoteIp <string> -Esp32Ip <string> -Key <byte[]> -LastAt <long> -Now <long>`
→ `@{ Action = 'shutdown'|'abort-shutdown'|$null; Reason = 'origem'|'formato'|'assinatura'|'repetido'|'relógio'|$null; At = <long> }`.
O laço (`Start-SagyouListener`) só roda quando o script é chamado sem `-Test`.
- [ ] Passo 1: `testes.ps1`: o datagrama do vetor com o IP certo, `LastAt` menor e `Now`
  igual ao `at` → `shutdown`; outro IP → `origem`; 201 bytes → `formato`; `cmd` `format c:`
  → `formato`; HMAC trocado num caractere → `assinatura`; `LastAt = at` → `repetido`;
  `Now = at + 60 001` → `relógio`; bytes não UTF-8 → `formato`; `abort-shutdown` válido →
  `abort-shutdown`. Termina com código 1 se algum falhar.
- [ ] Passo 2: `powershell -NoProfile -File firmware/esp32/windows/testes.ps1`. Esperado: FALHA.
- [ ] Passo 3: implemente; comparação do HMAC em tempo constante (laço com XOR, sem saída
  antecipada); `ultimo-at.txt` gravado antes do `shutdown.exe`; log no formato da tabela da
  spec, 1 MB no máximo (renomeia para `ouvinte.log.1`).
- [ ] Passo 4: PASSA.
- [ ] Passo 5: commit `feat(firmware): ouvinte assinado do Windows`

### Task 5: Instalar e desinstalar no Windows
**Arquivos:** Criar `firmware/esp32/windows/instalar.ps1`, `desinstalar.ps1`. Modificar `testes.ps1`.
**Interfaces:** `instalar.ps1 -Esp32Ip <IPv4> [-PcIp <IPv4>]`; `Test-SagyouIpv4 <string>` → bool.
- [ ] Passo 1: testes: `Test-SagyouIpv4` aceita `192.168.15.251`, recusa `999.1.1.1`,
  `192.168.15`, `a.b.c.d`; os dois scripts passam no parser do PowerShell
  (`[System.Management.Automation.Language.Parser]::ParseFile` sem erros).
- [ ] Passo 2: rode o `testes.ps1`. Esperado: FALHA.
- [ ] Passo 3: implemente: exige admin; copia o ouvinte para `Program Files`; cria
  `ProgramData` com ACL (SYSTEM, Administradores, herança desligada); gera a `lan.key` (32
  bytes, `RandomNumberGenerator`) se não existir e a mostra **uma vez** em hex; tarefa
  `Sagyou ESP32` (gatilho ao iniciar, SYSTEM, reiniciar a cada 1 min até 999 vezes); regras de
  firewall com `-RemoteAddress <Esp32Ip>`. `desinstalar.ps1` remove tarefa, regras e as
  duas pastas.
- [ ] Passo 4: PASSA.
- [ ] Passo 5: commit `feat(firmware): instalar o ouvinte no Windows`

### Task 6: Firmware na placa (rede, Worker, ações)
**Arquivos:** Modificar `firmware/esp32/src/main.cpp`, `include/secrets.example.h`,
`platformio.ini` (`lib_deps`, `board_build.embed_files`). Criar `data/cert/x509_crt_bundle.bin`.
**Interfaces:** Consome as Tasks 1–3.
- [ ] Passo 1: teste `test/test_cycle/test_main.cpp` (decisão 9): `shouldPollWorker` só true
  com Wi-Fi **e** NTP; `runCommand` com `persist` que falha não chama `act`; com `persist` ok
  chama `persist` antes de `act` (ordem registrada pelos fakes); `Decision.run = false` não
  chama nenhum dos dois. `secrets.example.h` ganha `WORKER_URL`, `POWER_TOKEN`, `ESP32_KEY`,
  `LAN_KEY`, `PC_IP`, `PC_MAC` com valores de exemplo (sem 64 hex seguidos:
  `"cole-aqui-a-chave"`).
- [ ] Passo 2: `pio test -e native -f test_cycle`. Esperado: FALHA (`power_cycle.h` não existe).
- [ ] Passo 3: implemente o ciclo da spec: NVS (`Preferences`, chave `lastAt`, gravada antes de
  agir), sem NTP sem `/power/next`, `WiFiClientSecure` com o pacote, `HTTPClient` com
  `Authorization: Bearer`, JSON com `ArduinoJson@7.2.1` (versão fixa), WoL, `WiFiUDP` para o
  PC, `Ping.ping(PC_IP, 1)`, LED, `esp_task_wdt` de 60 s.
- [ ] Passo 4: `pio test -e native` passa (inclui `test_cycle`); `pio run -e esp32dev` compila.
- [ ] Passo 5: commit `feat(firmware): ciclo com o Worker, Wake-on-LAN e pedido ao PC`

### Task 7: Documentação
**Arquivos:** Modificar `docs/esp32-api.md` (seção "Rede local": mensagem, porta, ouvinte,
chaves; e a regra "sem NTP" passa a dizer que o ESP32 não consulta nem informa o estado,
decisão 7), `firmware/esp32/README.md` (instalar no Windows, `secrets.h` completo, testes
locais, teste de ponta a ponta, como regenerar o pacote de CAs), `CLAUDE.md`/`GUIDE.md`
(uma linha: testes do firmware locais).
- [ ] Passo 1: commit `docs(firmware): rede local, ouvinte e instalação`

### Task 8: Fechamento
- [ ] `pio test -e native` e `testes.ps1` passam localmente; CI do PR passa (vetores, segredos).
- [ ] Com Luis: `instalar.ps1` como admin (anotar a `LAN_KEY` no `secrets.h`); gerar o token e a
  chave do ESP32 no Sagyou; gravar; no monitor, ver "Relógio certo" e o ciclo do Worker; no
  celular, "ESP32 sem contato" some; "Forçar o desligamento" → aviso de 60 s no PC →
  "Cancelar" → aviso some; com o PC desligado (BIOS ajustada), "Ligar" → o PC liga.
- [ ] `/sagyou-review` com `sagyou-security-reviewer` → `/sagyou-pr`.
