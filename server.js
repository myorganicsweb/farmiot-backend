const express = require('express');
const path = require('path');

const app = express();  // <--- THIS LINE IS REQUIRED
app.use(express.json());

let latestMoisture = 0;
let lastUpdate = 0;

app.post('/api/sensor/update', (req, res) => {
  const { moisture } = req.body;
  console.log(`📡 Received: ${moisture}`);
  if (moisture !== -1) {
    latestMoisture = moisture;
  }
  lastUpdate = Date.now();
  res.json({ status: 'ok' });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.get('/api/esp32/status', (req, res) => {
  const isOnline = (Date.now() - lastUpdate) < 30000;
  res.json({ online: isOnline });
});

app.get('/api/esp32/soil', (req, res) => {
  res.json({ moisture: latestMoisture });
});

const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});