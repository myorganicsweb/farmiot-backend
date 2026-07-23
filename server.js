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

// ==========================================
// SUPABASE
// ==========================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.static(__dirname));

// ==========================================
// SOCKET.IO CONNECTION
// ==========================================
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);

  // REGISTER
  socket.on('register', async (data) => {
    console.log('📥 Register:', data);
    const { email, password } = data;

    if (!email || !password) {
      socket.emit('register_response', { success: false, error: 'Email and password required' });
      return;
    }

    try {
      const { data: existing } = await supabase
        .from('profiles')
        .select('email')
        .eq('email', email)
        .single();

      if (existing) {
        socket.emit('register_response', { success: false, error: 'User already exists' });
        return;
      }

      const { data: authUser, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: email.split('@')[0] } }
      });

      if (signUpError) {
        socket.emit('register_response', { success: false, error: signUpError.message });
        return;
      }

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

      const token = jwt.sign(
        { user_id: profile.id, email },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );

      socket.emit('register_response', {
        success: true,
        token,
        user: { id: profile.id, email, name: profile.name }
      });

    } catch (error) {
      console.error('Register error:', error);
      socket.emit('register_response', { success: false, error: error.message });
    }
  });

  // LOGIN
  socket.on('login', async (data) => {
    console.log('📥 Login:', data);
    const { email, password } = data;

    if (!email || !password) {
      socket.emit('login_response', { success: false, error: 'Email and password required' });
      return;
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) {
        socket.emit('login_response', { success: false, error: 'Invalid credentials' });
        return;
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

      socket.emit('login_response', {
        success: true,
        token,
        user: { id: profile.id, email, name: profile.name }
      });

    } catch (error) {
      console.error('Login error:', error);
      socket.emit('login_response', { success: false, error: error.message });
    }
  });

  // GET HUBS
  socket.on('get_hubs', async (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      const { data } = await supabase
        .from('hubs')
        .select('*')
        .eq('user_id', decoded.user_id)
        .order('created_at', { ascending: false });
      socket.emit('hubs_list', data || []);
    } catch (error) {
      socket.emit('error', { message: 'Invalid token' });
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
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
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ WebSocket server ready`);
});