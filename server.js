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

// Serve dashboard
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/api/dashboard/1', async (req, res) => {
  const { data, error } = await supabase.from('sensor_data').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json(error);
  res.json(data);
});

// --- UNIVERSAL WEB SOCKET SERVER (For compatibility) ---
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

// --- GET FIRMWARE LIST FROM SUPABASE ---
app.get('/api/firmware/list', async (req, res) => {
  const { data, error } = await supabase
    .from('firmware_releases')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json(error);
  res.json(data);
});

// --- UPLOAD NEW FIRMWARE URL TO SUPABASE ---
app.post('/api/firmware/upload', async (req, res) => {
  const { version, file_url, description } = req.body;
  
  const { data, error } = await supabase
    .from('firmware_releases')
    .insert([{ version, file_url, description }]);

  if (error) return res.status(500).json(error);
  res.json({ status: "ok", message: "Firmware release saved!" });
});

// --- LED STATUS ENDPOINT FOR HTTP POLLING ---
let currentLedState = "off";

app.get('/api/led/status', (req, res) => {
  res.json({ state: currentLedState });
});

app.post('/api/led/set', (req, res) => {
  const { state } = req.body;
  if (state === "on" || state === "off") {
    currentLedState = state;
    console.log(`💡 LED state set to: ${state}`);
    res.json({ status: "ok", message: "LED state updated." });
  } else {
    res.status(400).json({ error: "Invalid state. Use 'on' or 'off'." });
  }
});

// --- OTA UPDATE ENDPOINT (Fixes the 404 error) ---
app.post('/api/ota/update', async (req, res) => {
  const { deviceId } = req.body;
  
  // Fetch the latest firmware from Supabase
  const { data, error } = await supabase
    .from('firmware_releases')
    .select('file_url')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error("Supabase error:", error);
    return res.status(500).json({ error: "Database error" });
  }
  if (!data) {
    return res.status(404).json({ error: "No firmware found in database." });
  }
  
  // For HTTP polling, the device pulls the update URL itself.
  // This endpoint is kept for compatibility with the dashboard button.
  
  res.json({ 
    status: "ok", 
    message: "Firmware update available. Device will pull on next poll.",
    firmwareUrl: data.file_url 
  });
});

// --- CONTROL DEVICE (Legacy WebSocket endpoint) ---
app.get('/api/device/:device/:state', (req, res) => {
  const { device, state } = req.params;
  const deviceId = "esp32_01"; 
  
  if (!connectedDevices[deviceId]) {
    return res.status(404).send("Device not connected");
  }
  
  connectedDevices[deviceId].send(JSON.stringify({
    action: "control",
    device: device,
    state: state
  }));
  
  res.send(`Command sent to ${device}: ${state}`);
});

// --- LISTEN ON PORT 443 ---
const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Universal Server running on port ${PORT}`);
});