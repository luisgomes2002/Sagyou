// Copie para include/secrets.h e preencha. O secrets.h está no .gitignore.
#pragma once

// Rede Wi-Fi de casa (2,4 GHz: o ESP32 não conecta em 5 GHz).
#define WIFI_SSID "nome-da-rede"
#define WIFI_PASSWORD "senha-da-rede"

// IP fixo do ESP32, para o PC poder aceitá-lo pelo IP. Use um endereço que o DHCP
// do roteador não entrega (ou reserve-o no roteador). Sem ESP32_IP, usa o DHCP.
// Formato: quatro números separados por vírgula.
#define ESP32_IP 192, 168, 0, 251
#define GATEWAY_IP 192, 168, 0, 1
#define SUBNET_MASK 255, 255, 255, 0
#define DNS_IP 192, 168, 0, 1

// --- Ligar e desligar o PC (spec docs/specs/2026-11-07-esp32-firmware.md) ---

// Endereço do seu Worker (o mesmo da sincronização), sem "/" no fim.
#define WORKER_URL "https://sagyou-sync.sua-conta.workers.dev"
// Sagyou → Configurações → Controle remoto → "Gerar token do ESP32": o token e a
// chave aparecem uma vez. A chave tem 64 caracteres hexadecimais.
#define POWER_TOKEN "cole-aqui-o-token"
#define ESP32_KEY "cole-aqui-a-chave"
// Mostrada uma vez pelo windows\instalar.ps1 (64 hexadecimais).
#define LAN_KEY "cole-aqui-a-lan-key"

// O PC: IP fixo (quatro números) e o MAC da placa de rede de cabo (getmac).
#define PC_IP 192, 168, 0, 250
#define PC_MAC "00:00:00:00:00:00"
