const express = require('express');
const mqtt = require('mqtt');
const path = require('path');

const app = express();

// MQTT connection with auto-reconnect
const mqttOptions = {
  keepalive: 60,
  reconnectPeriod: 5000,
  connectTimeout: 30000
};

const mqttClient = mqtt.connect('mqtt://broker.hivemq.com', mqttOptions);

// Store last seen timestamps and data
let hubSeen = 0;
let sensorSeen = 0;
let latestSoil = null;
let soilTimestamp = 0;
let logEntries = [];

// Timestamp function
function getTimestamp() {
  const now = new Date();
  return now.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function logMessage(message, type = 'INFO') {
  const timestamp = getTimestamp();
  const logEntry = `[${timestamp}] [${type}] ${message}`;
  console.log(logEntry);
  
  // Store in memory for API
  logEntries.unshift({ timestamp, type, message });
  if (logEntries.length > 100) logEntries.pop();
}

// MQTT event handlers
mqttClient.on('connect', () => {
  logMessage('✅ Server MQTT Connected', 'SUCCESS');
  mqttClient.subscribe('farmiot/hub/status');
  mqttClient.subscribe('farmiot/sensor/status');
  mqttClient.subscribe('farmiot/sensor/soil');
  logMessage('📡 Subscribed to topics: farmiot/#', 'INFO');
});

mqttClient.on('reconnect', () => {
  logMessage('🔄 MQTT Reconnecting...', 'WARN');
});

mqttClient.on('close', () => {
  logMessage('⚠️ MQTT Connection Closed', 'WARN');
});

mqttClient.on('error', (error) => {
  logMessage(`❌ MQTT Error: ${error.message}`, 'ERROR');
});

mqttClient.on('message', (topic, message) => {
  const msgStr = message.toString();
  const now = Date.now();
  
  logMessage(`📨 MQTT: ${topic} -> ${msgStr}`, 'MQTT');
  
  if (topic === 'farmiot/hub/status') {
    hubSeen = now;
    logMessage(`📡 Hub status updated: ${msgStr}`, 'HUB');
  }
  else if (topic === 'farmiot/sensor/status') {
    sensorSeen = now;
    logMessage(`📡 Sensor status updated: ${msgStr}`, 'SENSOR');
  }
  else if (topic === 'farmiot/sensor/soil') {
    const soilValue = parseInt(msgStr);
    if (!isNaN(soilValue)) {
      latestSoil = soilValue;
      soilTimestamp = now;
      logMessage(`🌱 Soil data updated: ${soilValue}`, 'SOIL');
    }
  }
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

app.get('/api/logs', (req, res) => {
  res.json({ logs: logEntries.slice(0, 50) });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    mqtt: mqttClient.connected,
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

// Start server
const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  logMessage(`✅ FarmIOT Server running on port ${PORT}`, 'SUCCESS');
  logMessage(`🌐 Open http://localhost:${PORT} in your browser`, 'INFO');
});