// ==========================================
// FARM IOT SERVER
// Secure Auth - Using Profiles Table
// ==========================================

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

const app = express();

// ==========================================
// ENVIRONMENT VARIABLES
// ==========================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET || '8X9kLp2mNv5qRt7wYz3bC6eFh1jM4oP8sU2vX6yZ9aB3cD5eF7gH1jK4mN6pQ8rS2t';

// Check required variables
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials!');
  process.exit(1);
}

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.warn('⚠️ Google OAuth credentials missing. Google SSO will not work.');
}

// ==========================================
// SUPABASE CLIENT
// ==========================================
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ==========================================
// GOOGLE OAuth CLIENT
// ==========================================
const googleClient = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  'postmessage'  // Important for Google One Tap
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

// Google SSO - Using Google One Tap
app.post('/api/auth/google', async (req, res) => {
  console.log('📥 Google auth request received');
  
  const { id_token } = req.body;
  
  if (!id_token) {
    console.log('❌ No id_token provided');
    return res.status(400).json({ error: 'id_token required' });
  }
  
  try {
    console.log('🔍 Verifying Google token...');
    
    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const { sub: google_id, email, name, picture } = payload;
    
    console.log(`👤 Google user: ${email} (${google_id})`);
    
    // Check if user exists in profiles by google_id
    let { data: existingUser, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('google_id', google_id)
      .single();
    
    // If not found by google_id, check by email
    if (!existingUser) {
      console.log('🔍 Checking by email...');
      const { data: userByEmail, error: emailError } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', email)
        .single();
      
      if (!emailError && userByEmail) {
        console.log('📝 Linking Google account to existing email');
        const { data: updatedUser, error: updateError } = await supabase
          .from('profiles')
          .update({
            google_id: google_id,
            picture: picture || userByEmail.picture,
            last_login: new Date().toISOString()
          })
          .eq('id', userByEmail.id)
          .select()
          .single();
        
        if (!updateError) {
          existingUser = updatedUser;
        }
      }
    }
    
    let user;
    
    if (!existingUser) {
      console.log('📝 Creating new user from Google');
      
      // Check if user exists in auth.users
      const { data: authUsers, error: authError } = await supabase
        .from('auth.users')
        .select('id')
        .eq('email', email)
        .single();
      
      let userId;
      
      if (authError || !authUsers) {
        // User doesn't exist in auth - create them via admin
        try {
          const { data: newAuthUser, error: createAuthError } = await supabase.auth.admin.createUser({
            email: email,
            email_confirm: true,
            user_metadata: { full_name: name || email.split('@')[0] }
          });
          
          if (createAuthError) {
            console.error('❌ Auth create error:', createAuthError);
            throw createAuthError;
          }
          userId = newAuthUser.user.id;
        } catch (adminError) {
          // If admin create fails, try regular signup
          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: email,
            password: Math.random().toString(36).slice(-12),
            options: {
              data: { full_name: name || email.split('@')[0] }
            }
          });
          
          if (signUpError) throw signUpError;
          userId = signUpData.user.id;
        }
      } else {
        userId = authUsers.id;
      }
      
      // Create profile
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
        console.error('❌ Profile create error:', createError);
        throw createError;
      }
      
      user = newUser;
      console.log(`✅ New profile created: ${user.id} - ${user.email}`);
    } else {
      console.log(`✅ Existing user logged in: ${existingUser.id} - ${existingUser.email}`);
      
      const { data: updatedUser, error: updateError } = await supabase
        .from('profiles')
        .update({
          name: name || existingUser.name,
          picture: picture || existingUser.picture,
          last_login: new Date().toISOString()
        })
        .eq('id', existingUser.id)
        .select()
        .single();
      
      if (!updateError) {
        user = updatedUser;
      } else {
        user = existingUser;
      }
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
    
    console.log('✅ Auth successful');
    
    res.json({
      success: true,
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture
      },
      is_new_user: !existingUser
    });
    
  } catch (error) {
    console.error('❌ Google auth error:', error);
    console.error('Error details:', error.message);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to authenticate with Google'
    });
  }
});

// Email/Password Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    });
    
    if (authError) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    let { data: user, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();
    
    if (!user) {
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
      
      if (createError) throw createError;
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
    const { data: authUser, error: signUpError } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { full_name: name || email.split('@')[0] }
      }
    });
    
    if (signUpError) throw signUpError;
    
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
    
    if (createError) throw createError;
    
    const sessionToken = jwt.sign(
      { 
        user_id: newProfile.id,
        email: newProfile.email
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
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
  console.log(`🅶 Google SSO: ${GOOGLE_CLIENT_ID ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`📊 Using 'profiles' table for user data`);
});