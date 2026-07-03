const express = require('express');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabaseUrl = 'https://adxaifphothopomwutcg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkeGFpZnBob3Rob3BvbXd1dGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxOTM4NTEsImV4cCI6MjA5Nzc2OTg1MX0.uMbkFZP4kPnjJamcaVwgMhcgDbJkkDg1JYbz0HVDfYk';
const supabase = createClient(supabaseUrl, supabaseKey);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

// --- State file path ---
const STATE_FILE = '/tmp/last_poll.json';

// Helper: Read state from file
function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {}
  return { lastPollTime: 0 };
}

// Helper: Write state to file
function writeState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (e) {}
}

let currentLedState = "off";
let currentPumpState = "off";
let latestFirmwareUrl = "";
let currentFirmwareVersion = "v1.0.0";
let latestSensorData = { moisture: 0, timestamp: Date.now() };

// --- POLL ENDPOINT ---
app.get('/api/poll', async (req, res) => {
  // --- SAVE LAST POLL TIME TO FILE ---
  const now = Date.now();
  const state = readState();
  state.lastPollTime = now;
  writeState(state);
  
  console.log(`📡 Poll received at ${new Date(now).toISOString()}`);

  const reportedVersion = req.query.version;
  if (reportedVersion) {
    currentFirmwareVersion = reportedVersion;
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

  let finalState = "off";
  if (currentPumpState == "on") {
    finalState = "on";
  } else {
    finalState = currentLedState;
  }

  res.json({
    state: finalState,
    firmwareUrl: latestFirmwareUrl,
    force_update: false
  });
});

// ... (All other routes remain exactly the same) ...

// --- STATUS ENDPOINT ---
app.get('/api/esp32/status', (req, res) => {
  const state = readState();
  const now = Date.now();
  const isOnline = (now - state.lastPollTime) < 6000;
  res.json({ online: isOnline });
});

// --- VERSION ---
app.get('/api/esp32/version', (req, res) => {
  res.json({ version: currentFirmwareVersion });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});