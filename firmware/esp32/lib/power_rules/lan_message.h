// The signed request the ESP32 sends to ouvir-esp32.ps1 on the PC (UDP 9999):
//   sagyou-lan|1|<cmd>|<at>|<hmac>
// cmd: shutdown or abort-shutdown; at: NTP time in ms, 13 digits; hmac:
// HMAC-SHA256 of "sagyou-lan|1|<cmd>|<at>" with the LAN_KEY, lowercase hex.
// Spec docs/specs/2026-11-07-esp32-firmware.md, decision 4.
#pragma once
#include <stddef.h>
#include <stdint.h>

constexpr uint16_t LAN_PORT = 9999;
// Longest message ("abort-shutdown") plus the terminating '\0'.
constexpr size_t LAN_MESSAGE_MAX = 112;
// How far the ESP32 and the PC clocks may disagree (checked by the listener).
constexpr int64_t LAN_CLOCK_SKEW_MS = 60000;

// False for any other command, an `at` without exactly 13 digits, or a short buffer.
bool lanMessage(const char *cmd, int64_t at, const uint8_t key[32], char *out, size_t outLen);
