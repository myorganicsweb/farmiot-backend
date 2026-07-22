// ==========================================
// FARM IOT SERVER
// Supports mDNS discovery from ESP32
// ==========================================

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();

// ==========================================
// SUPABASE CONFIG
// ==========================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials!');
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
// API: DISCOVERY
// ==========================================

// Get hubs in discovery mode (mDNS)
app.get('/api/discover', authenticate, async (req, res) => {
  try {
    // First, check Supabase for hubs that are registered but maybe offline
    const { data: hubs, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Also check for hubs in discovery mode (AP mode)
    const { data: discovering } = await supabase
      .from('hubs')
      .select('*')
      .eq('status', 'discovering')
      .gte('last_seen', new Date(Date.now() - 120000).toISOString());
    
    // Combine and deduplicate
    const allHubs = [...(hubs || []), ...(discovering || [])];
    const unique = Array.from(new Map(allHubs.map(h => [h.hub_id, h])).values());
    
    res.json(unique);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Register a discovered hub (from mDNS)
app.post('/api/hubs/register', async (req, res) => {
  const { hub_id, ip_address, mac_address, status, device_name } = req.body;
  
  if (!hub_id) {
    return res.status(400).json({ error: 'hub_id required' });
  }
  
  try {
    // Check if hub exists
    const { data: existing } = await supabase
      .from('hubs')
      .select('hub_id, user_id')
      .eq('hub_id', hub_id)
      .single();
    
    if (existing && existing.user_id) {
      // Hub already belongs to someone
      return res.status(403).json({ 
        error: 'Hub already registered to another user' 
      });
    }
    
    if (existing) {
      // Update existing hub
      await supabase
        .from('hubs')
        .update({
          user_id: req.user?.id || null,
          status: status || 'online',
          ip_address: ip_address || null,
          name: device_name || hub_id,
          last_seen: new Date().toISOString()
        })
        .eq('hub_id', hub_id);
    } else {
      // Create new hub
      await supabase
        .from('hubs')
        .insert({
          hub_id: hub_id,
          user_id: req.user?.id || null,
          name: device_name || hub_id,
          status: status || 'discovering',
          ip_address: ip_address || null,
          last_seen: new Date().toISOString()
        });
      
      // Create default config
      await supabase
        .from('hub_configs')
        .insert({
          hub_id: hub_id,
          ssid: '',
          password: '',
          mqtt_server: 'broker.hivemq.com',
          mqtt_port: 1883,
          device_name: device_name || hub_id
        });
    }
    
    res.json({ 
      success: true, 
      hub_id: hub_id,
      message: 'Hub registered successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: HUB CONFIG
// ==========================================

// Get hub config
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

// Set hub config (push to ESP32)
app.post('/api/hubs/:hubId/config', authenticate, async (req, res) => {
  const { hubId } = req.params;
  const { ssid, password, mqtt_server, mqtt_port } = req.body;
  
  if (!ssid) {
    return res.status(400).json({ error: 'SSID is required' });
  }
  
  try {
    // Save to Supabase
    await supabase
      .from('hub_configs')
      .update({
        ssid: ssid,
        password: password || '',
        mqtt_server: mqtt_server || 'broker.hivemq.com',
        mqtt_port: mqtt_port || 1883,
        updated_at: new Date().toISOString()
      })
      .eq('hub_id', hubId);
    
    // Get hub IP
    const { data: hub } = await supabase
      .from('hubs')
      .select('ip_address, status')
      .eq('hub_id', hubId)
      .single();
    
    // Try to push to ESP32
    let esp32Response = null;
    if (hub?.ip_address && hub?.status === 'online') {
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
        console.log('⚠️ ESP32 not reachable');
        esp32Response = { error: 'ESP32 not reachable' };
      }
    }
    
    res.json({
      success: true,
      saved_to_supabase: true,
      pushed_to_esp32: esp32Response
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reboot hub
app.post('/api/hubs/:hubId/reboot', authenticate, async (req, res) => {
  const { hubId } = req.params;
  
  try {
    const { data: hub } = await supabase
      .from('hubs')
      .select('ip_address')
      .eq('hub_id', hubId)
      .single();
    
    await supabase
      .from('hubs')
      .update({ 
        status: 'discovering',
        last_seen: new Date().toISOString()
      })
      .eq('hub_id', hubId);
    
    if (hub?.ip_address) {
      try {
        await axios.post(`http://${hub.ip_address}/api/reboot`);
      } catch (error) {
        console.log('Hub reboot sent (or offline)');
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: DEVICES
// ==========================================

// Register device (sensor)
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
  console.log(`📡 ESP32 connects to: https://farm-iot.onrender.com`);
});