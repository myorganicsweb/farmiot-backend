const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

let latestMoisture = 0;
let lastUpdate = 0;

// --- Hub sends data via HTTP POST ---
app.post('/api/sensor/update', (req, res) => {
  const { moisture } = req.body;
  if (moisture !== undefined) {
    latestMoisture = moisture;
    lastUpdate = Date.now();
    console.log(`🌱 Soil updated: ${moisture}`);
    res.json({ status: 'ok' });
  } else {
    res.status(400).json({ error: 'Invalid data' });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.get('/api/esp32/status', (req, res) => {
  res.json({ online: (Date.now() - lastUpdate) < 30000 });
});

app.get('/api/esp32/soil', (req, res) => {
  res.json({ moisture: latestMoisture });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});