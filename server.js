// ==========================================
// GOOGLE SSO - FIXED UUID
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
    
    // Verify the ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const { sub: google_id, email, name, picture } = payload;
    
    console.log(`👤 Google user: ${email} (${google_id})`);
    
    // ==========================================
    // FIX: Use UUID for user ID
    // ==========================================
    
    // Step 1: Check if user exists in profiles by google_id or email
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
          .eq('id', userByEmail.id)
          .select()
          .single();
        existingUser = updated;
      }
    }
    
    let user;
    
    if (existingUser) {
      console.log(`✅ User found in profiles: ${existingUser.id}`);
      user = existingUser;
    } else {
      console.log('📝 Creating new user...');
      
      // Generate a proper UUID for the user
      const { v4: uuidv4 } = require('uuid');
      const userId = uuidv4();
      
      console.log(`📝 Generated UUID: ${userId}`);
      
      // Create profile with UUID
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
        
        // If profile already exists, fetch it
        if (createError.message.includes('duplicate key')) {
          const { data: existing } = await supabase
            .from('profiles')
            .select('*')
            .eq('google_id', google_id)
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