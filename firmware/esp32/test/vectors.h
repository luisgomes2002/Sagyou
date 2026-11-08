// Gerado por test/gen-vectors.mjs. Não edite à mão.
// Chave PÚBLICA de teste (00 01 02 … 1f): nunca uma chave real. É o único arquivo do
// firmware com 64 hexadecimais no git (sync-server/src/__tests__/firmware-secrets.test.ts).
#pragma once
#include <stdint.h>

#define TEST_KEY_HEX "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

struct CommandVector {
  const char *cmd;
  int64_t at;
  int64_t exp;
  const char *mac;
};

static const CommandVector COMMAND_VECTORS[] = {
    {"wake", 1800000000000LL, 1800000120000LL, "265f75650e55174645d21e0fca3085c48f32aa0a9c31a4f78a6e3851da31130c"},
    {"shutdown", 1800000060000LL, 1800000180000LL, "3f8bbd02f9b6be5872c9eaef79a4003310099e3ff3a5b3e16e81891c3c8043d0"},
    {"abort-shutdown", 1800000090000LL, 1800000210000LL, "f08cb3c82b1ad1982a80ad3d455de94cb07d06ff016242d1c58de7a86b62fc6a"},
};

struct StateVector {
  bool pcPing;
  const char *lastResult;
  int64_t at;
  const char *mac;
};

static const StateVector STATE_VECTORS[] = {
    {true, "ok", 1800000005000LL, "c400f011589d98a7189ed0e07857cc9d44502b27dd5c460645dab8f3dc25292d"},
    {false, "", 1800000015000LL, "cdde79fa3ef61f510db31f6deb5f85fe91a30999f57001c9c8169a48d4f41c76"},
    {true, "clock", 1800000025000LL, "c22c7dddbd142e98092806d4c25dcdea7380dfa1fba5ae8e7efd863ab28ab857"},
};

// Rede local: shutdown com at = 1800000000000.
#define LAN_VECTOR "sagyou-lan|1|shutdown|1800000000000|12bb940a066615e6d31b9ce4caa28ecb585e438c9b53c7b8567794f565d321ea"

// HMAC-SHA256 da RFC 4231, casos 1, 2 e 6.
#define RFC4231_CASE1 "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
#define RFC4231_CASE2 "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
#define RFC4231_CASE6 "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
