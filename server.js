const express = require('express');
const mqtt = require('mqtt');
const path = require('path');

const app = express();
app.use(express.json());

// --- 1. Connect to MQTT broker FIRST ---
const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');

// --- 2. Store the latest sensor data ---
let latestSensorData = {
  moisture: 0,
  lastSeen: 0
};

// --- 3. Set up MQTT event listeners AFTER client is created ---
mqttClient.on('connect', () => {
  console.log('✅ MQTT Connected to broker.hivemq.com');
  mqttClient.subscribe('farmiot/response');
});

mqttClient.on('message', (topic, message) => {
  if (topic === 'farmiot/response') {
    const moisture = parseInt(message.toString());
    latestSensorData.moisture = moisture;
    latestSensorData.lastSeen = Date.now();
    console.log(`🌱 Soil data received: ${moisture}`);
  }
});

// --- 4. Serve the dashboard ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// --- 5. API Endpoints ---
app.get('/api/esp32/status', (req, res) => {
  const now = Date.now();
  const isOnline = (now - latestSensorData.lastSeen) < 30000; // 30 seconds
  res.json({ online: isOnline });
});

app.get('/api/esp32/soil', (req, res) => {
  res.json({ moisture: latestSensorData.moisture });
});

// --- 6. Valve Command Endpoint ---
app.post('/api/valve/command', (req, res) => {
  const { state } = req.body;
  console.log(`💧 Command received: ${state}`);
  mqttClient.publish('farmiot/command', state);
  res.json({ status: 'ok' });
});

// --- 7. Start the server ---
const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});