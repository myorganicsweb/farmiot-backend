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
// GOOGLE SSO - FIXED (Uses email as ID)
// ==========================================
app.post('/api/auth/google', async (req, res) => {
  console.log('========================================');
  console.log('📥 GOOGLE SSO REQUEST');
  
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
    
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const { sub: google_id, email, name, picture } = payload;
    
    console.log(`👤 Google user: ${email} (${google_id})`);
    
    // ==========================================
    // FIX: Use email as the primary key
    // ==========================================
    
    // Check if user exists in profiles by google_id or email
    let { data: existingUser } = await supabase
      .from('profiles')
      .select('*')
      .eq('google_id', google_id)
      .single();
    
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
            picture: picture || userByEmail.picture,
            last_login: new Date().toISOString()
          })
          .eq('email', email)
          .select()
          .single();
        existingUser = updated;
      }
    }
    
    let user;
    
    if (existingUser) {
      console.log(`✅ User found in profiles: ${existingUser.email}`);
      user = existingUser;
    } else {
      console.log('📝 Creating new user...');
      
      // Use email as the ID (since it's unique)
      const userId = email;
      console.log(`📝 Using email as ID: ${userId}`);
      
      const { data: newUser, error: createError } = await supabase
        .from('profiles')
        .insert({
          id: userId,  // Using email as ID
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
        
        // If profile already exists, fetch it
        if (createError.message.includes('duplicate key')) {
          const { data: existing } = await supabase
            .from('profiles')
            .select('*')
            .eq('email', email)
            .single();
          
          if (existing) {
            user = existing;
            console.log('✅ Found existing profile');
          } else {
            return res.status(500).json({ 
              success: false, 
              error: 'Failed to create or find profile' 
            });
          }
        } else {
          return res.status(500).json({ 
            success: false, 
            error: 'Failed to create profile: ' + createError.message 
          });
        }
      } else {
        user = newUser;
        console.log(`✅ Profile created: ${user.id}`);
      }
    }
    
    if (!user) {
      console.log('❌ No user available');
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to get or create user' 
      });
    }
    
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
// REGISTER (Email/Password)
// ==========================================
app.post('/api/auth/register', async (req, res) => {
  console.log('📥 Register request');
  
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }
    
    const { data: existing } = await supabase
      .from('profiles')
      .select('email')
      .eq('email', email)
      .single();
    
    if (existing) {
      return res.status(400).json({ success: false, error: 'User already exists' });
    }
    
    const { data: authUser, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name || email.split('@')[0] } }
    });
    
    if (signUpError) {
      return res.status(400).json({ success: false, error: signUpError.message });
    }
    
    const { data: profile } = await supabase
      .from('profiles')
      .insert({
        id: email,
        email: email,
        name: name || email.split('@')[0],
        last_login: new Date().toISOString()
      })
      .select()
      .single();
    
    const token = jwt.sign(
      { user_id: profile.id, email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token,
      user: { id: profile.id, email, name: profile.name }
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// LOGIN (Email/Password)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  console.log('📥 Login request');
  
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }
    
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (authError) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    let { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', email)
      .single();
    
    if (!profile) {
      const { data: newProfile } = await supabase
        .from('profiles')
        .insert({
          id: email,
          email: email,
          name: authData.user.user_metadata?.full_name || email.split('@')[0],
          last_login: new Date().toISOString()
        })
        .select()
        .single();
      profile = newProfile;
    }
    
    const token = jwt.sign(
      { user_id: profile.id, email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token,
      user: { id: profile.id, email, name: profile.name }
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ success: false, error: error.message });
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