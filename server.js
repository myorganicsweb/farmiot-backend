const express = require('express');
const http = require('http');
const path = require('path');

const app = express();

// --- HUB's IP ADDRESS (change this to match your ESP32's IP) ---
const HUB_IP = "192.168.1.35";

let lastUpdate = 0;

// --- Poll the Hub every 5 seconds ---
setInterval(() => {
  http.get(`http://${HUB_IP}/api/status`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.online !== undefined) {
          lastUpdate = Date.now();
          console.log("📡 Hub is online");
        }
      } catch (e) {}
    });
  }).on('error', (e) => {
    console.log("❌ Hub is offline");
  });
}, 5000);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.get('/api/esp32/status', (req, res) => {
  const isOnline = (Date.now() - lastUpdate) < 15000;
  res.json({ online: isOnline });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});