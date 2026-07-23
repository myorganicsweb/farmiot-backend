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
// MIDDLEWARE - ORDER MATTERS!
// ==========================================
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ==========================================
// API ROUTES - MUST BE BEFORE STATIC FILES
// ==========================================

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  console.log('📥 REGISTER REQUEST');
  console.log('Body:', req.body);
  
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
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
      process.env.JWT_SECRET || 'your-secret-key',
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

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  console.log('📥 LOGIN REQUEST');
  console.log('Body:', req.body);
  
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
      process.env.JWT_SECRET || 'your-secret-key',
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

// VERIFY
app.get('/api/auth/verify', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const { data: user } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', decoded.user_id)
      .single();
    res.json({ success: true, user });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ==========================================
// STATIC FILES - AFTER API ROUTES
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
});