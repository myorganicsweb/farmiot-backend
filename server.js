const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.json());

const supabaseUrl = 'https://adxaifphothopomwutcg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkeGFpZnBob3Rob3BvbXd1dGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxOTM4NTEsImV4cCI6MjA5Nzc2OTg1MX0.uMbkFZP4kPnjJamcaVwgMhcgDbJkkDg1JYbz0HVDfYk';
const supabase = createClient(supabaseUrl, supabaseKey);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

let currentLedState = "off";
let latestFirmwareUrl = "";
let currentFirmwareVersion = "v1.0.1";

// --- POLL ENDPOINT (ESP32 calls this every 500ms) ---
app.get('/api/poll', async (req, res) => {
  const reportedVersion = req.query.version;
  if (reportedVersion) {
    currentFirmwareVersion = reportedVersion;
    console.log("📦 ESP32 firmware version reported:", reportedVersion);
  }

  const { data, error } = await supabase
    .from('firmware_releases')
    .select('file_url')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!error && data) {
    latestFirmwareUrl = data.file_url;
  }

  res.json({
    state: currentLedState,
    firmwareUrl: latestFirmwareUrl,
    force_update: false
  });
});

// --- FIRMWARE LIST ---
app.get('/api/firmware/list', async (req, res) => {
  const { data, error } = await supabase
    .from('firmware_releases')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json(error);
  res.json(data);
});

// --- FIRMWARE UPLOAD ---
app.post('/api/firmware/upload', async (req, res) => {
  const { version, file_url, description } = req.body;
  const { data, error } = await supabase
    .from('firmware_releases')
    .insert([{ version, file_url, description }]);
  if (error) {
    console.error("Supabase error:", error);
    return res.status(500).json({ error: "Database error" });
  }
  res.json({ status: "ok", message: "Firmware release saved!" });
});

// --- LED CONTROL ---
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

// --- VERSION ---
app.get('/api/esp32/version', (req, res) => {
  res.json({ version: currentFirmwareVersion });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Universal Server running on port ${PORT}`);
});