const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.json());

// Supabase setup (Keep your original keys here)
const supabaseUrl = 'https://adxaifphothopomwutcg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkeGFpZnBob3Rob3BvbXd1dGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxOTM4NTEsImV4cCI6MjA5Nzc2OTg1MX0.uMbkFZP4kPnjJamcaVwgMhcgDbJkkDg1JYbz0HVDfYk';
const supabase = createClient(supabaseUrl, supabaseKey);

// Serve dashboard
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/api/dashboard/1', async (req, res) => {
  const { data, error } = await supabase.from('sensor_data').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json(error);
  res.json(data);
});

// --- WEB SOCKET SERVER ---
// IMPORTANT: Render uses PORT 8080 for WebSockets
const wss = new WebSocket.Server({ port: 8080 }); 
const connectedDevices = {};

wss.on('connection', (ws, req) => {
  const deviceId = req.url.split('/').pop();
  connectedDevices[deviceId] = ws;
  console.log(`✅ ESP32 ${deviceId} connected remotely!`);

  ws.on('message', (message) => {
    console.log(`📡 Received from ${deviceId}:`, message.toString());
  });

  ws.on('close', () => {
    delete connectedDevices[deviceId];
    console.log(`❌ ESP32 ${deviceId} disconnected.`);
  });
});

// --- API: Trigger OTA Update ---
app.post('/api/ota/update', async (req, res) => {
  const { deviceId, firmwareUrl } = req.body;
  
  if (!connectedDevices[deviceId]) {
    return res.status(404).json({ error: "Device not currently connected." });
  }

  connectedDevices[deviceId].send(JSON.stringify({
    action: "ota_update",
    url: firmwareUrl
  }));

  console.log(`📡 Sending OTA update command to ${deviceId}`);
  res.json({ status: "ok", message: "OTA command sent to device." });
});

// For Render's standard web port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});