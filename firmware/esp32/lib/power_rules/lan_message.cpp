#include "lan_message.h"

#include <stdio.h>
#include <string.h>

#include "hex.h"
#include "sha256.h"

bool lanMessage(const char *cmd, int64_t at, const uint8_t key[32], char *out, size_t outLen) {
  if (!cmd || (strcmp(cmd, "shutdown") != 0 && strcmp(cmd, "abort-shutdown") != 0)) return false;
  if (at < 1000000000000LL || at > 9999999999999LL) return false;
  char body[64];
  int len = snprintf(body, sizeof body, "sagyou-lan|1|%s|%lld", cmd, (long long)at);
  if (len <= 0 || len >= (int)sizeof body) return false;
  // body + '|' + 64 hex + '\0'
  if (outLen < (size_t)len + 1 + 64 + 1) return false;
  uint8_t digest[32];
  hmacSha256(key, 32, body, (size_t)len, digest);
  char hex[65];
  toHexLower(digest, 32, hex);
  snprintf(out, outLen, "%s|%s", body, hex);
  return true;
}
