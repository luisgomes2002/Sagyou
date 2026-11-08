// Lowercase hex in and out, and a comparison that takes the same time whatever
// the content (a MAC must never be compared with an early exit).
#pragma once
#include <stddef.h>
#include <stdint.h>

// `out` needs 2*n + 1 bytes; it ends with '\0'.
void toHexLower(const uint8_t *in, size_t n, char *out);

// Exactly 64 hex characters (either case) into 32 bytes; false otherwise.
bool parseHex32(const char *hex, uint8_t out[32]);

// True only when both strings have the same length and content.
bool sameHexConstantTime(const char *a, const char *b);
