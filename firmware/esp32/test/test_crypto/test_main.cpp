// SHA-256, HMAC and hex helpers: the same code the board runs, checked on the PC.
#include <stdio.h>
#include <string.h>
#include <unity.h>

#include "../vectors.h"
#include "hex.h"
#include "sha256.h"

void setUp() {}
void tearDown() {}

static void expectHmac(const uint8_t *key, size_t keyLen, const char *msg, const char *hex) {
  uint8_t out[32];
  char got[65];
  hmacSha256(key, keyLen, msg, strlen(msg), out);
  toHexLower(out, 32, got);
  TEST_ASSERT_EQUAL_STRING(hex, got);
}

// RFC 4231, test case 1.
static void test_rfc4231_case1() {
  uint8_t key[20];
  memset(key, 0x0b, sizeof key);
  expectHmac(key, sizeof key, "Hi There",
             RFC4231_CASE1);
}

// RFC 4231, test case 2 (key shorter than the block).
static void test_rfc4231_case2() {
  const char *key = "Jefe";
  expectHmac((const uint8_t *)key, 4, "what do ya want for nothing?",
             RFC4231_CASE2);
}

// RFC 4231, test case 6 (key longer than the block, hashed first).
static void test_rfc4231_case6() {
  uint8_t key[131];
  memset(key, 0xaa, sizeof key);
  expectHmac(key, sizeof key, "Test Using Larger Than Block-Size Key - Hash Key First",
             RFC4231_CASE6);
}

static void test_vectors_command_and_state() {
  uint8_t key[32];
  TEST_ASSERT_TRUE(parseHex32(TEST_KEY_HEX, key));
  char msg[128];
  for (const CommandVector &v : COMMAND_VECTORS) {
    snprintf(msg, sizeof msg, "sagyou-power|1|%s|%lld|%lld", v.cmd, (long long)v.at,
             (long long)v.exp);
    expectHmac(key, 32, msg, v.mac);
  }
  for (const StateVector &v : STATE_VECTORS) {
    snprintf(msg, sizeof msg, "sagyou-power-state|1|%d|%s|%lld", v.pcPing ? 1 : 0, v.lastResult,
             (long long)v.at);
    expectHmac(key, 32, msg, v.mac);
  }
}

static void test_parse_hex32() {
  uint8_t out[32];
  TEST_ASSERT_TRUE(parseHex32(TEST_KEY_HEX, out));
  TEST_ASSERT_EQUAL_UINT8(0x00, out[0]);
  TEST_ASSERT_EQUAL_UINT8(0x1f, out[31]);
  // 63 and 65 characters, and a non-hex character.
  TEST_ASSERT_FALSE(parseHex32("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1", out));
  TEST_ASSERT_FALSE(parseHex32("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f0", out));
  TEST_ASSERT_FALSE(parseHex32("zz0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", out));
  TEST_ASSERT_FALSE(parseHex32(nullptr, out));
}

static void test_same_hex() {
  TEST_ASSERT_TRUE(sameHexConstantTime("abcd", "abcd"));
  TEST_ASSERT_FALSE(sameHexConstantTime("abcd", "abce"));
  TEST_ASSERT_FALSE(sameHexConstantTime("abcd", "abc"));
  TEST_ASSERT_FALSE(sameHexConstantTime(nullptr, "abcd"));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_rfc4231_case1);
  RUN_TEST(test_rfc4231_case2);
  RUN_TEST(test_rfc4231_case6);
  RUN_TEST(test_vectors_command_and_state);
  RUN_TEST(test_parse_hex32);
  RUN_TEST(test_same_hex);
  return UNITY_END();
}
