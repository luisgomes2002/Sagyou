#include "hex.h"

#include <string.h>

void toHexLower(const uint8_t *in, size_t n, char *out) {
  static const char DIGITS[] = "0123456789abcdef";
  for (size_t i = 0; i < n; i++) {
    out[2 * i] = DIGITS[in[i] >> 4];
    out[2 * i + 1] = DIGITS[in[i] & 0x0f];
  }
  out[2 * n] = '\0';
}

static int nibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool parseHex32(const char *hex, uint8_t out[32]) {
  if (!hex || strlen(hex) != 64) return false;
  for (int i = 0; i < 32; i++) {
    int hi = nibble(hex[2 * i]);
    int lo = nibble(hex[2 * i + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = (uint8_t)(hi << 4 | lo);
  }
  return true;
}

bool sameHexConstantTime(const char *a, const char *b) {
  if (!a || !b) return false;
  size_t la = strlen(a);
  if (la != strlen(b)) return false;
  unsigned char diff = 0;
  for (size_t i = 0; i < la; i++) diff |= (unsigned char)(a[i] ^ b[i]);
  return diff == 0;
}
