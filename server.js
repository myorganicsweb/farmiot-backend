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
// MIDDLEWARE - THIS WORKS
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

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
// REGISTER - SIMPLE
// ==========================================
app.post('/api/auth/register', async (req, res) => {
  console.log('📥 Register:', req.body);
  
  const { email, password } = req.body;
  
  // Validate
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
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
// LOGIN - SIMPLE
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  console.log('📥 Login:', req.body);
  
  const { email, password } = req.body;
  
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
    
    // Get or create profile
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
// HUBS API (SIMPLE)
// ==========================================
app.get('/api/hubs', authenticate, async (req, res) => {
  const { data } = await supabase
    .from('hubs')
    .select('*')
    .eq('user_id', req.user.id);
  res.json(data || []);
});

app.get('/api/hubs/:hubId/config', authenticate, async (req, res) => {
  const { data } = await supabase
    .from('hub_configs')
    .select('*')
    .eq('hub_id', req.params.hubId)
    .single();
  res.json(data || {});
});

app.post('/api/hubs/:hubId/config', authenticate, async (req, res) => {
  const { ssid, password, mqtt_server, mqtt_port, device_name } = req.body;
  
  await supabase
    .from('hub_configs')
    .update({
      ssid,
      password: password || '',
      mqtt_server: mqtt_server || 'broker.hivemq.com',
      mqtt_port: mqtt_port || 1883,
      device_name: device_name || req.params.hubId,
      updated_at: new Date().toISOString()
    })
    .eq('hub_id', req.params.hubId);
  
  res.json({ success: true });
});

app.post('/api/hubs/register', async (req, res) => {
  const { hub_id, ip_address, status, device_name } = req.body;
  
  if (!hub_id) {
    return res.status(400).json({ error: 'hub_id required' });
  }
  
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
});

app.post('/api/hubs/:hubId/reboot', authenticate, async (req, res) => {
  await supabase
    .from('hubs')
    .update({ status: 'discovering', last_seen: new Date().toISOString() })
    .eq('hub_id', req.params.hubId);
  res.json({ success: true });
});

app.get('/api/discover', authenticate, async (req, res) => {
  const cutoff = new Date(Date.now() - 120000).toISOString();
  const { data } = await supabase
    .from('hubs')
    .select('*')
    .or(`status.eq.discovering,status.eq.offline,user_id.is.null`)
    .gte('last_seen', cutoff);
  res.json(data || []);
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
  console.log(`✅ Server running on port ${PORT}`);
});