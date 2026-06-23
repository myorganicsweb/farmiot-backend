// ==========================================
// FARMIOT BACKEND
// ==========================================

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Supabase Credentials (Your exact ones)
const supabaseUrl = 'https://adxaifphothopomwutcg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkeGFpZnBob3Rob3BvbXd1dGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxOTM4NTEsImV4cCI6MjA5Nzc2OTg1MX0.uMbkFZP4kPnjJamcaVwgMhcgDbJkkDg1JYbz0HVDfYk';

const supabase = createClient(supabaseUrl, supabaseKey);

// 1. Receive data from ESP32 Hub
app.post('/api/sensor', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sensor_data')
      .insert([
        { 
          farmer_id: req.body.farmer_id,
          device_id: req.body.device_id,
          payload: req.body
        }
      ]);
    
    if (error) throw error;
    res.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Supabase Error" });
  }
});

// 2. Dashboard fetches data
app.get('/api/dashboard/:farmerId', async (req, res) => {
  const { data, error } = await supabase
    .from('sensor_data')
    .select('id, payload, created_at')
    .eq('farmer_id', req.params.farmerId)
    .order('created_at', { ascending: false })
    .limit(50);
  
  if (error) return res.status(500).json(error);
  res.json(data);
});

// 3. Health Check
app.get('/', (req, res) => {
  res.send('🌱 FarmIOT Cloud is LIVE!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Backend running on port ${PORT}`);
});