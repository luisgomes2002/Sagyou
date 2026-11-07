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
