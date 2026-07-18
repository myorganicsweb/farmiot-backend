// ==========================================
// SENSOR ESP32-C3: Light Sleep (Working)
// ==========================================

#include <esp_now.h>
#include <WiFi.h>
#include <time.h>
#include <esp_sleep.h>

const char* ssid = "scoobydoo gateway";
const char* password = "scoobydoo";

uint8_t broadcastMac[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
uint8_t hubMac[6];

int soilPin = 4;
String sensorID = "Sensor_01";

RTC_DATA_ATTR bool hubDiscovered = false;
RTC_DATA_ATTR uint8_t savedHubMac[6];

unsigned long lastRequestTime = 0;
const unsigned long INACTIVITY_TIMEOUT = 30000; // 30 seconds
bool isAwake = true;

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

bool connectToWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }
  
  logMessage("🔄 WiFi Connecting...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(200);
    attempts++;
    Serial.print(".");
    
    if (attempts % 10 == 0) {
      Serial.println();
      Serial.print("⏳ Still connecting... ");
    }
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    logMessage("✅ WiFi Connected | IP: " + WiFi.localIP().toString());
    configTime(0, 3600, "pool.ntp.org");
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      logMessage("✅ Time Synced");
    }
    return true;
  } else {
    logMessage("❌ WiFi Failed!");
    return false;
  }
}

void sendDiscovery() {
  if (WiFi.status() != WL_CONNECTED) {
    logMessage("⚠️ No WiFi - Cannot send discovery");
    return;
  }
  
  String discoveryMsg = "hello_from_sensor_" + sensorID;
  esp_err_t result = esp_now_send(broadcastMac, (uint8_t*)discoveryMsg.c_str(), discoveryMsg.length());
  
  if (result == ESP_OK) {
    logMessage("📤 DISCOVERY → " + discoveryMsg);
  } else {
    logMessage("❌ Discovery send failed");
  }
}

void sendResponse(int soilValue) {
  if (WiFi.status() != WL_CONNECTED) {
    logMessage("⚠️ No WiFi - Cannot send response");
    return;
  }
  
  String reply = "status:soil:" + String(soilValue);
  
  if (hubDiscovered) {
    esp_err_t result = esp_now_send(savedHubMac, (uint8_t*)reply.c_str(), reply.length());
    if (result == ESP_OK) {
      logMessage("📤 RSP → HUB | Soil: " + String(soilValue));
    } else {
      logMessage("❌ Failed to send to hub - trying broadcast");
      esp_now_send(broadcastMac, (uint8_t*)reply.c_str(), reply.length());
    }
  } else {
    esp_now_send(broadcastMac, (uint8_t*)reply.c_str(), reply.length());
    logMessage("📤 RSP → BROADCAST | Soil: " + String(soilValue));
  }
}

void goToLightSleep() {
  logMessage("💤 No activity - Entering light sleep...");
  logMessage("⚡ Will wake on ESP-NOW request");
  Serial.println("================================");
  
  isAwake = false;
  
  // Disconnect WiFi to save power
  if (WiFi.status() == WL_CONNECTED) {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    logMessage("📴 WiFi Disconnected");
  }
  
  // Configure wake-up on ESP-NOW
  esp_sleep_enable_wifi_wakeup();
  
  // Enter light sleep
  esp_light_sleep_start();
  
  // Code resumes here after wake
  logMessage("⚡ Woken from light sleep");
  isAwake = true;
  lastRequestTime = millis();
  
  // Reconnect WiFi
  connectToWiFi();
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  setCpuFrequencyMhz(80);

  logMessage("=== SENSOR STARTED ===");
  logMessage("🆔 ID: " + sensorID);

  pinMode(soilPin, INPUT);

  // Connect WiFi
  connectToWiFi();

  // Initialize ESP-NOW
  if (esp_now_init() != ESP_OK) {
    logMessage("❌ ESP-NOW Init Failed!");
    return;
  }
  
  esp_now_register_recv_cb(onDataReceived);
  
  // Add broadcast peer
  esp_now_peer_info_t peerInfo;
  memcpy(peerInfo.peer_addr, broadcastMac, 6);
  peerInfo.channel = 0;
  peerInfo.ifidx = WIFI_IF_STA;
  peerInfo.encrypt = false;
  esp_now_add_peer(&peerInfo);
  
  // Restore hub peer if discovered
  if (hubDiscovered) {
    esp_now_peer_info_t hubPeer;
    memcpy(hubPeer.peer_addr, savedHubMac, 6);
    hubPeer.channel = 0;
    hubPeer.ifidx = WIFI_IF_STA;
    hubPeer.encrypt = false;
    esp_now_add_peer(&hubPeer);
    logMessage("✅ Restored Hub Peer");
  }
  
  // Send discovery
  sendDiscovery();
  
  lastRequestTime = millis();
  isAwake = true;
  
  logMessage("📡 Waiting for requests...");
  logMessage("💤 Will sleep after 30s of inactivity");
  Serial.println("================================");
}

void loop() {
  unsigned long now = millis();
  
  // Check inactivity timeout
  if (isAwake && (now - lastRequestTime >= INACTIVITY_TIMEOUT)) {
    // If hub not discovered, try sending discovery
    if (!hubDiscovered && WiFi.status() == WL_CONNECTED) {
      sendDiscovery();
      lastRequestTime = now;
      return;
    }
    goToLightSleep();
    return;
  }
  
  // Periodic discovery if hub not found
  if (!hubDiscovered && WiFi.status() == WL_CONNECTED) {
    if (now - lastRequestTime >= 10000) {
      sendDiscovery();
      lastRequestTime = now;
    }
  }
  
  // Check WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
  }
  
  delay(100);
}

void onDataReceived(const esp_now_recv_info_t *recv_info, const uint8_t *data, int len) {
  // Reset inactivity timer - keeps us awake
  lastRequestTime = millis();
  isAwake = true;
  
  String cmd = String((char*)data).substring(0, len);
  
  Serial.println("⚡ REQUEST RECEIVED");
  logMessage("📥 REQ ← " + cmd);
  
  // Connect to WiFi if not connected
  if (WiFi.status() != WL_CONNECTED) {
    logMessage("🔄 Connecting to WiFi...");
    if (!connectToWiFi()) {
      logMessage("❌ WiFi Failed - Cannot respond");
      return;
    }
  }
  
  if (cmd == "get_status") {
    // Store hub MAC
    memcpy(hubMac, recv_info->src_addr, 6);
    
    // Save hub for future use
    if (!hubDiscovered) {
      memcpy(savedHubMac, hubMac, 6);
      hubDiscovered = true;
      logMessage("✅ Hub Discovered & Saved");
      
      // Add hub as peer
      esp_now_peer_info_t hubPeer;
      memcpy(hubPeer.peer_addr, hubMac, 6);
      hubPeer.channel = 0;
      hubPeer.ifidx = WIFI_IF_STA;
      hubPeer.encrypt = false;
      esp_now_add_peer(&hubPeer);
    }
    
    // Read soil moisture
    int soil = analogRead(soilPin);
    logMessage("📊 Soil Reading: " + String(soil));
    
    // Send response
    sendResponse(soil);
    
    logMessage("⏳ Staying awake (reset 30s timer)");
    Serial.println("================================");
  }
}