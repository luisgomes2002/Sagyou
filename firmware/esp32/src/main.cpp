// Etapa 1: teste da placa. Conecta no Wi-Fi, acerta o relógio por NTP e mostra
// no monitor serial o que vai ser preciso depois: o MAC e o IP do ESP32 (para a
// reserva de IP no roteador) e se a hora está certa (as regras do comando
// dependem dela). O LED azul da placa (GPIO 2) pisca enquanto conecta e fica
// aceso quando o relógio está certo.
#include <Arduino.h>
#include <WiFi.h>
#include <time.h>

#include "secrets.h"

static const int LED_PIN = 2;
static const char *NTP_1 = "pool.ntp.org";
static const char *NTP_2 = "time.google.com";
// Antes disto o relógio do ESP32 ainda não foi acertado (1º de janeiro de 2024, em s).
static const time_t VALID_AFTER = 1704067200;

static bool clockReady() { return time(nullptr) > VALID_AFTER; }

static void connectWifi() {
  WiFi.mode(WIFI_STA);
#ifdef ESP32_IP
  // Fixed address: the PC's firewall accepts the ESP32 by it.
  if (!WiFi.config(IPAddress(ESP32_IP), IPAddress(GATEWAY_IP), IPAddress(SUBNET_MASK),
                   IPAddress(DNS_IP))) {
    Serial.println("Não foi possível fixar o IP; seguindo pelo DHCP.");
  }
#endif
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("Conectando em \"%s\"", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    Serial.print('.');
    delay(500);
  }
  Serial.println();
  Serial.printf("Conectado. IP do ESP32: %s\n", WiFi.localIP().toString().c_str());
  Serial.printf("MAC do ESP32: %s\n", WiFi.macAddress().c_str());
  Serial.printf("Sinal: %d dBm\n", WiFi.RSSI());
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("ESP32-PC-BOOT: teste da placa");
  connectWifi();
  // UTC: as regras do comando comparam milissegundos UTC.
  configTime(0, 0, NTP_1, NTP_2);
}

void loop() {
  static unsigned long last = 0;
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi caiu; reconectando.");
    connectWifi();
  }
  if (millis() - last >= 10000 || last == 0) {
    last = millis();
    if (clockReady()) {
      digitalWrite(LED_PIN, HIGH);
      time_t now = time(nullptr);
      struct tm utc;
      gmtime_r(&now, &utc);
      char text[32];
      strftime(text, sizeof text, "%Y-%m-%d %H:%M:%S", &utc);
      Serial.printf("Relógio certo (UTC): %s · %lld ms\n", text, (long long)now * 1000);
    } else {
      digitalWrite(LED_PIN, LOW);
      Serial.println("Aguardando o NTP acertar o relógio...");
    }
  }
  delay(100);
}
