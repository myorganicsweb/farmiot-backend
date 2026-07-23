const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

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
console.log('✅ Supabase client created');

// ==========================================
// MIDDLEWARE - MUST BE BEFORE API ROUTES
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all requests
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('📦 Body:', req.body);
  }
  next();
});

// ==========================================
// API ROUTES - MUST BE BEFORE STATIC FILES
// ==========================================

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  console.log('========================================');
  console.log('📥 REGISTER REQUEST');
  console.log('📦 Body:', req.body);
  
  const { email, password } = req.body;

  if (!email || !password) {
    console.log('❌ Missing email or password');
    return res.status(400).json({ 
      success: false, 
      error: 'Email and password required' 
    });
  }

  try {
    console.log(`🔍 Checking user: ${email}`);
    const { data: existing } = await supabase
      .from('profiles')
      .select('email')
      .eq('email', email)
      .single();

    if (existing) {
      console.log('❌ User exists');
      return res.status(400).json({ 
        success: false, 
        error: 'User already exists' 
      });
    }

    console.log('📝 Creating user in Supabase Auth...');
    const { data: authUser, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: email.split('@')[0] } }
    });

    if (signUpError) {
      console.log('❌ Auth error:', signUpError.message);
      return res.status(400).json({ 
        success: false, 
        error: signUpError.message 
      });
    }

    if (!authUser?.user) {
      console.log('❌ No user returned from auth');
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to create user' 
      });
    }

    console.log(`✅ Auth user created: ${authUser.user.id}`);

    console.log('📝 Creating profile...');
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authUser.user.id,
        email,
        name: email.split('@')[0],
        last_login: new Date().toISOString()
      })
      .select()
      .single();

    if (profileError) {
      console.log('❌ Profile error:', profileError.message);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to create profile' 
      });
    }

    console.log(`✅ Profile created: ${profile.id}`);

    const token = jwt.sign(
      { user_id: profile.id, email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    console.log('✅ Registration successful');
    console.log('========================================');

    res.json({
      success: true,
      token,
      user: { id: profile.id, email, name: profile.name }
    });

  } catch (error) {
    console.error('❌ Error:', error);
    console.log('========================================');
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  console.log('========================================');
  console.log('📥 LOGIN REQUEST');
  console.log('📦 Body:', req.body);
  
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ 
      success: false, 
      error: 'Email and password required' 
    });
  }

  try {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      console.log('❌ Auth error:', authError.message);
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }

    console.log(`✅ Auth successful: ${authData.user.id}`);

    let { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (!profile) {
      console.log('📝 Creating profile...');
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
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    console.log('✅ Login successful');
    console.log('========================================');

    res.json({
      success: true,
      token,
      user: { id: profile.id, email, name: profile.name }
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// VERIFY
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

// Get all hubs for user
app.get('/api/hubs', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('user_id', decoded.user_id)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

// Get hub config
app.get('/api/hubs/:hubId/config', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
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
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

// Set hub config
app.post('/api/hubs/:hubId/config', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const { hubId } = req.params;
    const { ssid, password, mqtt_server, mqtt_port, device_name } = req.body;
    
    if (!ssid) {
      return res.status(400).json({ error: 'SSID is required' });
    }
    
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
    res.status(401).json({ success: false, error: 'Invalid token' });
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

// Reboot hub
app.post('/api/hubs/:hubId/reboot', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    await supabase
      .from('hubs')
      .update({ 
        status: 'discovering',
        last_seen: new Date().toISOString()
      })
      .eq('hub_id', req.params.hubId);
    
    res.json({ success: true });
  } catch (error) {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

// Discovery - get hubs in discovery mode
app.get('/api/discover', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const cutoffTime = new Date(Date.now() - 120000).toISOString();
    
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .or(`status.eq.discovering,status.eq.offline,user_id.is.null`)
      .gte('last_seen', cutoffTime)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    const filtered = (data || []).filter(h => h.user_id !== decoded.user_id);
    res.json(filtered);
  } catch (error) {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

// ==========================================
// DEVICE API
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
app.get('/api/hubs/:hubId/devices', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('hub_id', req.params.hubId);
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(401).json({ success: false, error: 'Invalid token' });
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
app.get('/api/soil/latest', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const { data, error } = await supabase
      .from('soil_readings')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(1);
    
    if (error) throw error;
    res.json(data?.[0] || {});
  } catch (error) {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
});

// ==========================================
// STATIC FILES - MUST BE AFTER API ROUTES
// ==========================================
app.use(express.static(__dirname));

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/dashboard.html');
});

// ==========================================
// START
// ==========================================
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 URL: https://farm-iot.onrender.com`);
});