// ==========================================
// FARMIOT BACKEND: Pull Server (Fixed)
// ==========================================

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();

const supabaseUrl = 'https://adxaifphothopomwutcg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkeGFpZnBob3Rob3BvbXd1dGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxOTM4NTEsImV4cCI6MjA5Nzc2OTg1MX0.uMbkFZP4kPnjJamcaVwgMhcgDbJkkDg1JYbz0HVDfYk';

const supabase = createClient(supabaseUrl, supabaseKey);

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Dashboard API (read from Supabase)
app.get('/api/dashboard/1', async (req, res) => {
  const { data, error } = await supabase
    .from('sensor_data')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json(error);
  res.json(data);
});

// --- POLLING ENGINE (Runs every 5 seconds) ---
async function fetchFromESP32() {
  // Use your Public IP if you set up port forwarding, or use ngrok
  const ESP32_URL = 'http://192.168.1.217:8080/api/data';
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(ESP32_URL, { timeout: 3000 });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      const { error } = await supabase
        .from('sensor_data')
        .insert([{ farmer_id: 1, payload: data }]);
      
      if (error) {
        console.error('Supabase insert error:', error.message);
      } else {
        console.log('Saved to Supabase:', data);
      }
      return;
    } catch (err) {
      console.log(`Attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) console.error('❌ ESP32 unreachable after 3 attempts');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

setInterval(fetchFromESP32, 5000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Pull-Server running on port ${PORT}`);
});