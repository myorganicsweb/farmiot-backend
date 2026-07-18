// ==========================================
// HUB ESP32: Publishes own status + forwards sensor status
// ==========================================

#include <WiFi.h>
#include <PubSubClient.h>
#include <esp_now.h>

const char* ssid = "scoobydoo gateway";
const char* password = "scoobydoo";
const char* mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;

WiFiClient espClient;
PubSubClient mqttClient(espClient);

uint8_t sensorMac[] = {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF};

unsigned long lastPublish = 0;
const unsigned long PUBLISH_INTERVAL = 5000; // 5 seconds

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("=== Hub MQTT + ESP-NOW ===");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  Serial.println("✅ Wi-Fi Connected!");

  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.connect("FarmIOT_Hub");
  Serial.println("✅ MQTT Connected");

  esp_now_init();
  esp_now_register_recv_cb(onDataReceived);
  esp_now_peer_info_t peerInfo;
  memcpy(peerInfo.peer_addr, sensorMac, 6);
  peerInfo.channel = 0;
  peerInfo.ifidx = WIFI_IF_STA;
  peerInfo.encrypt = false;
  esp_now_add_peer(&peerInfo);
  Serial.println("✅ ESP-NOW ready");
}

void loop() {
  mqttClient.loop();

  unsigned long now = millis();
  if (now - lastPublish >= PUBLISH_INTERVAL) {
    lastPublish = now;
    mqttClient.publish("farmiot/hub/status", "online");
    Serial.println("📡 Hub status published");
  }
}

void onDataReceived(const esp_now_recv_info_t *recv_info, const uint8_t *data, int len) {
  String msg = String((char*)data).substring(0, len);
  Serial.print("📡 Sensor status: ");
  Serial.println(msg);
  mqttClient.publish("farmiot/sensor/status", msg.c_str());
}