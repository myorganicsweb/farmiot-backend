const express = require('express');
const mqtt = require('mqtt');
const path = require('path');

const app = express();

// --- Connect to the same MQTT broker ---
const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');

let lastHubSeen = 0;

mqttClient.on('connect', () => {
  console.log('✅ Server MQTT Connected');
  mqttClient.subscribe('farmiot/hub/status');
});

mqttClient.on('message', (topic, message) => {
  if (topic === 'farmiot/hub/status') {
    lastHubSeen = Date.now();
    console.log(`📡 Hub status received: ${message.toString()}`);
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.get('/api/hub/status', (req, res) => {
  const isOnline = (Date.now() - lastHubSeen) < 15000;
  res.json({ online: isOnline });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});