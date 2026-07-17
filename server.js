const express = require('express');
const mqtt = require('mqtt');
const path = require('path');

const app = express();
app.use(express.json());

// --- Connect to the same MQTT broker ---
const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');

let latestMoisture = 0;
let lastUpdate = 0;

mqttClient.on('connect', () => {
  console.log('✅ MQTT Connected to broker.hivemq.com');
  mqttClient.subscribe('farmiot/response', (err) => {
    if (err) {
      console.error('❌ Subscription failed:', err);
    } else {
      console.log('✅ Subscribed to farmiot/response');
    }
  });
});

mqttClient.on('message', (topic, message) => {
  console.log(`📡 MQTT Message [${topic}]: ${message.toString()}`);
  if (topic === 'farmiot/response') {
    latestMoisture = parseInt(message.toString());
    lastUpdate = Date.now();
    console.log(`🌱 Soil updated: ${latestMoisture}`);
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