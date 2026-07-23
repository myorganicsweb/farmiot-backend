const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 443;

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// REGISTER - THE ONLY ENDPOINT WE NEED TO TEST
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
  
  // Just echo back for testing
  res.json({
    success: true,
    message: 'Registration endpoint works!',
    received: { email, password: '***' }
  });
});

// Serve dashboard
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/dashboard.html');
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Test endpoint: POST /api/auth/register`);
});