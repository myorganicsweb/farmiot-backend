const express = require('express');
const mqtt = require('mqtt');
const path = require('path');

const app = express();
app.use(express.json());

// --- Connect using port 443 ---
const mqttClient = mqtt.connect('mqtt://broker.hivemq.com:443');

let latestMoisture = 0;
let lastUpdate = 0;

mqttClient.on('connect', () => {
  console.log('✅ MQTT Connected on port 443');
  mqttClient.subscribe('farmiot/response');
});

mqttClient.on('message', (topic, message) => {
  console.log(`📡 MQTT Message [${topic}]: ${message.toString()}`);
  if (topic === 'farmiot/response') {
    latestMoisture = parseInt(message.toString());
    lastUpdate = Date.now();
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.get('/api/esp32/status', (req, res) => {
  res.json({ online: (Date.now() - lastUpdate) < 30000 });
});

app.get('/api/esp32/soil', (req, res) => {
  res.json({ moisture: latestMoisture });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});