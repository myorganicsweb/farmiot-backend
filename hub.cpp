// ==========================================
// HUB ESP32: Request/Response Manager
// ==========================================

#include <WiFi.h>
#include <PubSubClient.h>
#include <esp_now.h>
#include <Preferences.h>
#include <time.h>

Preferences preferences;

const char* ssid = "scoobydoo gateway";
const char* password = "scoobydoo";
const char* mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;

const char* ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 0;
const int daylightOffset_sec = 3600;

WiFiClient espClient;
PubSubClient mqttClient(espClient);

uint8_t broadcastMac[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

#define MAX_SENSORS 10

struct SensorDevice {
  uint8_t mac[6];
  String id;
  unsigned long lastSeen;
  int latestSoil;
  bool discovered;
};

SensorDevice sensors[MAX_SENSORS];
int sensorCount = 0;

unsigned long lastPublish = 0;
const unsigned long PUBLISH_INTERVAL = 5000;

unsigned long lastRequest = 0;
const unsigned long REQUEST_INTERVAL = 10000;

unsigned long lastConnectionPrint = 0;
const unsigned long CONNECTION_PRINT_INTERVAL = 10000;

unsigned long lastWiFiReconnect = 0;
const unsigned long WIFI_RECONNECT_INTERVAL = 30000;

unsigned long lastMQTTReconnect = 0;
const unsigned long MQTT_RECONNECT_INTERVAL = 10000;

String getTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return "[--:--:--] ";
  }
  char buffer[12];
  strftime(buffer, sizeof(buffer), "[%H:%M:%S] ", &timeinfo);
  return String(buffer);
}

void logMessage(String msg) {
  Serial.println(getTimestamp() + msg);
}

void addSensor(uint8_t* mac, String id) {
  for (int i = 0; i < sensorCount; i++) {
    if (memcmp(sensors[i].mac, mac, 6) == 0) {
      sensors[i].lastSeen = millis();
      sensors[i].discovered = true;
      return;
    }
  }
  if (sensorCount >= MAX_SENSORS) return;
  
  memcpy(sensors[sensorCount].mac, mac, 6);
  sensors[sensorCount].id = id;
  sensors[sensorCount].lastSeen = millis();
  sensors[sensorCount].discovered = true;
  sensors[sensorCount].latestSoil = 0;
  
  esp_now_peer_info_t peerInfo;
  memcpy(peerInfo.peer_addr, mac, 6);
  peerInfo.channel = 0;
  peerInfo.ifidx = WIFI_IF_STA;
  peerInfo.encrypt = false;
  esp_now_add_peer(&peerInfo);
  
  String prefKey = "sensor_" + String(sensorCount);
  preferences.putBytes(prefKey.c_str(), mac, 6);
  
  sensorCount++;
}

void loadSavedSensors() {
  preferences.begin("hub", false);
  int count = preferences.getInt("sensorCount", 0);
  
  for (int i = 0; i < count; i++) {
    String prefKey = "sensor_" + String(i);
    uint8_t mac[6];
    size_t len = preferences.getBytes(prefKey.c_str(), mac, 6);
    if (len == 6) {
      String id = "Sensor_" + String(i + 1);
      addSensor(mac, id);
      logMessage("✅ Restored: " + id);
    }
  }
  preferences.end();
}

void connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  
  logMessage("🔄 WiFi Connecting...");
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    logMessage("✅ WiFi Connected | IP: " + WiFi.localIP().toString());
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      logMessage("✅ Time Synced");
    }
  } else {
    logMessage("❌ WiFi Failed!");
  }
}

void connectToMQTT() {
  if (mqttClient.connected()) return;
  if (WiFi.status() != WL_CONNECTED) return;
  
  logMessage("🔄 MQTT Connecting...");
  
  char clientId[20];
  snprintf(clientId, sizeof(clientId), "FarmIOT_Hub_%d", random(1000, 9999));
  
  if (mqttClient.connect(clientId)) {
    logMessage("✅ MQTT Connected");
  } else {
    logMessage("❌ MQTT Failed!");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  setCpuFrequencyMhz(80);

  logMessage("=== HUB STARTED ===");

  WiFi.mode(WIFI_STA);
  connectToWiFi();

  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setKeepAlive(60);
  
  esp_now_init();
  esp_now_register_recv_cb(onDataReceived);

  esp_now_peer_info_t peerInfo;
  memcpy(peerInfo.peer_addr, broadcastMac, 6);
  peerInfo.channel = 0;
  peerInfo.ifidx = WIFI_IF_STA;
  peerInfo.encrypt = false;
  esp_now_add_peer(&peerInfo);
  
  loadSavedSensors();
  
  logMessage("📡 ESP-NOW Ready");
  logMessage("📡 Request every 10s");
}

void loop() {
  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED && (now - lastWiFiReconnect >= WIFI_RECONNECT_INTERVAL)) {
    lastWiFiReconnect = now;
    connectToWiFi();
  }

  if (!mqttClient.connected() && WiFi.status() == WL_CONNECTED && (now - lastMQTTReconnect >= MQTT_RECONNECT_INTERVAL)) {
    lastMQTTReconnect = now;
    connectToMQTT();
  }

  if (now - lastPublish >= PUBLISH_INTERVAL) {
    lastPublish = now;
    if (!mqttClient.connected()) {
      connectToMQTT();
    }
    if (mqttClient.connected()) {
      mqttClient.publish("farmiot/hub/status", "online");
    }
  }

  if (now - lastRequest >= REQUEST_INTERVAL) {
    lastRequest = now;
    for (int i = 0; i < sensorCount; i++) {
      if (sensors[i].discovered) {
        logMessage("📤 REQ → " + sensors[i].id + " | get_status");
        esp_now_send(sensors[i].mac, (uint8_t*)"get_status", 10);
      }
    }
  }

  if (now - lastConnectionPrint >= CONNECTION_PRINT_INTERVAL) {
    lastConnectionPrint = now;
    logMessage("=== STATUS ===");
    logMessage("🌐 Hub: " + String(WiFi.status() == WL_CONNECTED ? "ONLINE" : "OFFLINE"));
    logMessage("📡 MQTT: " + String(mqttClient.connected() ? "ONLINE" : "OFFLINE"));
    
    for (int i = 0; i < sensorCount; i++) {
      bool online = (now - sensors[i].lastSeen < 20000);
      String status = sensors[i].id + ": " + (online ? "ONLINE" : "OFFLINE");
      if (online && sensors[i].latestSoil > 0) {
        status += " | Soil: " + String(sensors[i].latestSoil);
      }
      logMessage(status);
    }
    logMessage("==============");
  }

  mqttClient.loop();
  delay(10);
}

void onDataReceived(const esp_now_recv_info_t *recv_info, const uint8_t *data, int len) {
  String msg = String((char*)data).substring(0, len);
  unsigned long now = millis();

  if (msg.startsWith("hello_from_sensor_")) {
    String id = msg.substring(18);
    addSensor((uint8_t*)recv_info->src_addr, id);
    logMessage("✅ DISCOVERED → " + id);
    
    if (!mqttClient.connected()) {
      connectToMQTT();
    }
    if (mqttClient.connected()) {
      mqttClient.publish("farmiot/sensor/status", "online");
    }
  }
  
  else if (msg.startsWith("status:soil:")) {
    String soilStr = msg.substring(12);
    int soil = soilStr.toInt();
    
    uint8_t* senderMac = (uint8_t*)recv_info->src_addr;
    for (int i = 0; i < sensorCount; i++) {
      if (memcmp(sensors[i].mac, senderMac, 6) == 0) {
        sensors[i].lastSeen = now;
        sensors[i].latestSoil = soil;
        logMessage("📥 RSP ← " + sensors[i].id + " | Soil: " + String(soil));
        
        if (!mqttClient.connected()) {
          connectToMQTT();
        }
        if (mqttClient.connected()) {
          mqttClient.publish("farmiot/sensor/soil", String(soil).c_str());
          mqttClient.publish("farmiot/sensor/status", "online");
        }
        return;
      }
    }
  }
}