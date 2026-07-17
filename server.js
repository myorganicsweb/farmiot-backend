const express = require('express');
const mqtt = require('mqtt');
const path = require('path');

const app = express();
app.use(express.json());

const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');

let latestMoisture = 0;
let lastUpdate = 0;

mqttClient.on('connect', () => {
  console.log('✅ MQTT Connected to broker.hivemq.com');
  mqttClient.subscribe('farmiot/response');
});

mqttClient.on('message', (topic, message) => {
  if (topic === 'farmiot/response') {
    const val = parseInt(message.toString());
    if (!isNaN(val)) {
      latestMoisture = val;
      lastUpdate = Date.now();
      console.log(`🌱 Soil: ${val} at ${new Date().toISOString()}`);
    }
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.get('/api/esp32/status', (req, res) => {
  const now = Date.now();
  const isOnline = (now - lastUpdate) < 30000; // 30 seconds
  res.json({ online: isOnline });
});

app.get('/api/esp32/soil', (req, res) => {
  res.json({ moisture: latestMoisture });
});

app.post('/api/valve/command', (req, res) => {
  const { state } = req.body;
  console.log(`💧 Command: ${state}`);
  mqttClient.publish('farmiot/command', state);
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});