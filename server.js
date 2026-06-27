const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.json());

// Supabase setup
const supabaseUrl = 'https://adxaifphothopomwutcg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkeGFpZnBob3Rob3BvbXd1dGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxOTM4NTEsImV4cCI6MjA5Nzc2OTg1MX0.uMbkFZP4kPnjJamcaVwgMhcgDbJkkDg1JYbz0HVDfYk';
const supabase = createClient(supabaseUrl, supabaseKey);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/api/dashboard/1', async (req, res) => {
  const { data, error } = await supabase.from('sensor_data').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json(error);
  res.json(data);
});

// WebSocket Server
const wss = new WebSocket.Server({ noServer: true });
const connectedDevices = {};

app.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

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

app.get('/api/firmware/list', async (req, res) => {
  const { data, error } = await supabase.from('firmware_releases').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json(error);
  res.json(data);
});

app.post('/api/firmware/upload', async (req, res) => {
  const { version, file_url, description } = req.body;
  const { data, error } = await supabase.from('firmware_releases').insert([{ version, file_url, description }]);
  if (error) return res.status(500).json(error);
  res.json({ status: "ok", message: "Firmware release saved!" });
});

app.post('/api/ota/update', async (req, res) => {
  const { deviceId } = req.body;
  const { data, error } = await supabase.from('firmware_releases').select('file_url').order('created_at', { ascending: false }).limit(1).single();
  if (error || !data) return res.status(404).json({ error: "No firmware found." });
  if (!connectedDevices[deviceId]) return res.status(404).json({ error: "Device not currently connected." });
  
  connectedDevices[deviceId].send(JSON.stringify({ action: "ota_update", url: data.file_url }));
  res.json({ status: "ok", message: "OTA command sent to device." });
});

// --- NEW: Send Wi-Fi credentials to the ESP32 via Bluetooth ---
app.post('/api/wifi/provision', async (req, res) => {
  const { deviceId, ssid, password } = req.body;

  if (!connectedDevices[deviceId]) {
    return res.status(404).json({ error: "Device not connected. Make sure the ESP32 is in Discovery Mode (solid blue)." });
  }

  // Send Wi-Fi credentials via the active WebSocket
  connectedDevices[deviceId].send(JSON.stringify({
    action: "wifi_provision",
    ssid: ssid,
    password: password
  }));

  console.log(`📡 Sending Wi-Fi credentials to ${deviceId} via Bluetooth`);
  res.json({ status: "ok", message: "Credentials sent. Device will connect to Wi-Fi." });
});

app.get('/api/device/:device/:state', (req, res) => {
  const { device, state } = req.params;
  const deviceId = "esp32_01";
  if (!connectedDevices[deviceId]) return res.status(404).send("Device not connected");
  connectedDevices[deviceId].send(JSON.stringify({ action: "control", device: device, state: state }));
  res.send(`Command sent to ${device}: ${state}`);
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Universal Server running on port ${PORT}`);
});