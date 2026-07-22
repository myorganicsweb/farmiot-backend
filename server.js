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
// API: HUBS (GET all hubs for user)
// ==========================================

// GET /api/hubs - Get all hubs for the authenticated user
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

// GET /api/hubs/:hubId - Get single hub
app.get('/api/hubs/:hubId', authenticate, async (req, res) => {
  const { hubId } = req.params;
  
  try {
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('hub_id', hubId)
      .eq('user_id', req.user.id)
      .single();
    
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Hub not found' });
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/hubs/:hubId - Remove hub from user's account
app.delete('/api/hubs/:hubId', authenticate, async (req, res) => {
  const { hubId } = req.params;
  
  try {
    // Check if hub belongs to user
    const { data: hub, error: checkError } = await supabase
      .from('hubs')
      .select('user_id')
      .eq('hub_id', hubId)
      .single();
    
    if (checkError || !hub) {
      return res.status(404).json({ error: 'Hub not found' });
    }
    
    if (hub.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this hub' });
    }
    
    // Delete hub (cascades to configs and devices)
    const { error } = await supabase
      .from('hubs')
      .delete()
      .eq('hub_id', hubId);
    
    if (error) throw error;
    res.json({ success: true, message: 'Hub removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: HUB CONFIG
// ==========================================

// GET /api/hubs/:hubId/config - Get hub config
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
      .select('ip_address, status')
      .eq('hub_id', hubId)
      .single();
    
    res.json({
      ...data,
      ip_address: hub?.ip_address || null,
      status: hub?.status || 'offline'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/hubs/:hubId/config - Set hub config (push to ESP32)
app.post('/api/hubs/:hubId/config', authenticate, async (req, res) => {
  const { hubId } = req.params;
  const { ssid, password, mqtt_server, mqtt_port, device_name } = req.body;
  
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
        device_name: device_name || hubId,
        updated_at: new Date().toISOString()
      })
      .eq('hub_id', hubId);
    
    if (updateError) throw updateError;
    
    // 2. UPDATE HUB NAME
    await supabase
      .from('hubs')
      .update({
        name: device_name || hubId,
        status: 'configuring',
        last_seen: new Date().toISOString()
      })
      .eq('hub_id', hubId);
    
    // 3. GET HUB IP ADDRESS
    const { data: hub, error: hubError } = await supabase
      .from('hubs')
      .select('ip_address, status')
      .eq('hub_id', hubId)
      .single();
    
    if (hubError) throw hubError;
    
    // 4. PUSH TO ESP32 (if online)
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
// API: HUB REGISTRATION (called by ESP32)
// ==========================================

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
      // Hub already belongs to someone - just update status
      await supabase
        .from('hubs')
        .update({
          status: status || 'online',
          ip_address: ip_address || null,
          last_seen: new Date().toISOString()
        })
        .eq('hub_id', hub_id);
      
      return res.json({ 
        success: true, 
        hub_id: hub_id,
        message: 'Hub status updated'
      });
    }
    
    if (existing) {
      // Hub exists but no user - assign to current user if authenticated
      const userId = req.user?.id || null;
      await supabase
        .from('hubs')
        .update({
          user_id: userId,
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
// API: DISCOVERY
// ==========================================

// GET /api/discover - Get hubs in discovery mode
app.get('/api/discover', authenticate, async (req, res) => {
  try {
    // Get hubs that are either:
    // - In discovery mode
    // - Not assigned to any user
    // - Offline but recently seen
    const cutoffTime = new Date(Date.now() - 120000).toISOString();
    
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .or(`status.eq.discovering,status.eq.offline,user_id.is.null`)
      .gte('last_seen', cutoffTime)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Filter out hubs already owned by this user
    const filtered = (data || []).filter(h => h.user_id !== req.user.id);
    
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/discover/public - Public discovery (no auth needed for ESP32)
app.get('/api/discover/public', async (req, res) => {
  try {
    const cutoffTime = new Date(Date.now() - 120000).toISOString();
    
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .or(`status.eq.discovering,status.eq.offline,user_id.is.null`)
      .gte('last_seen', cutoffTime)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/hubs/:hubId/reboot - Reboot hub
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
        console.log('Hub reboot sent (or offline)');
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Reboot command sent'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: DEVICES (Sensors)
// ==========================================

// POST /api/devices/register - Register a sensor (called by ESP32)
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

// GET /api/hubs/:hubId/devices - Get devices for a hub
app.get('/api/hubs/:hubId/devices', authenticate, async (req, res) => {
  const { hubId } = req.params;
  
  try {
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('hub_id', hubId);
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/soil - Add soil reading
app.post('/api/soil', async (req, res) => {
  const { device_id, value } = req.body;
  
  if (!device_id || value === undefined) {
    return res.status(400).json({ error: 'device_id and value required' });
  }
  
  try {
    await supabase
      .from('soil_readings')
      .insert({
        device_id: device_id,
        value: parseInt(value),
        timestamp: new Date().toISOString()
      });
    
    // Update device's latest soil reading
    await supabase
      .from('devices')
      .update({ latest_soil: parseInt(value), last_seen: new Date().toISOString() })
      .eq('device_id', device_id);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/soil/latest - Get latest soil reading
app.get('/api/soil/latest', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('soil_readings')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(1);
    
    if (error) throw error;
    res.json(data?.[0] || {});
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
  console.log(`🗄️  Supabase: ${supabaseUrl}`);
});