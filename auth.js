const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

const router = express.Router();

// ==========================================
// SUPABASE
// ==========================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ==========================================
// GOOGLE CLIENT
// ==========================================
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

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
    
    const { data: user, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', decoded.user_id)
      .single();
    
    if (error || !user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

// ==========================================
// GOOGLE SSO
// ==========================================
router.post('/google', async (req, res) => {
  console.log('========================================');
  console.log('📥 GOOGLE SSO REQUEST');
  
  try {
    const { id_token } = req.body;
    
    if (!id_token) {
      return res.status(400).json({ success: false, error: 'No ID token provided' });
    }
    
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const { sub: google_id, email, name, picture } = payload;
    
    console.log(`👤 Google user: ${email}`);
    
    let { data: existingUser } = await supabase
      .from('profiles')
      .select('*')
      .eq('google_id', google_id)
      .single();
    
    if (!existingUser) {
      const { data: userByEmail } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', email)
        .single();
      
      if (userByEmail) {
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
      user = existingUser;
    } else {
      const { data: newUser, error: createError } = await supabase
        .from('profiles')
        .insert({
          id: email,
          google_id: google_id,
          email: email,
          name: name || email.split('@')[0],
          picture: picture || null,
          last_login: new Date().toISOString()
        })
        .select()
        .single();
      
      if (createError) {
        return res.status(500).json({ success: false, error: createError.message });
      }
      user = newUser;
    }
    
    const token = jwt.sign(
      { user_id: user.id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
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
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// REGISTER (Email/Password)
// ==========================================
router.post('/register', async (req, res) => {
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
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// LOGIN (Email/Password)
// ==========================================
router.post('/login', async (req, res) => {
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
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// VERIFY TOKEN
// ==========================================
router.get('/verify', authenticate, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// ==========================================
// LOGOUT
// ==========================================
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out' });
});

module.exports = router;
module.exports.authenticate = authenticate;