const express = require('express');
const WebSocket = require('ws');

const app = express();
const wss = new WebSocket.Server({ port: 8080 });

let espSocket = null;

wss.on('connection', (ws) => {
  espSocket = ws;
  console.log("✅ ESP32 connected via WebSocket");
});

app.get('/', (req, res) => res.sendFile(__dirname + '/dashboard.html'));

// UI calls this -> Server asks ESP32 via WebSocket
app.get('/api/esp32/soil', async (req, res) => {
  if (!espSocket) return res.json({ moisture: 0 });
  espSocket.send("get_soil");
  
  // Wait for a response (simple polling)
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

app.get('/api/esp32/status', (req, res) => {
  res.json({ online: espSocket !== null });
});

app.listen(443, () => console.log("✅ FarmIOT Server running"));