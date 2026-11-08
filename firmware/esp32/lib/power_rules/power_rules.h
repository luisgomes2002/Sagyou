// The rules for a command from the Worker (docs/esp32-api.md), in order: MAC,
// counter, clock, deadline. Same decisions as decideCommand in
// sync-server/scripts/esp32-sim.mjs.
#pragma once
#include <stdint.h>

// How far the phone's clock (the command's `at`) may be from NTP time. Not the
// 30 s CLOCK_SKEW_MS of the remote-control envelope in @sagyou/core.
constexpr int64_t POWER_CLOCK_SKEW_MS = 300000;

struct Decision {
  bool run;
  // "ok", "mac", "old", "clock" or "expired" (the reported lastResult).
  const char *result;
  // The counter to keep: the command's `at` when it runs, the old one otherwise.
  int64_t lastAt;
};

// `mac`: 64 lowercase hex characters as the phone sent them.
Decision decideCommand(const char *cmd, int64_t at, int64_t exp, const char *mac,
                       const uint8_t key[32], int64_t lastAt, int64_t now);

// HMAC-SHA256 of "sagyou-power|1|<cmd>|<at>|<exp>", lowercase hex, '\0' ended.
void commandMac(const char *cmd, int64_t at, int64_t exp, const uint8_t key[32], char out[65]);

// HMAC-SHA256 of "sagyou-power-state|1|<1|0>|<lastResult>|<at>", lowercase hex.
void stateMac(bool pcPing, const char *lastResult, int64_t at, const uint8_t key[32],
              char out[65]);
