// The signed request the ESP32 sends to the PC on the home network.
#include <string.h>
#include <unity.h>

#include "../vectors.h"
#include "hex.h"
#include "lan_message.h"

static uint8_t KEY[32];

void setUp() { parseHex32(TEST_KEY_HEX, KEY); }
void tearDown() {}

static void test_shutdown_matches_vector() {
  char out[LAN_MESSAGE_MAX];
  TEST_ASSERT_TRUE(lanMessage("shutdown", 1800000000000LL, KEY, out, sizeof out));
  TEST_ASSERT_EQUAL_STRING(LAN_VECTOR, out);
}

static void test_abort_shutdown_is_accepted() {
  char out[LAN_MESSAGE_MAX];
  TEST_ASSERT_TRUE(lanMessage("abort-shutdown", 1800000000000LL, KEY, out, sizeof out));
  TEST_ASSERT_EQUAL_INT(0, strncmp(out, "sagyou-lan|1|abort-shutdown|1800000000000|", 42));
  TEST_ASSERT_EQUAL_size_t(42 + 64, strlen(out));
}

static void test_other_commands_are_refused() {
  char out[LAN_MESSAGE_MAX];
  TEST_ASSERT_FALSE(lanMessage("wake", 1800000000000LL, KEY, out, sizeof out));
  TEST_ASSERT_FALSE(lanMessage("format c:", 1800000000000LL, KEY, out, sizeof out));
  TEST_ASSERT_FALSE(lanMessage(nullptr, 1800000000000LL, KEY, out, sizeof out));
}

static void test_at_must_have_13_digits() {
  char out[LAN_MESSAGE_MAX];
  TEST_ASSERT_FALSE(lanMessage("shutdown", 999, KEY, out, sizeof out));
  TEST_ASSERT_FALSE(lanMessage("shutdown", 10000000000000LL, KEY, out, sizeof out));
  TEST_ASSERT_FALSE(lanMessage("shutdown", -1800000000000LL, KEY, out, sizeof out));
}

static void test_short_buffer_is_refused() {
  char out[40];
  TEST_ASSERT_FALSE(lanMessage("shutdown", 1800000000000LL, KEY, out, sizeof out));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_shutdown_matches_vector);
  RUN_TEST(test_abort_shutdown_is_accepted);
  RUN_TEST(test_other_commands_are_refused);
  RUN_TEST(test_at_must_have_13_digits);
  RUN_TEST(test_short_buffer_is_refused);
  return UNITY_END();
}
