// SHA-256 (FIPS 180-4) and HMAC-SHA256 (RFC 2104), with no dependency: the same
// code runs on the ESP32 and in the native tests on the PC.
#pragma once
#include <stddef.h>
#include <stdint.h>

void sha256(const uint8_t *data, size_t len, uint8_t out[32]);

void hmacSha256(const uint8_t *key, size_t keyLen, const char *msg, size_t msgLen,
                uint8_t out[32]);
