// ==========================================
// FARM IOT SERVER
// ESP32 ONLY TALKS TO THIS SERVER
// Server handles all Supabase communication
// ==========================================

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();

// ==========================================
// SUPABASE CONFIG - FROM ENVIRONMENT VARIABLES
// ==========================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

// Check if credentials are set
if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials!');
  console.error('   Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// AUTH MIDDLEWARE
// ==========================================
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

// ==========================================
// API: HUB CONFIG
// ==========================================

// Get hub config (ESP32 pulls from here)
app.get('/api/hubs/:hubId/config', authenticate, async (req, res) => {
  const { hubId } = req.params;
  
  try {
    const { data, error } = await supabase
      .from('hub_configs')
      .select('*')
      .eq('hub_id', hubId)
      .single();
    
    if (error) throw error;
    
    const { data: hub } = await supabase
      .from('hubs')
      .select('ip_address')
      .eq('hub_id', hubId)
      .single();
    
    res.json({
      ...data,
      ip_address: hub?.ip_address || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set hub config (UI calls this, server pushes to ESP32)
app.post('/api/hubs/:hubId/config', authenticate, async (req, res) => {
  const { hubId } = req.params;
  const { ssid, password, mqtt_server, mqtt_port } = req.body;
  
  if (!ssid) {
    return res.status(400).json({ error: 'SSID is required' });
  }
  
  try {
    // 1. SAVE TO SUPABASE
    const { error: updateError } = await supabase
      .from('hub_configs')
      .update({
        ssid: ssid,
        password: password || '',
        mqtt_server: mqtt_server || 'broker.hivemq.com',
        mqtt_port: mqtt_port || 1883,
        updated_at: new Date().toISOString()
      })
      .eq('hub_id', hubId);
    
    if (updateError) throw updateError;
    
    // 2. GET HUB IP ADDRESS
    const { data: hub, error: hubError } = await supabase
      .from('hubs')
      .select('ip_address, status')
      .eq('hub_id', hubId)
      .single();
    
    if (hubError) throw hubError;
    
    // 3. PUSH TO ESP32 (if online)
    let esp32Response = null;
    if (hub.ip_address && hub.status === 'online') {
      try {
        const response = await axios.post(
          `http://${hub.ip_address}/api/config`,
          new URLSearchParams({
            ssid: ssid,
            password: password || '',
            mqtt: mqtt_server || 'broker.hivemq.com',
            port: String(mqtt_port || 1883)
          }),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 5000
          }
        );
        esp32Response = response.data;
      } catch (error) {
        console.log('⚠️ ESP32 not reachable, config saved in Supabase');
        esp32Response = { error: 'ESP32 not reachable, config will be pulled later' };
      }
    } else {
      esp32Response = { message: 'ESP32 offline, config saved in Supabase' };
    }
    
    res.json({
      success: true,
      saved_to_supabase: true,
      pushed_to_esp32: esp32Response,
      message: 'Config saved. ESP32 will receive it when online.'
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: HUB REGISTRATION
// ==========================================

// Register hub (called by ESP32)
app.post('/api/hubs/register', async (req, res) => {
  const { hub_id, ip_address, mac_address, status } = req.body;
  
  if (!hub_id) {
    return res.status(400).json({ error: 'hub_id required' });
  }
  
  try {
    const { data: existing } = await supabase
      .from('hubs')
      .select('hub_id')
      .eq('hub_id', hub_id)
      .single();
    
    if (!existing) {
      // Hub not found - create it
      const { error: insertError } = await supabase
        .from('hubs')
        .insert({
          hub_id: hub_id,
          name: hub_id,
          status: status || 'online',
          ip_address: ip_address || null,
          last_seen: new Date().toISOString()
        });
      
      if (insertError) throw insertError;
      
      await supabase
        .from('hub_configs')
        .insert({
          hub_id: hub_id,
          ssid: '',
          password: '',
          mqtt_server: 'broker.hivemq.com',
          mqtt_port: 1883
        });
    } else {
      // Update existing hub
      await supabase
        .from('hubs')
        .update({
          status: status || 'online',
          ip_address: ip_address || null,
          last_seen: new Date().toISOString()
        })
        .eq('hub_id', hub_id);
    }
    
    res.json({ success: true, hub_id: hub_id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: DEVICE REGISTRATION
// ==========================================

// Register device (called by ESP32 when it discovers a sensor)
app.post('/api/devices/register', async (req, res) => {
  const { hub_id, device_id } = req.body;
  
  if (!hub_id || !device_id) {
    return res.status(400).json({ error: 'hub_id and device_id required' });
  }
  
  try {
    await supabase
      .from('devices')
      .upsert({
        hub_id: hub_id,
        device_id: device_id,
        name: device_id,
        status: 'online',
        last_seen: new Date().toISOString()
      }, { onConflict: 'hub_id, device_id' });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: DISCOVER HUBS
// ==========================================

// Get hubs in discovery mode
app.get('/api/discover', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('status', 'discovering')
      .gte('last_seen', new Date(Date.now() - 120000).toISOString());
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reboot hub (puts it into discovery mode)
app.post('/api/hubs/:hubId/reboot', authenticate, async (req, res) => {
  const { hubId } = req.params;
  
  try {
    const { data: hub, error: hubError } = await supabase
      .from('hubs')
      .select('ip_address')
      .eq('hub_id', hubId)
      .eq('user_id', req.user.id)
      .single();
    
    if (hubError || !hub) {
      return res.status(404).json({ error: 'Hub not found' });
    }
    
    await supabase
      .from('hubs')
      .update({ 
        status: 'discovering',
        last_seen: new Date().toISOString()
      })
      .eq('hub_id', hubId);
    
    if (hub.ip_address) {
      try {
        await axios.post(`http://${hub.ip_address}/api/reboot`);
      } catch (error) {
        console.log('Hub reboot command sent (or hub offline)');
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Reboot command sent. Hub will enter discovery mode.',
      hub_id: hubId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: GET HUBS FOR USER
// ==========================================

app.get('/api/hubs', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SERVE DASHBOARD
// ==========================================
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/dashboard.html');
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 443;
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
  console.log(`📡 ESP32 connects to: ${process.env.SERVER_URL || 'https://farm-iot.onrender.com'}`);
  console.log(`🗄️  Supabase: ${supabaseUrl}`);
});