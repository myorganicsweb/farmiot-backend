// ==========================================
// FARM IOT SERVER
// Secure Auth - All Supabase keys on server only
// ==========================================

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

const app = express();

// ==========================================
// ENVIRONMENT VARIABLES CHECK
// ==========================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET || '8X9kLp2mNv5qRt7wYz3bC6eFh1jM4oP8sU2vX6yZ9aB3cD5eF7gH1jK4mN6pQ8rS2t';

// Check if required variables are set
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials!');
  console.error('   Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
  process.exit(1);
}

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.warn('⚠️ Google OAuth credentials missing. Google SSO will not work.');
}

if (!process.env.JWT_SECRET) {
  console.warn('⚠️ JWT_SECRET not set. Using default (not secure for production!)');
}

// ==========================================
// SUPABASE CLIENT (SERVER ONLY)
// ==========================================
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ==========================================
// GOOGLE OAuth CLIENT (SERVER ONLY)
// ==========================================
const googleClient = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET
);

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// AUTH MIDDLEWARE
// ==========================================
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }
  
  try {
    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Get user from Supabase
    const { data: user, error } = await supabase
      .from('users')
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

// Google SSO
app.post('/api/auth/google', async (req, res) => {
  const { id_token } = req.body;
  
  if (!id_token) {
    return res.status(400).json({ error: 'id_token required' });
  }
  
  try {
    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const { sub: google_id, email, name, picture } = payload;
    
    // Check if user exists
    let { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', google_id)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }
    
    let user;
    
    if (!existingUser) {
      // Create new user
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          google_id: google_id,
          email: email,
          name: name || email.split('@')[0],
          picture: picture || null
        })
        .select()
        .single();
      
      if (createError) throw createError;
      user = newUser;
    } else {
      // Update existing user
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({
          name: name || existingUser.name,
          picture: picture || existingUser.picture,
          last_login: new Date().toISOString()
        })
        .eq('google_id', google_id)
        .select()
        .single();
      
      if (updateError) throw updateError;
      user = updatedUser;
    }
    
    // Create JWT session token
    const sessionToken = jwt.sign(
      { 
        user_id: user.id,
        email: user.email,
        google_id: user.google_id
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture
      }
    });
    
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Email/Password Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    // Check if user exists
    let { data: user, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();
    
    // Try Supabase auth
    if (!user) {
      const { data: authUser, error: authError } = await supabase.auth.signInWithPassword({
        email: email,
        password: password
      });
      
      if (authError) {
        if (authError.message.includes('Invalid login credentials')) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        throw authError;
      }
      
      // Create user in our table
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          google_id: null,
          email: email,
          name: authUser.user.user_metadata?.full_name || email.split('@')[0],
          password_hash: 'managed_by_supabase'
        })
        .select()
        .single();
      
      if (createError) throw createError;
      user = newUser;
    }
    
    // Create JWT session token
    const sessionToken = jwt.sign(
      { 
        user_id: user.id,
        email: user.email
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
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
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Register new user
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  try {
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .single();
    
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Create user in Supabase Auth
    const { data: authUser, error: signUpError } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { full_name: name || email.split('@')[0] }
      }
    });
    
    if (signUpError) throw signUpError;
    
    // Create user in our table
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        google_id: null,
        email: email,
        name: name || email.split('@')[0],
        password_hash: 'managed_by_supabase'
      })
      .select()
      .single();
    
    if (createError) throw createError;
    
    // Create JWT session token
    const sessionToken = jwt.sign(
      { 
        user_id: newUser.id,
        email: newUser.email
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name
      }
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify token
app.get('/api/auth/verify', authenticate, async (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// Logout
app.post('/api/auth/logout', authenticate, async (req, res) => {
  try {
    await supabase.auth.signOut();
    res.json({ success: true, message: 'Logged out' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: HUBS (Protected)
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
    
    // Get hub IP to push config
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
  console.log(`🔐 JWT Secret: ${process.env.JWT_SECRET ? '✅ Set' : '⚠️ Using default'}`);
});