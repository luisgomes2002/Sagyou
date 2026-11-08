// O ESP32 que liga e desliga o PC de casa (spec docs/specs/2026-11-07-esp32-firmware.md,
// contrato docs/esp32-api.md).
//
// A cada 10 s, com Wi-Fi e relógio (NTP) certos: busca o próximo comando no Worker,
// confere (MAC, contador, relógio, prazo), grava o contador e só então age; faz ping
// no PC e informa o estado assinado. Não escuta porta nenhuma: só conexões de saída.
// As regras ficam em lib/power_rules, testadas no PC com `pio test -e native`.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP32Ping.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiUdp.h>
#include <esp_task_wdt.h>
#include <sys/time.h>
#include <time.h>

#include "hex.h"
#include "lan_message.h"
#include "power_cycle.h"
#include "power_rules.h"
#include "secrets.h"

#if !defined(WORKER_URL) || !defined(POWER_TOKEN) || !defined(ESP32_KEY) || \
    !defined(LAN_KEY) || !defined(PC_IP) || !defined(PC_MAC)
#error "Preencha WORKER_URL, POWER_TOKEN, ESP32_KEY, LAN_KEY, PC_IP e PC_MAC no secrets.h (veja secrets.example.h)."
#endif

// Mozilla's CA list (ESP-IDF v4.4.7), embedded by board_build.embed_files: the
// Worker's certificate is always verified, so the token never goes to an impostor.
extern const uint8_t CA_BUNDLE[] asm("_binary_data_cert_x509_crt_bundle_bin_start");

static const int LED_PIN = 2;
static const char *NTP_1 = "pool.ntp.org";
static const char *NTP_2 = "time.google.com";
static const time_t VALID_AFTER = 1704067200;  // 2024-01-01: before this, no NTP yet
static const unsigned long CYCLE_MS = 10000;
static const unsigned long WIFI_GIVE_UP_MS = 5UL * 60UL * 1000UL;
static const uint32_t WATCHDOG_S = 60;
static const uint16_t WOL_PORT = 9;

static uint8_t espKey[32];
static uint8_t lanKey[32];
static uint8_t pcMac[6];
static const IPAddress PC_ADDRESS(PC_IP);

static Preferences prefs;
static int64_t lastAt = 0;
// Result of the last command since this boot; "" before the first (plan decision 8).
static String lastResult = "";
static String pendingCmd = "";

static WiFiUDP udp;
static unsigned long lastCycle = 0;
static unsigned long wifiLostSince = 0;

// ── Small helpers ─────────────────────────────────────────────────────────────

static bool clockReady() { return time(nullptr) > VALID_AFTER; }

static int64_t nowMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

static bool parseMac(const char *text, uint8_t out[6]) {
  unsigned v[6];
  if (sscanf(text, "%2x%*[:-]%2x%*[:-]%2x%*[:-]%2x%*[:-]%2x%*[:-]%2x", &v[0], &v[1], &v[2],
             &v[3], &v[4], &v[5]) != 6)
    return false;
  for (int i = 0; i < 6; i++) out[i] = (uint8_t)v[i];
  return true;
}

static void blink(int times, int ms) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(ms);
    digitalWrite(LED_PIN, LOW);
    delay(ms);
  }
}

// A configuration error never runs anything: blink fast forever (the watchdog
// is fed so it does not reboot in a loop).
static void haltWithError(const char *what) {
  Serial.printf("Erro de configuração: %s. Corrija o secrets.h e grave de novo.\n", what);
  for (;;) {
    blink(1, 100);
    esp_task_wdt_reset();
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

static void sendWakeOnLan() {
  uint8_t packet[102];
  memset(packet, 0xff, 6);
  for (int i = 0; i < 16; i++) memcpy(packet + 6 + 6 * i, pcMac, 6);
  IPAddress broadcast = WiFi.broadcastIP();
  for (int i = 0; i < 3; i++) {
    udp.beginPacket(broadcast, WOL_PORT);
    udp.write(packet, sizeof packet);
    udp.endPacket();
    delay(100);
  }
  Serial.println("Wake-on-LAN enviado.");
}

static void sendToPc(const char *cmd) {
  char msg[LAN_MESSAGE_MAX];
  if (!lanMessage(cmd, nowMs(), lanKey, msg, sizeof msg)) {
    Serial.println("Não foi possível montar o pedido ao PC.");
    return;
  }
  // UDP may drop a packet; the listener's counter drops the copies.
  for (int i = 0; i < 3; i++) {
    udp.beginPacket(PC_ADDRESS, LAN_PORT);
    udp.write((const uint8_t *)msg, strlen(msg));
    udp.endPacket();
    delay(200);
  }
  Serial.printf("Pedido \"%s\" enviado ao PC.\n", cmd);
}

static bool persistLastAt(int64_t at) {
  if (prefs.putLong64("lastAt", at) != sizeof(int64_t)) return false;
  lastAt = at;
  return true;
}

static void act() {
  if (pendingCmd == "wake") {
    sendWakeOnLan();
  } else {
    sendToPc(pendingCmd.c_str());
  }
  blink(3, 80);
}

// ── Worker ────────────────────────────────────────────────────────────────────

static bool workerRequest(HTTPClient &http, WiFiClientSecure &client, const char *path) {
  client.setCACertBundle(CA_BUNDLE);
  if (!http.begin(client, String(WORKER_URL) + path)) return false;
  http.setTimeout(8000);
  http.addHeader("Authorization", String("Bearer ") + POWER_TOKEN);
  return true;
}

static void handleNextCommand() {
  WiFiClientSecure client;
  HTTPClient http;
  if (!workerRequest(http, client, "/power/next")) return;
  int code = http.GET();
  if (code != 200) {
    Serial.printf("/power/next respondeu %d.\n", code);
    http.end();
    return;
  }
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, http.getString());
  http.end();
  if (err) {
    Serial.println("/power/next: resposta inválida.");
    return;
  }
  JsonVariant c = doc["command"];
  if (c.isNull()) return;
  const char *cmd = c["cmd"] | "";
  const char *mac = c["mac"] | "";
  int64_t at = c["at"] | (int64_t)0;
  int64_t exp = c["exp"] | (int64_t)0;
  Decision d = decideCommand(cmd, at, exp, mac, espKey, lastAt, nowMs());
  lastResult = d.result;
  Serial.printf("Comando \"%s\": %s.\n", cmd, d.result);
  pendingCmd = cmd;
  if (d.run && !runCommand(d, persistLastAt, act)) {
    Serial.println("Não foi possível gravar o contador; o comando não foi executado.");
  }
}

static void postState(bool pcPing) {
  int64_t at = nowMs();
  char mac[65];
  stateMac(pcPing, lastResult.c_str(), at, espKey, mac);
  JsonDocument doc;
  doc["pcPing"] = pcPing;
  doc["lastResult"] = lastResult;
  doc["at"] = at;
  doc["mac"] = mac;
  String body;
  serializeJson(doc, body);
  WiFiClientSecure client;
  HTTPClient http;
  if (!workerRequest(http, client, "/power/state")) return;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();
  if (code != 200) Serial.printf("/power/state respondeu %d.\n", code);
}

// ── Setup and loop ────────────────────────────────────────────────────────────

static void startWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
#ifdef ESP32_IP
  if (!WiFi.config(IPAddress(ESP32_IP), IPAddress(GATEWAY_IP), IPAddress(SUBNET_MASK),
                   IPAddress(DNS_IP))) {
    Serial.println("Não foi possível fixar o IP; seguindo pelo DHCP.");
  }
#endif
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("ESP32-PC-BOOT: ligar e desligar o PC");
  esp_task_wdt_init(WATCHDOG_S, true);
  esp_task_wdt_add(nullptr);

  if (!parseHex32(ESP32_KEY, espKey)) haltWithError("ESP32_KEY precisa de 64 hexadecimais");
  if (!parseHex32(LAN_KEY, lanKey)) haltWithError("LAN_KEY precisa de 64 hexadecimais");
  if (!parseMac(PC_MAC, pcMac)) haltWithError("PC_MAC inválido");

  prefs.begin("power", false);
  lastAt = prefs.getLong64("lastAt", 0);

  startWifi();
  configTime(0, 0, NTP_1, NTP_2);  // UTC, in ms like the commands
}

void loop() {
  esp_task_wdt_reset();
  bool wifi = WiFi.status() == WL_CONNECTED;
  bool ntp = clockReady();

  if (wifi) {
    wifiLostSince = 0;
  } else if (wifiLostSince == 0) {
    wifiLostSince = millis();
  } else if (millis() - wifiLostSince > WIFI_GIVE_UP_MS) {
    Serial.println("Sem Wi-Fi há 5 minutos; reiniciando.");
    ESP.restart();
  }

  // LED: on when everything is right; slow blink while waiting for Wi-Fi or NTP.
  digitalWrite(LED_PIN, wifi && ntp ? HIGH : ((millis() / 1000) % 2 ? HIGH : LOW));

  if (lastCycle != 0 && millis() - lastCycle < CYCLE_MS) {
    delay(100);
    return;
  }
  lastCycle = millis();
  if (!shouldPollWorker(wifi, ntp)) {
    Serial.println(wifi ? "Aguardando o NTP." : "Aguardando o Wi-Fi.");
    return;
  }
  handleNextCommand();
  esp_task_wdt_reset();
  bool pcPing = Ping.ping(PC_ADDRESS, 1);
  postState(pcPing);
}
