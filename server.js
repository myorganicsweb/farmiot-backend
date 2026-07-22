const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 443;

// ==========================================
// SUPABASE
// ==========================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ==========================================
// MIDDLEWARE - FIXED FOR RENDER
// ==========================================
app.use(cors());

// IMPORTANT: Use raw body parser for Render
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Debug middleware
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  console.log('Body:', req.body);
  console.log('Raw:', req.rawBody);
  next();
});

// ==========================================
// AUTH MIDDLEWARE
// ==========================================
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const { data: user } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', decoded.user_id)
      .single();
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ==========================================
// REGISTER - WITH RAW BODY FALLBACK
// ==========================================
app.post('/api/auth/register', async (req, res) => {
  console.log('📥 Register request received');
  
  // Try to get body from multiple sources
  let email, password;
  
  // 1. Try req.body (parsed JSON)
  if (req.body && typeof req.body === 'object') {
    email = req.body.email;
    password = req.body.password;
  }
  
  // 2. If empty, try raw body
  if (!email && req.rawBody) {
    try {
      const parsed = JSON.parse(req.rawBody);
      email = parsed.email;
      password = parsed.password;
    } catch (e) {
      console.log('Raw parse failed');
    }
  }
  
  // 3. If still empty, try query string
  if (!email && req.query) {
    email = req.query.email;
    password = req.query.password;
  }
  
  console.log('Email:', email);
  console.log('Password length:', password ? password.length : 0);
  
  if (!email || !password) {
    return res.status(400).json({ 
      error: 'Email and password required',
      received: { email: !!email, password: !!password }
    });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  try {
    // Check if user exists
    const { data: existing } = await supabase
      .from('profiles')
      .select('email')
      .eq('email', email)
      .single();
    
    if (existing) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Create in Supabase Auth
    const { data: authUser, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: email.split('@')[0] } }
    });
    
    if (signUpError) {
      return res.status(400).json({ error: signUpError.message });
    }
    
    // Create profile
    const { data: profile } = await supabase
      .from('profiles')
      .insert({
        id: authUser.user.id,
        email,
        name: email.split('@')[0],
        last_login: new Date().toISOString()
      })
      .select()
      .single();
    
    // Create JWT
    const token = jwt.sign(
      { user_id: profile.id, email },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token,
      user: { id: profile.id, email, name: profile.name }
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// LOGIN
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  console.log('📥 Login request received');
  
  let email, password;
  
  if (req.body && typeof req.body === 'object') {
    email = req.body.email;
    password = req.body.password;
  }
  
  if (!email && req.rawBody) {
    try {
      const parsed = JSON.parse(req.rawBody);
      email = parsed.email;
      password = parsed.password;
    } catch (e) {}
  }
  
  console.log('Email:', email);
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (authError) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    let { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();
    
    if (!profile) {
      const { data: newProfile } = await supabase
        .from('profiles')
        .insert({
          id: authData.user.id,
          email,
          name: authData.user.user_metadata?.full_name || email.split('@')[0],
          last_login: new Date().toISOString()
        })
        .select()
        .single();
      profile = newProfile;
    }
    
    const token = jwt.sign(
      { user_id: profile.id, email },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token,
      user: { id: profile.id, email, name: profile.name }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// VERIFY
// ==========================================
app.get('/api/auth/verify', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ==========================================
// LOGOUT
// ==========================================
app.post('/api/auth/logout', authenticate, async (req, res) => {
  await supabase.auth.signOut();
  res.json({ success: true });
});

// ==========================================
// HUB API (ALL ENDPOINTS)
// ==========================================

// Get all hubs for user
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

// Get single hub
app.get('/api/hubs/:hubId', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('hub_id', req.params.hubId)
      .eq('user_id', req.user.id)
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete hub
app.delete('/api/hubs/:hubId', authenticate, async (req, res) => {
  try {
    await supabase
      .from('hubs')
      .delete()
      .eq('hub_id', req.params.hubId)
      .eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get hub config
app.get('/api/hubs/:hubId/config', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('hub_configs')
      .select('*')
      .eq('hub_id', req.params.hubId)
      .single();
    
    if (error) throw error;
    
    const { data: hub } = await supabase
      .from('hubs')
      .select('ip_address, status')
      .eq('hub_id', req.params.hubId)
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

// Set hub config
app.post('/api/hubs/:hubId/config', authenticate, async (req, res) => {
  const { hubId } = req.params;
  const { ssid, password, mqtt_server, mqtt_port, device_name } = req.body;
  
  if (!ssid) {
    return res.status(400).json({ error: 'SSID is required' });
  }
  
  try {
    await supabase
      .from('hub_configs')
      .update({
        ssid,
        password: password || '',
        mqtt_server: mqtt_server || 'broker.hivemq.com',
        mqtt_port: mqtt_port || 1883,
        device_name: device_name || hubId,
        updated_at: new Date().toISOString()
      })
      .eq('hub_id', hubId);
    
    await supabase
      .from('hubs')
      .update({
        name: device_name || hubId,
        status: 'configuring',
        last_seen: new Date().toISOString()
      })
      .eq('hub_id', hubId);
    
    const { data: hub } = await supabase
      .from('hubs')
      .select('ip_address, status')
      .eq('hub_id', hubId)
      .single();
    
    let esp32Response = null;
    if (hub?.ip_address && hub?.status === 'online') {
      try {
        const axios = require('axios');
        const response = await axios.post(
          `http://${hub.ip_address}/api/config`,
          new URLSearchParams({
            ssid,
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

// Register hub (called by ESP32)
app.post('/api/hubs/register', async (req, res) => {
  const { hub_id, ip_address, mac_address, status, device_name } = req.body;
  
  if (!hub_id) {
    return res.status(400).json({ error: 'hub_id required' });
  }
  
  try {
    const { data: existing } = await supabase
      .from('hubs')
      .select('hub_id, user_id')
      .eq('hub_id', hub_id)
      .single();
    
    if (existing && existing.user_id) {
      await supabase
        .from('hubs')
        .update({
          status: status || 'online',
          ip_address: ip_address || null,
          last_seen: new Date().toISOString()
        })
        .eq('hub_id', hub_id);
      
      return res.json({ success: true, hub_id });
    }
    
    if (existing) {
      await supabase
        .from('hubs')
        .update({
          user_id: null,
          status: status || 'online',
          ip_address: ip_address || null,
          name: device_name || hub_id,
          last_seen: new Date().toISOString()
        })
        .eq('hub_id', hub_id);
    } else {
      await supabase
        .from('hubs')
        .insert({
          hub_id,
          user_id: null,
          name: device_name || hub_id,
          status: status || 'discovering',
          ip_address: ip_address || null,
          last_seen: new Date().toISOString()
        });
      
      await supabase
        .from('hub_configs')
        .insert({
          hub_id,
          ssid: '',
          password: '',
          mqtt_server: 'broker.hivemq.com',
          mqtt_port: 1883,
          device_name: device_name || hub_id
        });
    }
    
    res.json({ success: true, hub_id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reboot hub
app.post('/api/hubs/:hubId/reboot', authenticate, async (req, res) => {
  try {
    const { data: hub } = await supabase
      .from('hubs')
      .select('ip_address')
      .eq('hub_id', req.params.hubId)
      .eq('user_id', req.user.id)
      .single();
    
    if (!hub) {
      return res.status(404).json({ error: 'Hub not found' });
    }
    
    await supabase
      .from('hubs')
      .update({ 
        status: 'discovering',
        last_seen: new Date().toISOString()
      })
      .eq('hub_id', req.params.hubId);
    
    if (hub.ip_address) {
      try {
        const axios = require('axios');
        await axios.post(`http://${hub.ip_address}/api/reboot`);
      } catch (error) {}
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Discovery - get hubs in discovery mode
app.get('/api/discover', authenticate, async (req, res) => {
  try {
    const cutoffTime = new Date(Date.now() - 120000).toISOString();
    
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .or(`status.eq.discovering,status.eq.offline,user_id.is.null`)
      .gte('last_seen', cutoffTime)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    const filtered = (data || []).filter(h => h.user_id !== req.user.id);
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// DEVICE (SENSOR) API
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
        hub_id,
        device_id,
        name: device_id,
        status: 'online',
        last_seen: new Date().toISOString()
      }, { onConflict: 'hub_id, device_id' });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get devices for a hub
app.get('/api/hubs/:hubId/devices', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('hub_id', req.params.hubId);
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SOIL READINGS API
// ==========================================

// Add soil reading
app.post('/api/soil', async (req, res) => {
  const { device_id, value } = req.body;
  
  if (!device_id || value === undefined) {
    return res.status(400).json({ error: 'device_id and value required' });
  }
  
  try {
    await supabase
      .from('soil_readings')
      .insert({
        device_id,
        value: parseInt(value),
        timestamp: new Date().toISOString()
      });
    
    await supabase
      .from('devices')
      .update({ latest_soil: parseInt(value), last_seen: new Date().toISOString() })
      .eq('device_id', device_id);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get latest soil reading
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
// START
// ==========================================
app.listen(PORT, () => {
  console.log(`✅ FarmIOT Server running on port ${PORT}`);
});