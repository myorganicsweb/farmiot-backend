const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.sendFile(__dirname + '/dashboard.html'));

// The ESP32's local IP address (it will stay the same because of the reservation)
const ESP32_IP = "192.168.1.119";

// --- UI asks backend for soil data ---
app.get('/api/esp32/soil', async (req, res) => {
  try {
    const response = await http.get(`http://${ESP32_IP}/soil`);
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => res.json(JSON.parse(data)));
  } catch (error) {
    res.status(500).json({ error: "ESP32 not reachable" });
  }
});

// --- UI asks backend if ESP32 is online ---
app.get('/api/esp32/status', async (req, res) => {
  try {
    const response = await http.get(`http://${ESP32_IP}/status`);
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => res.json(JSON.parse(data)));
  } catch (error) {
    res.json({ online: false });
  }
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});