const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 443;

console.log('🚀 SERVER STARTING...');

// ==========================================
// SUPABASE
// ==========================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
console.log('✅ Supabase connected');

// ==========================================
// GOOGLE CLIENT
// ==========================================
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
console.log('✅ Google client initialized');

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Log requests
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('📦 Body:', req.body);
  }
  next();
});

// ==========================================
// AUTH MIDDLEWARE
// ==========================================
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

// ==========================================
// GOOGLE SSO
// ==========================================
app.post('/api/auth/google', async (req, res) => {
  console.log('========================================');
  console.log('📥 GOOGLE SSO REQUEST');
  console.log('📦 Body:', req.body);
  
  try {
    const { id_token } = req.body;
    
    if (!id_token) {
      console.log('❌ No ID token provided');
      return res.status(400).json({ 
        success: false, 
        error: 'No ID token provided' 
      });
    }
    
    console.log('🔍 Verifying Google token...');
    
    // Verify the ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    console.log('📊 Token payload:', {
      email: payload.email,
      name: payload.name,
      sub: payload.sub
    });
    
    const { sub: google_id, email, name, picture } = payload;
    
    // Check if user exists by google_id
    console.log('🔍 Checking if user exists...');
    let { data: existingUser, error: findError } = await supabase
      .from('profiles')
      .select('*')
      .eq('google_id', google_id)
      .single();
    
    if (findError && findError.code !== 'PGRST116') {
      console.log('⚠️ Find error:', findError.message);
    }
    
    // If not found by google_id, check by email
    if (!existingUser) {
      console.log('🔍 Checking by email...');
      const { data: userByEmail } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', email)
        .single();
      
      if (userByEmail) {
        console.log('📝 Updating existing user with google_id...');
        const { data: updated } = await supabase
          .from('profiles')
          .update({ 
            google_id: google_id, 
            picture: picture || userByEmail.picture 
          })
          .eq('id', userByEmail.id)
          .select()
          .single();
        existingUser = updated;
      }
    }
    
    let user;
    
    if (!existingUser) {
      console.log('📝 Creating new user...');
      
      // Check if user exists in auth.users
      const { data: authUsers } = await supabase
        .from('auth.users')
        .select('id')
        .eq('email', email)
        .single();
      
      let userId;
      
      if (authUsers) {
        userId = authUsers.id;
        console.log('✅ User exists in auth:', userId);
      } else {
        console.log('📝 Creating user in auth...');
        const { data: newAuthUser, error: authError } = await supabase.auth.signUp({
          email: email,
          password: Math.random().toString(36).slice(-12),
          options: { 
            data: { 
              full_name: name || email.split('@')[0] 
            } 
          }
        });
        
        if (authError) {
          console.log('❌ Auth error:', authError.message);
          return res.status(400).json({ 
            success: false, 
            error: authError.message 
          });
        }
        userId = newAuthUser?.user?.id;
        console.log('✅ User created in auth:', userId);
      }
      
      if (!userId) {
        console.log('❌ No user ID');
        return res.status(500).json({ 
          success: false, 
          error: 'Failed to create user' 
        });
      }
      
      // Create profile
      console.log('📝 Creating profile...');
      const { data: newUser, error: createError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          google_id: google_id,
          email: email,
          name: name || email.split('@')[0],
          picture: picture || null,
          last_login: new Date().toISOString()
        })
        .select()
        .single();
      
      if (createError) {
        console.log('❌ Profile create error:', createError.message);
        return res.status(500).json({ 
          success: false, 
          error: 'Failed to create profile: ' + createError.message 
        });
      }
      
      user = newUser;
      console.log('✅ Profile created:', user.id);
    } else {
      console.log('📝 Updating existing user...');
      const { data: updated } = await supabase
        .from('profiles')
        .update({
          name: name || existingUser.name,
          picture: picture || existingUser.picture,
          last_login: new Date().toISOString()
        })
        .eq('id', existingUser.id)
        .select()
        .single();
      user = updated || existingUser;
      console.log('✅ User updated:', user.id);
    }
    
    // Create JWT
    console.log('📝 Creating JWT...');
    const token = jwt.sign(
      { user_id: user.id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    console.log('✅ Google SSO successful');
    console.log('========================================');
    
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture
      }
    });
    
  } catch (error) {
    console.error('❌ Google SSO error:', error);
    console.error('Stack:', error.stack);
    console.log('========================================');
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

// ==========================================
// VERIFY TOKEN
// ==========================================
app.get('/api/auth/verify', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const { data: user } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', decoded.user_id)
      .single();
    res.json({ success: true, user });
  } catch (error) {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

// ==========================================
// HUBS API
// ==========================================

// Get all hubs
app.get('/api/hubs', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('user_id', req.user.user_id)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
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
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Register hub (called by ESP32)
app.post('/api/hubs/register', async (req, res) => {
  const { hub_id, ip_address, status, device_name } = req.body;
  
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
      await supabase.from('hubs').insert({
        hub_id,
        name: device_name || hub_id,
        status: status || 'discovering',
        ip_address: ip_address || null,
        last_seen: new Date().toISOString()
      });
      
      await supabase.from('hub_configs').insert({
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

// Discover hubs
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
    
    const filtered = (data || []).filter(h => h.user_id !== req.user.user_id);
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SOIL API
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

// Get latest soil
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Google SSO: POST /api/auth/google`);
  console.log(`✅ Hubs: GET /api/hubs`);
  console.log(`✅ Soil: GET /api/soil/latest`);
});