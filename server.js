const express = require('express');
const mqtt = require('mqtt');
const path = require('path');

const app = express();

const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');

let hubSeen = 0;
let sensorSeen = 0;
let latestSoil = 0;

mqttClient.on('connect', () => {
  console.log('✅ Server MQTT Connected');
  mqttClient.subscribe('farmiot/hub/status');
  mqttClient.subscribe('farmiot/sensor/status');
  mqttClient.subscribe('farmiot/sensor/soil');
});

mqttClient.on('message', (topic, message) => {
  if (topic === 'farmiot/hub/status') {
    hubSeen = Date.now();
    console.log(`📡 Hub status: ${message.toString()}`);
  }
  if (topic === 'farmiot/sensor/status') {
    sensorSeen = Date.now();
    console.log(`📡 Sensor status: ${message.toString()}`);
  }
  if (topic === 'farmiot/sensor/soil') {
    latestSoil = parseInt(message.toString());
    console.log(`🌱 Soil data: ${latestSoil}`);
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.get('/api/hub/status', (req, res) => {
  const isOnline = (Date.now() - hubSeen) < 15000;
  res.json({ online: isOnline });
});

app.get('/api/sensor/status', (req, res) => {
  const isOnline = (Date.now() - sensorSeen) < 15000;
  res.json({ online: isOnline });
});

app.get('/api/sensor/soil', (req, res) => {
  res.json({ moisture: latestSoil });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});