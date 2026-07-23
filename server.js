const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 443;

console.log('🚀 SERVER STARTING...');
console.log(`📡 PORT: ${PORT}`);

// ==========================================
// SUPABASE
// ==========================================
console.log('🔌 Connecting to Supabase...');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
console.log('✅ Supabase client created');

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.static(__dirname));

// Log all HTTP requests
app.use((req, res, next) => {
  console.log(`🌐 HTTP ${req.method} ${req.url}`);
  next();
});

// ==========================================
// SOCKET.IO CONNECTION
// ==========================================
io.on('connection', (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);
  console.log(`📊 Total clients: ${io.engine.clientsCount}`);

  // ==========================================
  // REGISTER - WITH FULL LOGGING
  // ==========================================
  socket.on('register', async (data) => {
    console.log('========================================');
    console.log('📥 REGISTER EVENT RECEIVED');
    console.log(`📦 Data received:`, JSON.stringify(data, null, 2));
    console.log(`📦 Data type: ${typeof data}`);
    console.log(`📦 Data keys: ${Object.keys(data || {})}`);
    
    const { email, password } = data || {};

    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Password length: ${password ? password.length : 0}`);

    if (!email || !password) {
      console.log('❌ Missing email or password');
      socket.emit('register_response', { 
        success: false, 
        error: 'Email and password required',
        received: { email: !!email, password: !!password }
      });
      return;
    }

    try {
      console.log(`🔍 Checking if user exists: ${email}`);
      const { data: existing, error: checkError } = await supabase
        .from('profiles')
        .select('email')
        .eq('email', email)
        .single();

      console.log(`📊 Check result:`, { existing, checkError });

      if (existing) {
        console.log('❌ User already exists');
        socket.emit('register_response', { 
          success: false, 
          error: 'User already exists' 
        });
        return;
      }

      console.log('📝 Creating user in Supabase Auth...');
      const { data: authUser, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: email.split('@')[0] } }
      });

      console.log(`📊 Auth result:`, { 
        user: authUser?.user?.id, 
        error: signUpError?.message 
      });

      if (signUpError) {
        console.log(`❌ Signup error: ${signUpError.message}`);
        socket.emit('register_response', { 
          success: false, 
          error: signUpError.message 
        });
        return;
      }

      if (!authUser?.user) {
        console.log('❌ No user returned from auth');
        socket.emit('register_response', { 
          success: false, 
          error: 'Failed to create user' 
        });
        return;
      }

      console.log(`✅ Auth user created: ${authUser.user.id}`);

      console.log('📝 Creating profile...');
      const { data: profile, error: createError } = await supabase
        .from('profiles')
        .insert({
          id: authUser.user.id,
          email,
          name: email.split('@')[0],
          last_login: new Date().toISOString()
        })
        .select()
        .single();

      console.log(`📊 Profile result:`, { profile: profile?.id, error: createError?.message });

      if (createError) {
        console.log(`❌ Profile create error: ${createError.message}`);
        socket.emit('register_response', { 
          success: false, 
          error: 'Failed to create user profile' 
        });
        return;
      }

      console.log(`✅ Profile created: ${profile.id}`);

      const token = jwt.sign(
        { user_id: profile.id, email },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );

      console.log('✅ Registration successful');
      console.log('========================================');

      socket.emit('register_response', {
        success: true,
        token,
        user: { id: profile.id, email, name: profile.name }
      });

    } catch (error) {
      console.error('❌ Registration error:', error);
      console.error('Stack:', error.stack);
      console.log('========================================');
      socket.emit('register_response', { 
        success: false, 
        error: error.message || 'Unknown error' 
      });
    }
  });

  // ==========================================
  // LOGIN - WITH FULL LOGGING
  // ==========================================
  socket.on('login', async (data) => {
    console.log('========================================');
    console.log('📥 LOGIN EVENT RECEIVED');
    console.log(`📦 Data received:`, JSON.stringify(data, null, 2));
    
    const { email, password } = data || {};

    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Password length: ${password ? password.length : 0}`);

    if (!email || !password) {
      console.log('❌ Missing email or password');
      socket.emit('login_response', { 
        success: false, 
        error: 'Email and password required' 
      });
      return;
    }

    try {
      console.log(`🔍 Attempting login for: ${email}`);
      
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      console.log(`📊 Auth result:`, { 
        user: authData?.user?.id, 
        error: authError?.message 
      });

      if (authError) {
        console.log(`❌ Auth error: ${authError.message}`);
        socket.emit('login_response', { 
          success: false, 
          error: 'Invalid credentials' 
        });
        return;
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

      socket.emit('login_response', {
        success: true,
        token,
        user: { id: profile.id, email, name: profile.name }
      });

    } catch (error) {
      console.error('❌ Login error:', error);
      console.log('========================================');
      socket.emit('login_response', { 
        success: false, 
        error: error.message || 'Unknown error' 
      });
    }
  });

  // ==========================================
  // GET HUBS
  // ==========================================
  socket.on('get_hubs', async (token) => {
    console.log('📥 GET_HUBS request');
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      console.log(`👤 User ID: ${decoded.user_id}`);
      
      const { data, error } = await supabase
        .from('hubs')
        .select('*')
        .eq('user_id', decoded.user_id)
        .order('created_at', { ascending: false });
      
      console.log(`📊 Found ${data?.length || 0} hubs`);
      socket.emit('hubs_list', data || []);
    } catch (error) {
      console.error('❌ GET_HUBS error:', error.message);
      socket.emit('error', { message: 'Invalid token' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    console.log(`📊 Remaining clients: ${io.engine.clientsCount}`);
  });
});

// ==========================================
// SERVE DASHBOARD
// ==========================================
app.get('/', (req, res) => {
  console.log('📄 Serving dashboard');
  res.sendFile(__dirname + '/dashboard.html');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    clients: io.engine.clientsCount
  });
});

// ==========================================
// START
// ==========================================
server.listen(PORT, () => {
  console.log('========================================');
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 URL: https://farm-iot.onrender.com`);
  console.log(`🔐 JWT Secret: ${process.env.JWT_SECRET ? '✅ Set' : '⚠️ Using default'}`);
  console.log('========================================');
});