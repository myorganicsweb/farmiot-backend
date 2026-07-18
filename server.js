app.post('/api/sensor/update', (req, res) => {
  const { moisture } = req.body;
  console.log(`📡 Received: ${moisture}`);
  
  if (moisture === -1) {
    // This is a heartbeat, not soil data
    console.log("💓 Heartbeat received");
  } else {
    // This is real soil data
    latestMoisture = moisture;
  }
  
  // Update the last seen time for BOTH heartbeats and soil data
  lastUpdate = Date.now();
  res.json({ status: 'ok' });
});