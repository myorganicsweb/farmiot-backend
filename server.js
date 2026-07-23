const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 443;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// TEST ENDPOINT - This will confirm the server is working
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});

// REGISTER ENDPOINT
app.post('/api/auth/register', (req, res) => {
  console.log('✅ REGISTER HIT');
  console.log('Body:', req.body);
  
  // Always return success for testing
  res.json({
    success: true,
    message: 'Registration endpoint is working!',
    received: req.body
  });
});

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Test: GET /api/test`);
  console.log(`✅ Register: POST /api/auth/register`);
});