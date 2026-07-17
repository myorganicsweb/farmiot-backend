// ==========================================
// HUB ESP32: Sends soil data via HTTP POST
// ==========================================

#include <WiFi.h>
#include <HTTPClient.h>

const char* ssid = "scoobydoo gateway";
const char* password = "scoobydoo";
const char* server_url = "https://farm-iot.onrender.com/api/sensor/update";

int soilPin = 4;  // Connect your soil sensor to Pin 4

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("=== Hub ESP32 Starting ===");

  pinMode(soilPin, INPUT);

  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ Wi-Fi Connected!");
  Serial.print("📡 IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  // --- 1. Read the sensor ---
  int rawSoil = analogRead(soilPin);
  // Convert to 0-100% (dry = 0%, wet = 100%)
  int percent = 100 - ((rawSoil / 4095.0) * 100);
  if (percent < 0) percent = 0;
  if (percent > 100) percent = 100;

  Serial.println("================================");
  Serial.print("🌱 Raw ADC: ");
  Serial.print(rawSoil);
  Serial.print("  |  Moisture: ");
  Serial.print(percent);
  Serial.println("%");

  // --- 2. Send to Render via HTTP POST ---
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(server_url);
    http.addHeader("Content-Type", "application/json");

    String payload = "{\"moisture\":" + String(rawSoil) + "}";
    Serial.println("📡 Sending POST to Render...");
    Serial.println("📦 Payload: " + payload);

    int httpCode = http.POST(payload);
    
    if (httpCode > 0) {
      Serial.println("✅ HTTP POST sent successfully!");
      Serial.println("📡 Server response code: " + String(httpCode));
    } else {
      Serial.println("❌ HTTP POST failed. Error: " + String(httpCode));
    }
    http.end();
  } else {
    Serial.println("⚠️ Wi-Fi disconnected. Skipping POST.");
  }

  Serial.println("================================\n");
  delay(10000); // Wait 10 seconds before the next read
}