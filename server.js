// --- Store the last received time ---
let latestSensorData = {
  moisture: 0,
  lastSeen: 0  // <-- NEW: track the time data was received
};

// --- When MQTT receives data, update the timestamp ---
mqttClient.on('message', (topic, message) => {
  if (topic === 'farmiot/response') {
    const moisture = parseInt(message.toString());
    latestSensorData.moisture = moisture;
    latestSensorData.lastSeen = Date.now(); // Update timestamp
    console.log(`🌱 Soil data received: ${moisture}`);
  }
});

// --- Status endpoint now checks the timestamp ---
app.get('/api/esp32/status', (req, res) => {
  const now = Date.now();
  const isOnline = (now - latestSensorData.lastSeen) < 30000; // 30 seconds
  res.json({ online: isOnline });
});

// --- Soil endpoint returns the data ---
app.get('/api/esp32/soil', (req, res) => {
  res.json({ moisture: latestSensorData.moisture });
});