const express = require('express');
const mqtt = require('mqtt');
const path = require('path');

const app = express();

// MQTT connection
const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');

// Store last seen timestamps and data
let hubSeen = 0;
let sensorSeen = 0;
let latestSoil = null;
let soilTimestamp = 0;

// MQTT event handlers
mqttClient.on('connect', () => {
  console.log('✅ Server MQTT Connected');
  mqttClient.subscribe('farmiot/hub/status');
  mqttClient.subscribe('farmiot/sensor/status');
  mqttClient.subscribe('farmiot/sensor/soil');
  console.log('📡 Subscribed to topics: farmiot/#');
});

mqttClient.on('message', (topic, message) => {
  const msgStr = message.toString();
  const now = Date.now();
  
  console.log(`📨 MQTT: ${topic} -> ${msgStr}`);
  
  if (topic === 'farmiot/hub/status') {
    hubSeen = now;
    console.log(`📡 Hub status updated: ${msgStr}`);
  }
  else if (topic === 'farmiot/sensor/status') {
    sensorSeen = now;
    console.log(`📡 Sensor status updated: ${msgStr}`);
  }
  else if (topic === 'farmiot/sensor/soil') {
    const soilValue = parseInt(msgStr);
    if (!isNaN(soilValue)) {
      latestSoil = soilValue;
      soilTimestamp = now;
      console.log(`🌱 Soil data updated: ${soilValue}`);
    }
  }
});

mqttClient.on('error', (error) => {
  console.error('❌ MQTT Error:', error);
});

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// API endpoints
app.get('/api/hub/status', (req, res) => {
  const isOnline = (Date.now() - hubSeen) < 15000;
  res.json({ 
    online: isOnline,
    lastSeen: hubSeen || null
  });
});

app.get('/api/sensor/status', (req, res) => {
  const isOnline = (Date.now() - sensorSeen) < 15000;
  res.json({ 
    online: isOnline,
    lastSeen: sensorSeen || null
  });
});

app.get('/api/sensor/soil', (req, res) => {
  res.json({ 
    moisture: latestSoil,
    lastUpdated: soilTimestamp || null
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    mqtt: mqttClient.connected,
    timestamp: Date.now()
  });
});

// Start server
const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
  console.log(`🌐 Open http://localhost:${PORT} in your browser`);
});