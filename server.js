const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const wss = new WebSocket.Server({ noServer: true });

let espSocket = null;

wss.on('connection', (ws) => {
  espSocket = ws;
  console.log("✅ ESP32 WebSocket Connected");
  
  ws.on('close', () => {
    espSocket = null;
    console.log("❌ ESP32 WebSocket Disconnected");
  });
});

// --- CRITICAL: Handle WebSocket upgrade requests ---
app.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.get('/api/esp32/status', (req, res) => {
  res.json({ online: espSocket !== null });
});

app.get('/api/esp32/soil', async (req, res) => {
  if (!espSocket) return res.json({ moisture: 0 });
  
  espSocket.send("get_soil");
  
  let data = 0;
  for (let i = 0; i < 10; i++) {
    if (espSocket.lastData) {
      data = espSocket.lastData;
      break;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  res.json({ moisture: parseInt(data) });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});