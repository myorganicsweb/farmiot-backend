const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Google SSO
router.post('/google', async (req, res) => {
  console.log('📥 Google SSO request');
  
  try {
    const { id_token } = req.body;
    
    if (!id_token) {
      return res.status(400).json({ success: false, error: 'No token provided' });
    }
    
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const { sub: google_id, email, name, picture } = payload;
    
    console.log(`👤 Google user: ${email}`);
    
    // Check if user exists
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
          .update({ google_id, picture })
          .eq('id', userByEmail.id)
          .select()
          .single();
        existingUser = updated;
      }
    }
    
    let user;
    
    if (!existingUser) {
      console.log('📝 Creating new user...');
      
      const { data: authUsers } = await supabase
        .from('auth.users')
        .select('id')
        .eq('email', email)
        .single();
      
      let userId;
      
      if (authUsers) {
        userId = authUsers.id;
      } else {
        const { data: newAuthUser } = await supabase.auth.signUp({
          email: email,
          password: Math.random().toString(36).slice(-12),
          options: { data: { full_name: name || email.split('@')[0] } }
        });
        userId = newAuthUser?.user?.id;
        
        if (!userId) {
          return res.status(500).json({ 
            success: false, 
            error: 'Failed to create user' 
          });
        }
      }
      
      const { data: newUser } = await supabase
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
      
      user = newUser;
    } else {
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
    }
    
    const token = jwt.sign(
      { user_id: user.id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture
      }
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Verify token
router.get('/verify', async (req, res) => {
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

// Logout
router.post('/logout', (req, res) => {
  res.json({ success: true });
});

module.exports = router;