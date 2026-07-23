const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 443;

console.log('🚀 SERVER STARTING...');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// API ENDPOINTS
// ==========================================

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// REGISTER - With logging
app.post('/api/auth/register', (req, res) => {
  console.log('✅ REGISTER HIT');
  console.log('📦 Body:', req.body);
  
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password required'
    });
  }
  
  // TEMPORARY: Just echo back for testing
  res.json({
    success: true,
    message: 'Registration endpoint works!',
    received: { email, password: '***' }
  });
});

// LOGIN - Echo for testing
app.post('/api/auth/login', (req, res) => {
  console.log('✅ LOGIN HIT');
  console.log('📦 Body:', req.body);
  
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password required'
    });
  }
  
  res.json({
    success: true,
    message: 'Login endpoint works!',
    received: { email, password: '***' }
  });
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// ==========================================
// START
// ==========================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Health: GET /health`);
  console.log(`✅ Register: POST /api/auth/register`);
});