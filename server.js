const express = require('express');
const mqtt = require('mqtt');
const path = require('path');

const app = express();
app.use(express.json());

// --- MQTT Broker ---
const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');

let latestSensorData = 0;
let lastSeen = 0;

mqttClient.on('connect', () => {
  console.log('✅ MQTT Connected to broker.hivemq.com');
  mqttClient.subscribe('farmiot/response');
});

mqttClient.on('message', (topic, message) => {
  if (topic === 'farmiot/response') {
    latestSensorData = parseInt(message.toString());
    lastSeen = Date.now();
    console.log(`🌱 Soil data received: ${latestSensorData}`);
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/api/esp32/soil', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  // Return a default value for now (replace with your actual sensor data)
  res.json({ moisture: 42 });
});
app.get('/api/esp32/status', (req, res) => {
  // Always return valid JSON
  res.setHeader('Content-Type', 'application/json');
  
  // You can replace this logic with your actual ESP32 presence check
  // For now, we'll assume it's online if we can reach the MQTT broker
  const isOnline = true; // Replace with actual check later
  
  res.json({ online: isOnline });
});

// --- Valve Control ---
app.post('/api/valve/command', (req, res) => {
  const { state } = req.body;
  console.log(`💧 Sending command: ${state}`);
  mqttClient.publish('farmiot/command', state);
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});