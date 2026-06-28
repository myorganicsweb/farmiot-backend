let currentLedState = "off";
let latestFirmwareUrl = "";  // Store the latest firmware URL

// Function to fetch the latest firmware URL from Supabase
async function updateLatestFirmwareUrl() {
  const { data, error } = await supabase
    .from('firmware_releases')
    .select('file_url')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!error && data) {
    latestFirmwareUrl = data.file_url;
  }
}

// Call this periodically to keep the URL fresh
setInterval(updateLatestFirmwareUrl, 60000); // Every 60 seconds

app.get('/api/led/status', (req, res) => {
  res.json({ 
    state: currentLedState,
    firmwareUrl: latestFirmwareUrl
  });
});