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
console.log('✅ Supabase connected');

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all requests
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('📦 Body:', req.body);
  }
  next();
});

// ==========================================
// SERVE HTML PAGE
// ==========================================
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>FarmIOT</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #0a0e17;
            color: #e5e7eb;
            font-family: 'Segoe UI', Arial, sans-serif;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container { max-width: 500px; width: 100%; }
        h1 {
            font-size: 28px;
            text-align: center;
            background: linear-gradient(135deg, #4ade80, #22d3ee);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 30px;
        }
        .card {
            background: rgba(17, 24, 39, 0.9);
            padding: 24px;
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.06);
            margin-bottom: 16px;
        }
        .toggle {
            display: flex;
            gap: 4px;
            background: rgba(255,255,255,0.03);
            border-radius: 8px;
            padding: 3px;
            margin-bottom: 16px;
            border: 1px solid rgba(255,255,255,0.04);
        }
        .toggle button {
            flex: 1;
            padding: 8px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            background: transparent;
            color: #6b7280;
            font-family: inherit;
        }
        .toggle button.active {
            background: rgba(74, 222, 128, 0.1);
            color: #4ade80;
        }
        .form-group { margin-bottom: 14px; }
        label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: #9ca3af;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        input {
            width: 100%;
            padding: 10px 14px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 10px;
            color: #e5e7eb;
            font-size: 14px;
            font-family: inherit;
        }
        input:focus { outline: none; border-color: #4ade80; }
        .btn {
            width: 100%;
            padding: 12px;
            border: none;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            font-family: inherit;
        }
        .btn-primary {
            background: linear-gradient(135deg, #4ade80, #22d3ee);
            color: #0a0e17;
        }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(74,222,128,0.2); }
        .btn-danger {
            background: rgba(248,113,113,0.1);
            color: #f87171;
            border: 1px solid rgba(248,113,113,0.15);
        }
        .btn-danger:hover { background: rgba(248,113,113,0.2); }
        .confirm { display: none; }
        .toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            padding: 12px 20px;
            border-radius: 12px;
            background: rgba(17,24,39,0.95);
            border: 1px solid rgba(255,255,255,0.08);
            color: #e5e7eb;
            font-size: 14px;
            transform: translateY(100px);
            opacity: 0;
            transition: all 0.4s;
            z-index: 2000;
        }
        .toast.show { transform: translateY(0); opacity: 1; }
        .toast.success { border-left: 3px solid #4ade80; }
        .toast.error { border-left: 3px solid #f87171; }
        .spinner {
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid rgba(255,255,255,0.1);
            border-top-color: #4ade80;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            vertical-align: middle;
            margin-right: 8px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .user-info { text-align: center; padding: 10px; color: #6b7280; }
        .user-info strong { color: #e5e7eb; }
        .status { margin-top: 12px; padding: 10px; border-radius: 8px; font-size: 13px; display: none; }
        .status.success { display: block; background: rgba(74,222,128,0.08); color: #4ade80; border: 1px solid rgba(74,222,128,0.15); }
        .status.error { display: block; background: rgba(248,113,113,0.08); color: #f87171; border: 1px solid rgba(248,113,113,0.15); }
    </style>
</head>
<body>
<div class="container">
    <h1>🚜 FarmIOT</h1>

    <div class="card" id="authCard">
        <div class="toggle">
            <button class="active" id="loginTab" onclick="setMode('login')">Sign In</button>
            <button id="registerTab" onclick="setMode('register')">Register</button>
        </div>

        <form id="authForm" onsubmit="handleSubmit(event)">
            <div class="form-group">
                <label>Email</label>
                <input type="email" id="email" placeholder="Enter your email" required>
            </div>
            <div class="form-group">
                <label>Password</label>
                <input type="password" id="password" placeholder="Enter your password" minlength="6" required>
            </div>
            <div class="form-group confirm" id="confirmGroup">
                <label>Confirm Password</label>
                <input type="password" id="confirmPassword" placeholder="Confirm your password" minlength="6">
            </div>
            <button type="submit" class="btn btn-primary" id="submitBtn">Sign In</button>
        </form>

        <div id="status" class="status"></div>
    </div>

    <div id="userInfo" style="display:none;" class="card">
        <div class="user-info">
            👋 Logged in as <strong id="userEmail"></strong>
        </div>
        <button class="btn btn-danger" onclick="logout()" style="margin-top:10px;">Sign Out</button>
    </div>
</div>

<div class="toast" id="toast"></div>

<script>
    let mode = 'login';
    const API_BASE = window.location.origin;

    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = 'toast ' + type + ' show';
        clearTimeout(toast._hide);
        toast._hide = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function setMode(m) {
        mode = m;
        document.getElementById('loginTab').classList.toggle('active', m === 'login');
        document.getElementById('registerTab').classList.toggle('active', m === 'register');
        document.getElementById('confirmGroup').style.display = m === 'register' ? 'block' : 'none';
        document.getElementById('submitBtn').textContent = m === 'login' ? 'Sign In' : 'Register';
        document.getElementById('status').className = 'status';
        document.getElementById('status').textContent = '';
    }

    async function handleSubmit(e) {
        e.preventDefault();
        
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value.trim();
        const confirmPassword = document.getElementById('confirmPassword').value.trim();
        const status = document.getElementById('status');
        const btn = document.getElementById('submitBtn');

        if (!email || !password) {
            showToast('❌ Please fill in all fields', 'error');
            return;
        }

        if (mode === 'register' && password !== confirmPassword) {
            showToast('❌ Passwords do not match', 'error');
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Processing...';
        status.className = 'status';
        status.textContent = '';

        try {
            const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
            const response = await fetch(\`\${API_BASE}\${endpoint}\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (data.success) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                showToast(mode === 'login' ? '✅ Welcome back!' : '✅ Account created!', 'success');
                document.getElementById('authCard').style.display = 'none';
                document.getElementById('userInfo').style.display = 'block';
                document.getElementById('userEmail').textContent = data.user.email;
            } else {
                status.className = 'status error';
                status.textContent = '❌ ' + (data.error || 'Something went wrong');
                showToast('❌ ' + data.error, 'error');
            }
        } catch (error) {
            status.className = 'status error';
            status.textContent = '❌ Network error: ' + error.message;
            showToast('❌ Network error', 'error');
        }

        btn.disabled = false;
        btn.innerHTML = mode === 'login' ? 'Sign In' : 'Register';
    }

    function logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        document.getElementById('authCard').style.display = 'block';
        document.getElementById('userInfo').style.display = 'none';
        showToast('✅ Logged out', 'success');
    }

    // Check if already logged in
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (token && user) {
        document.getElementById('authCard').style.display = 'none';
        document.getElementById('userInfo').style.display = 'block';
        document.getElementById('userEmail').textContent = user.email;
    }

    setMode('login');
</script>
</body>
</html>
  `);
});

// ==========================================
// HEALTH CHECK
// ==========================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==========================================
// AUTH ROUTES
// ==========================================

// REGISTER - REAL SUPABASE
app.post('/api/auth/register', async (req, res) => {
  console.log('========================================');
  console.log('📥 REGISTER REQUEST');
  console.log('📦 Body:', req.body);
  
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      console.log('❌ Missing email or password');
      return res.status(400).json({ 
        success: false, 
        error: 'Email and password required' 
      });
    }
    
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Password length: ${password.length}`);
    
    // STEP 1: Check if user exists in profiles
    console.log('🔍 Checking if user exists...');
    const { data: existing, error: checkError } = await supabase
      .from('profiles')
      .select('email')
      .eq('email', email)
      .single();
    
    console.log('📊 Check result:', { existing: existing?.email, error: checkError?.message });
    
    if (existing) {
      console.log('❌ User already exists');
      return res.status(400).json({ 
        success: false, 
        error: 'User already exists' 
      });
    }
    
    // STEP 2: Create in Supabase Auth
    console.log('📝 Creating user in Supabase Auth...');
    const { data: authUser, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: email.split('@')[0] } }
    });
    
    console.log('📊 Auth result:', { 
      user_id: authUser?.user?.id, 
      error: signUpError?.message 
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
    
    // STEP 3: Create profile
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
    
    console.log('📊 Profile result:', { 
      profile_id: profile?.id, 
      error: profileError?.message 
    });
    
    if (profileError) {
      console.log('❌ Profile error:', profileError.message);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to create profile: ' + profileError.message 
      });
    }
    
    console.log(`✅ Profile created: ${profile.id}`);
    
    // STEP 4: Create JWT
    console.log('📝 Creating JWT...');
    const token = jwt.sign(
      { user_id: profile.id, email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    console.log('✅ Registration successful!');
    console.log('========================================');
    
    res.json({
      success: true,
      token,
      user: { id: profile.id, email, name: profile.name }
    });
    
  } catch (error) {
    console.error('❌ UNEXPECTED ERROR:', error);
    console.error('Stack:', error.stack);
    console.log('========================================');
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

// LOGIN - REAL SUPABASE
app.post('/api/auth/login', async (req, res) => {
  console.log('========================================');
  console.log('📥 LOGIN REQUEST');
  console.log('📦 Body:', req.body);
  
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and password required' 
      });
    }
    
    console.log(`📧 Email: ${email}`);
    
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
// LOGOUT
// ==========================================
app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true });
});

// ==========================================
// HUBS API
// ==========================================
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
// START
// ==========================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Health: GET /health`);
  console.log(`✅ Register: POST /api/auth/register`);
  console.log(`✅ Login: POST /api/auth/login`);
  console.log(`✅ Home: GET /`);
});