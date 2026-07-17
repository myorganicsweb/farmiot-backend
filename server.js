const express = require('express');
const mqtt = require('mqtt');
const path = require('path');

const app = express();
app.use(express.json());

const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');

let latestSensorData = {
  moisture: 0,
  lastSeen: 0
};

mqttClient.on('connect', () => {
  console.log('✅ MQTT Connected to broker.hivemq.com');
  mqttClient.subscribe('farmiot/response');
});

mqttClient.on('message', (topic, message) => {
  console.log(`📡 MQTT Message [${topic}]: ${message.toString()}`);
  
  if (topic === 'farmiot/response') {
    const moisture = parseInt(message.toString());
    latestSensorData.moisture = moisture;
    latestSensorData.lastSeen = Date.now();
    console.log(`🌱 Soil updated: ${moisture} at ${new Date().toISOString()}`);
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/api/esp32/status', (req, res) => {
  const now = Date.now();
  const isOnline = (now - latestSensorData.lastSeen) < 30000;
  res.json({
    online: isOnline,
    lastSeen: latestSensorData.lastSeen,
    now: now
  });
});

app.get('/api/esp32/soil', (req, res) => {
  res.json({ moisture: latestSensorData.moisture });
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