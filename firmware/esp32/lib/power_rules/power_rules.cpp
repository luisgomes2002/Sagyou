#include "power_rules.h"

#include <stdio.h>
#include <string.h>

#include "hex.h"
#include "sha256.h"

namespace {

bool knownCommand(const char *cmd) {
  return cmd && (strcmp(cmd, "wake") == 0 || strcmp(cmd, "shutdown") == 0 ||
                 strcmp(cmd, "abort-shutdown") == 0);
}

void macOf(const char *msg, int len, const uint8_t key[32], char out[65]) {
  uint8_t digest[32];
  if (len < 0) len = 0;
  hmacSha256(key, 32, msg, (size_t)len, digest);
  toHexLower(digest, 32, out);
}

int64_t absDiff(int64_t a, int64_t b) { return a > b ? a - b : b - a; }

}  // namespace

void commandMac(const char *cmd, int64_t at, int64_t exp, const uint8_t key[32], char out[65]) {
  char msg[96];
  int len = snprintf(msg, sizeof msg, "sagyou-power|1|%s|%lld|%lld", cmd ? cmd : "",
                     (long long)at, (long long)exp);
  if (len >= (int)sizeof msg) len = (int)sizeof msg - 1;
  macOf(msg, len, key, out);
}

void stateMac(bool pcPing, const char *lastResult, int64_t at, const uint8_t key[32],
              char out[65]) {
  char msg[96];
  int len = snprintf(msg, sizeof msg, "sagyou-power-state|1|%d|%s|%lld", pcPing ? 1 : 0,
                     lastResult ? lastResult : "", (long long)at);
  if (len >= (int)sizeof msg) len = (int)sizeof msg - 1;
  macOf(msg, len, key, out);
}

Decision decideCommand(const char *cmd, int64_t at, int64_t exp, const char *mac,
                       const uint8_t key[32], int64_t lastAt, int64_t now) {
  // 1. MAC (an unknown command never gets past this).
  char expected[65];
  commandMac(cmd, at, exp, key, expected);
  if (!knownCommand(cmd) || !sameHexConstantTime(mac, expected)) return {false, "mac", lastAt};
  // 2. Counter: strictly newer than the last command executed.
  if (at <= lastAt) return {false, "old", lastAt};
  // 3. The phone's clock against NTP.
  if (absDiff(at, now) > POWER_CLOCK_SKEW_MS) return {false, "clock", lastAt};
  // 4. Deadline.
  if (exp <= now) return {false, "expired", lastAt};
  return {true, "ok", at};
}
