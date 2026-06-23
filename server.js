// ==========================================
// FARMIOT BACKEND: Accepts Data from Mac Gateway
// ==========================================

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();

// Allow JSON POST requests
app.use(express.json());

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

// --- NEW ENDPOINT: Receives data from your Mac ---
app.post('/api/sensor', async (req, res) => {
  try {
    const data = req.body;
    console.log("📡 Data received from Mac Gateway:", data);

    const { error } = await supabase
      .from('sensor_data')
      .insert([{ farmer_id: 1, payload: data }]);
    
    if (error) {
      console.error('❌ Supabase insert error:', error.message);
    } else {
      console.log('💾 Saved to Supabase:', data);
    }
    res.json({ status: "ok" });
  } catch (err) {
    console.error("❌ Gateway error:", err);
    res.status(500).json({ error: "Server Error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});