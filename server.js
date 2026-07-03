const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

// --- CRITICAL: This is the only endpoint that matters ---
let lastPollTime = 0;

app.get('/api/poll', (req, res) => {
  // Update the timestamp
  lastPollTime = Date.now();
  console.log(`📡 Poll received at ${new Date().toISOString()}`);
  
  res.json({
    state: "off",
    firmwareUrl: "",
    force_update: false
  });
});

app.get('/api/esp32/status', (req, res) => {
  const now = Date.now();
  const isOnline = (now - lastPollTime) < 6000;
  res.json({ online: isOnline });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ Minimal server running on port ${PORT}`);
});