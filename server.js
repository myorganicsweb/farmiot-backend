const express = require('express');
const mqtt = require('mqtt');
const path = require('path');

const app = express();

const mqttOptions = {
  keepalive: 60,
  reconnectPeriod: 5000,
  connectTimeout: 30000
};

const mqttClient = mqtt.connect('mqtt://broker.hivemq.com', mqttOptions);

let hubSeen = 0;
let sensorSeen = 0;
let latestSoil = null;
let soilTimestamp = 0;

function getTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { hour12: false });
}

function logMessage(message) {
  console.log(`[${getTimestamp()}] ${message}`);
}

mqttClient.on('connect', () => {
  logMessage('✅ MQTT Connected');
  mqttClient.subscribe('farmiot/hub/status');
  mqttClient.subscribe('farmiot/sensor/status');
  mqttClient.subscribe('farmiot/sensor/soil');
  logMessage('📡 Subscribed to farmiot/#');
});

mqttClient.on('reconnect', () => {
  logMessage('🔄 MQTT Reconnecting...');
});

mqttClient.on('error', (error) => {
  logMessage(`❌ MQTT Error: ${error.message}`);
});

mqttClient.on('message', (topic, message) => {
  const msgStr = message.toString();
  const now = Date.now();
  
  if (topic === 'farmiot/hub/status') {
    hubSeen = now;
  }
  else if (topic === 'farmiot/sensor/status') {
    sensorSeen = now;
    logMessage(`📡 Sensor: ${msgStr}`);
  }
  else if (topic === 'farmiot/sensor/soil') {
    const soilValue = parseInt(msgStr);
    if (!isNaN(soilValue)) {
      latestSoil = soilValue;
      soilTimestamp = now;
      logMessage(`🌱 Soil: ${soilValue}`);
    }
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/api/hub/status', (req, res) => {
  const isOnline = (Date.now() - hubSeen) < 15000;
  res.json({ online: isOnline, lastSeen: hubSeen || null });
});

app.get('/api/sensor/status', (req, res) => {
  const isOnline = (Date.now() - sensorSeen) < 30000;
  res.json({ online: isOnline, lastSeen: sensorSeen || null });
});

app.get('/api/sensor/soil', (req, res) => {
  res.json({ moisture: latestSoil, lastUpdated: soilTimestamp || null });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', mqtt: mqttClient.connected, timestamp: Date.now() });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  logMessage(`✅ Server running on port ${PORT}`);
  logMessage(`🌐 Open http://localhost:${PORT}`);
});