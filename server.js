// ==========================================
// FARM IOT SERVER - COMPLETE WORKING VERSION
// ==========================================

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const app = express();

// ==========================================
// ENVIRONMENT VARIABLES
// ==========================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || '8X9kLp2mNv5qRt7wYz3bC6eFh1jM4oP8sU2vX6yZ9aB3cD5eF7gH1jK4mN6pQ8rS2t';

// Check required variables
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials!');
  process.exit(1);
}

// ==========================================
// SUPABASE CLIENT
// ==========================================
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Debug middleware
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  console.log('Body:', req.body);
  next();
});

// ==========================================
// AUTH MIDDLEWARE
// ==========================================
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const { data: user, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', decoded.user_id)
      .single();
    
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized - User not found' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

// ==========================================
// AUTH ROUTES
// ==========================================

// REGISTER NEW USER
app.post('/api/auth/register', async (req, res) => {
  console.log('📥 Registration request received');
  console.log('📦 Body:', req.body);
  
  try {
    const { email, password, name } = req.body;
    
    // Validate email
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        error: 'Invalid email format. Please use a valid email address (e.g., user@example.com)' 
      });
    }
    
    // Validate password
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    console.log(`🔍 Checking if user exists: ${email}`);
    const { data: existingUser } = await supabase
      .from('profiles')
      .select('email')
      .eq('email', email)
      .single();
    
    if (existingUser) {
      console.log('❌ User already exists');
      return res.status(400).json({ error: 'User already exists' });
    }
    
    console.log('📝 Creating user in Supabase Auth...');
    const { data: authUser, error: signUpError } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { full_name: name || email.split('@')[0] }
      }
    });
    
    if (signUpError) {
      console.error('❌ Signup error:', signUpError);
      return res.status(400).json({ error: signUpError.message });
    }
    
    if (!authUser.user) {
      console.error('❌ No user returned');
      return res.status(500).json({ error: 'Failed to create user' });
    }
    
    console.log(`✅ Auth user created: ${authUser.user.id}`);
    
    console.log('📝 Creating profile...');
    const { data: newProfile, error: createError } = await supabase
      .from('profiles')
      .insert({
        id: authUser.user.id,
        email: email,
        name: name || email.split('@')[0],
        last_login: new Date().toISOString()
      })
      .select()
      .single();
    
    if (createError) {
      console.error('❌ Profile create error:', createError);
      return res.status(500).json({ error: 'Failed to create user profile' });
    }
    
    console.log(`✅ Profile created: ${newProfile.id}`);
    
    const sessionToken = jwt.sign(
      { 
        user_id: newProfile.id,
        email: newProfile.email
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('✅ Registration successful');
    
    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: newProfile.id,
        email: newProfile.email,
        name: newProfile.name
      }
    });
    
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to register user'
    });
  }
});

// EMAIL/PASSWORD LOGIN
app.post('/api/auth/login', async (req, res) => {
  console.log('📥 Login request received');
  console.log('📦 Body:', req.body);
  
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    console.log(`🔍 Attempting login for: ${email}`);
    
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    });
    
    if (authError) {
      console.log('❌ Auth error:', authError.message);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    console.log(`✅ Auth successful: ${authData.user.id}`);
    
    let { data: user, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();
    
    if (!user) {
      console.log('📝 Creating profile...');
      const { data: newProfile, error: createError } = await supabase
        .from('profiles')
        .insert({
          id: authData.user.id,
          email: email,
          name: authData.user.user_metadata?.full_name || email.split('@')[0],
          last_login: new Date().toISOString()
        })
        .select()
        .single();
      
      if (createError) {
        console.error('❌ Profile create error:', createError);
        return res.status(500).json({ error: 'Failed to create user profile' });
      }
      user = newProfile;
    } else {
      await supabase
        .from('profiles')
        .update({ last_login: new Date().toISOString() })
        .eq('id', user.id);
    }
    
    const sessionToken = jwt.sign(
      { 
        user_id: user.id,
        email: user.email
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('✅ Login successful');
    
    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// VERIFY TOKEN
app.get('/api/auth/verify', authenticate, async (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// LOGOUT
app.post('/api/auth/logout', authenticate, async (req, res) => {
  try {
    await supabase.auth.signOut();
    res.json({ success: true, message: 'Logged out' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: HUBS
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

// Delete hub
app.delete('/api/hubs/:hubId', authenticate, async (req, res) => {
  const { hubId } = req.params;
  
  try {
    const { error } = await supabase
      .from('hubs')
      .delete()
      .eq('hub_id', hubId)
      .eq('user_id', req.user.id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
        ssid: ssid,
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
      
      return res.json({ success: true, hub_id: hub_id });
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
          hub_id: hub_id,
          user_id: null,
          name: device_name || hub_id,
          status: status || 'discovering',
          ip_address: ip_address || null,
          last_seen: new Date().toISOString()
        });
      
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
    
    res.json({ success: true, hub_id: hub_id });
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
      .eq('hub_id', hubId);
    
    if (hub.ip_address) {
      try {
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
  console.log(`📡 Server URL: ${process.env.SERVER_URL || 'https://farm-iot.onrender.com'}`);
});