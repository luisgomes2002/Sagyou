// The two cycle rules that keep a command from being lost or run twice
// (spec docs/specs/2026-11-07-esp32-firmware.md, plan decisions 7 and 9).
#include <string.h>
#include <unity.h>

#include "power_cycle.h"

static char order[16];
static int64_t persisted;
static bool persistResult;

static bool fakePersist(int64_t at) {
  strcat(order, "P");
  persisted = at;
  return persistResult;
}

static void fakeAct() { strcat(order, "A"); }

void setUp() {
  order[0] = '\0';
  persisted = 0;
  persistResult = true;
}
void tearDown() {}

static void test_polls_only_with_wifi_and_ntp() {
  TEST_ASSERT_TRUE(shouldPollWorker(true, true));
  TEST_ASSERT_FALSE(shouldPollWorker(true, false));
  TEST_ASSERT_FALSE(shouldPollWorker(false, true));
  TEST_ASSERT_FALSE(shouldPollWorker(false, false));
}

static void test_persists_before_acting() {
  Decision d = {true, "ok", 1800000000000LL};
  TEST_ASSERT_TRUE(runCommand(d, fakePersist, fakeAct));
  TEST_ASSERT_EQUAL_STRING("PA", order);
  TEST_ASSERT_TRUE(persisted == 1800000000000LL);
}

static void test_does_not_act_when_persisting_fails() {
  persistResult = false;
  Decision d = {true, "ok", 1800000000000LL};
  TEST_ASSERT_FALSE(runCommand(d, fakePersist, fakeAct));
  TEST_ASSERT_EQUAL_STRING("P", order);
}

static void test_refused_decision_touches_nothing() {
  Decision d = {false, "old", 5};
  TEST_ASSERT_FALSE(runCommand(d, fakePersist, fakeAct));
  TEST_ASSERT_EQUAL_STRING("", order);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_polls_only_with_wifi_and_ntp);
  RUN_TEST(test_persists_before_acting);
  RUN_TEST(test_does_not_act_when_persisting_fails);
  RUN_TEST(test_refused_decision_touches_nothing);
  return UNITY_END();
}
