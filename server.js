const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

// --- ESP32's local IP address ---
const ESP32_IP = "192.168.1.35";

// --- PROXY: UI calls Render -> Render calls ESP32 -> Returns data to UI ---
app.get('/api/esp32/soil', async (req, res) => {
  try {
    const response = await http.get(`http://${ESP32_IP}/soil`);
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      try {
        res.json(JSON.parse(data));
      } catch {
        res.status(500).json({ error: "Invalid JSON from ESP32" });
      }
    });
  } catch (error) {
    console.error("❌ ESP32 offline");
    res.json({ moisture: 0 });
  }
});

app.get('/api/esp32/status', async (req, res) => {
  try {
    const response = await http.get(`http://${ESP32_IP}/status`);
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => res.json(JSON.parse(data)));
  } catch {
    res.json({ online: false });
  }
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});