const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.json());

// --- Connect to Mosquitto instead of HiveMQ ---
const ws = new WebSocket('ws://test.mosquitto.org:8080/mqtt');

let latestMoisture = 0;
let lastUpdate = 0;

ws.on('open', () => {
  console.log('✅ Server WebSocket connected to Mosquitto');
  ws.send(JSON.stringify({ type: 'subscribe', topic: 'farmiot/response' }));
  console.log('📡 Subscribed to farmiot/response');
});

ws.on('message', (data) => {
  console.log(`📡 Server received: ${data}`);
  try {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'publish' && msg.topic === 'farmiot/response') {
      latestMoisture = parseInt(msg.payload);
      lastUpdate = Date.now();
      console.log(`🌱 Soil updated: ${latestMoisture}`);
    }
  } catch (e) {}
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