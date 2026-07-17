const express = require('express');
const mqtt = require('mqtt');
const path = require('path');

const app = express();
app.use(express.json());

const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');

let latestMoisture = 0;
let lastUpdate = 0;

mqttClient.on('connect', () => {
  console.log('✅ MQTT Connected');
  mqttClient.subscribe('farmiot/response');
});

mqttClient.on('message', (topic, message) => {
  if (topic === 'farmiot/response') {
    latestMoisture = parseInt(message.toString());
    lastUpdate = Date.now();
    console.log(`🌱 Soil: ${latestMoisture} at ${new Date().toISOString()}`);
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.get('/api/esp32/status', (req, res) => {
  res.json({
    online: (Date.now() - lastUpdate) < 30000,
    lastUpdate: lastUpdate
  });
});

app.get('/api/esp32/soil', (req, res) => {
  res.json({ moisture: latestMoisture });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});