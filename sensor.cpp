// ==========================================
// SENSOR ESP32: Sends "online" via ESP-NOW
// ==========================================

#include <esp_now.h>
#include <WiFi.h>

uint8_t hubMac[] = {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF};

unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL = 10000; // 10 seconds

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("=== Sensor ESP32 ===");

  WiFi.mode(WIFI_STA);
  esp_now_init();
  esp_now_register_recv_cb(onCommandReceived);

  esp_now_peer_info_t peerInfo;
  memcpy(peerInfo.peer_addr, hubMac, 6);
  peerInfo.channel = 0;
  peerInfo.ifidx = WIFI_IF_STA;
  peerInfo.encrypt = false;
  esp_now_add_peer(&peerInfo);
  Serial.println("✅ ESP-NOW ready");
}

void loop() {
  unsigned long now = millis();
  if (now - lastSend >= SEND_INTERVAL) {
    lastSend = now;
    esp_now_send(hubMac, (uint8_t*)"online", 6);
    Serial.println("📡 Sent: online");
  }
}

void onCommandReceived(const esp_now_recv_info_t *recv_info, const uint8_t *data, int len) {
  // Ignore commands for now
}