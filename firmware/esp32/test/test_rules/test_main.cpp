// The Worker command rules, in the order of docs/esp32-api.md: MAC, counter,
// clock, deadline. Mirrors sync-server/src/__tests__/esp32-sim.test.ts.
#include <string.h>
#include <unity.h>

#include "../vectors.h"
#include "hex.h"
#include "power_rules.h"

static uint8_t KEY[32];

void setUp() { parseHex32(TEST_KEY_HEX, KEY); }
void tearDown() {}

static const CommandVector &WAKE = COMMAND_VECTORS[0];

static Decision decide(const char *cmd, int64_t at, int64_t exp, const char *mac, int64_t lastAt,
                       int64_t now) {
  return decideCommand(cmd, at, exp, mac, KEY, lastAt, now);
}

static void test_right_mac_new_at_runs() {
  Decision d = decide(WAKE.cmd, WAKE.at, WAKE.exp, WAKE.mac, 0, WAKE.at + 1000);
  TEST_ASSERT_TRUE(d.run);
  TEST_ASSERT_EQUAL_STRING("ok", d.result);
  TEST_ASSERT_TRUE(d.lastAt == WAKE.at);
}

static void test_same_or_older_at_is_old() {
  Decision same = decide(WAKE.cmd, WAKE.at, WAKE.exp, WAKE.mac, WAKE.at, WAKE.at + 1000);
  TEST_ASSERT_FALSE(same.run);
  TEST_ASSERT_EQUAL_STRING("old", same.result);
  TEST_ASSERT_TRUE(same.lastAt == WAKE.at);
  Decision older = decide(WAKE.cmd, WAKE.at, WAKE.exp, WAKE.mac, WAKE.at + 1, WAKE.at + 1000);
  TEST_ASSERT_EQUAL_STRING("old", older.result);
}

static void test_wrong_mac_or_swapped_command_is_mac() {
  char bad[65];
  strcpy(bad, WAKE.mac);
  bad[0] = bad[0] == 'a' ? 'b' : 'a';
  TEST_ASSERT_EQUAL_STRING("mac", decide(WAKE.cmd, WAKE.at, WAKE.exp, bad, 0, WAKE.at).result);
  // The wake MAC does not authorize a shutdown.
  TEST_ASSERT_EQUAL_STRING("mac",
                           decide("shutdown", WAKE.at, WAKE.exp, WAKE.mac, 0, WAKE.at).result);
  TEST_ASSERT_EQUAL_STRING("mac", decide(WAKE.cmd, WAKE.at, WAKE.exp, nullptr, 0, WAKE.at).result);
}

static void test_mac_comes_before_counter() {
  // Wrong MAC and an old at: the MAC decides.
  Decision d = decide(WAKE.cmd, WAKE.at, WAKE.exp, "00", WAKE.at + 5, WAKE.at);
  TEST_ASSERT_EQUAL_STRING("mac", d.result);
}

static void test_past_deadline_is_expired() {
  Decision d = decide(WAKE.cmd, WAKE.at, WAKE.exp, WAKE.mac, 0, WAKE.exp);
  TEST_ASSERT_FALSE(d.run);
  TEST_ASSERT_EQUAL_STRING("expired", d.result);
}

static void test_phone_clock_off_by_more_than_5_min_is_clock() {
  Decision ahead = decide(WAKE.cmd, WAKE.at, WAKE.exp, WAKE.mac, 0, WAKE.at - POWER_CLOCK_SKEW_MS - 1);
  TEST_ASSERT_EQUAL_STRING("clock", ahead.result);
  Decision behind = decide(WAKE.cmd, WAKE.at, WAKE.exp, WAKE.mac, 0, WAKE.at + POWER_CLOCK_SKEW_MS + 1);
  TEST_ASSERT_EQUAL_STRING("clock", behind.result);
  TEST_ASSERT_TRUE(POWER_CLOCK_SKEW_MS == 300000);
}

static void test_unknown_command_never_runs() {
  char mac[65];
  commandMac("format", WAKE.at, WAKE.exp, KEY, mac);
  Decision d = decide("format", WAKE.at, WAKE.exp, mac, 0, WAKE.at);
  TEST_ASSERT_FALSE(d.run);
  TEST_ASSERT_EQUAL_STRING("mac", d.result);
}

static void test_command_and_state_mac_match_vectors() {
  char mac[65];
  for (const CommandVector &v : COMMAND_VECTORS) {
    commandMac(v.cmd, v.at, v.exp, KEY, mac);
    TEST_ASSERT_EQUAL_STRING(v.mac, mac);
  }
  for (const StateVector &v : STATE_VECTORS) {
    stateMac(v.pcPing, v.lastResult, v.at, KEY, mac);
    TEST_ASSERT_EQUAL_STRING(v.mac, mac);
  }
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_right_mac_new_at_runs);
  RUN_TEST(test_same_or_older_at_is_old);
  RUN_TEST(test_wrong_mac_or_swapped_command_is_mac);
  RUN_TEST(test_mac_comes_before_counter);
  RUN_TEST(test_past_deadline_is_expired);
  RUN_TEST(test_phone_clock_off_by_more_than_5_min_is_clock);
  RUN_TEST(test_unknown_command_never_runs);
  RUN_TEST(test_command_and_state_mac_match_vectors);
  return UNITY_END();
}
