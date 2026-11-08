// The two rules of the ESP32 cycle that decide whether a command can be lost or
// run twice (spec docs/specs/2026-11-07-esp32-firmware.md).
#pragma once
#include <stdint.h>

#include "power_rules.h"

// A command is delivered once. Without the clock it cannot be checked, so
// without Wi-Fi or NTP the ESP32 does not even fetch it (nor post the state,
// whose `at` and MAC need the time): the app shows "ESP32 sem contato".
inline bool shouldPollWorker(bool wifi, bool ntp) { return wifi && ntp; }

// Saves the new counter first and acts only if it was saved: a restart in the
// middle never runs the same command twice. Returns whether it acted.
inline bool runCommand(const Decision &d, bool (*persist)(int64_t), void (*act)()) {
  if (!d.run) return false;
  if (!persist(d.lastAt)) return false;
  act();
  return true;
}
