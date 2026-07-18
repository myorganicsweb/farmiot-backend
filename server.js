const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
app.use(express.json());

let latestMoisture = 0;
let lastUpdate = 0;

// --- HUB's IP ADDRESS (must be static or reserved on your router) ---
const HUB_IP = "192.168.1.35";

// --- Server polls the Hub every 5 seconds ---
setInterval(() => {
  http.get(`http://${HUB_IP}/api/status`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.online !== undefined) {
          lastUpdate = Date.now();
          console.log(`📡 Hub replied: online=${json.online}`);
        }
      } catch (e) {
        console.log("⚠️ Invalid response from Hub");
      }
    });
  }).on('error', (e) => {
    console.log("❌ Hub unreachable (ESP32 offline)");
    // Do NOT update lastUpdate here — this keeps status Offline
  });
}, 5000); // Every 5 seconds

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.get('/api/esp32/status', (req, res) => {
  const isOnline = (Date.now() - lastUpdate) < 15000;
  res.json({ online: isOnline });
});

app.get('/api/esp32/soil', (req, res) => {
  res.json({ moisture: latestMoisture });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});