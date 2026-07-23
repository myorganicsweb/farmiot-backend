const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 443;

console.log('🚀 SERVER STARTING...');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// HTML PAGE - Embedded directly in server
// ==========================================
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>FarmIOT - Test</title>
    <style>
        body {
            background: #0a0e17;
            color: #e5e7eb;
            font-family: Arial, sans-serif;
            max-width: 500px;
            margin: 50px auto;
            padding: 20px;
        }
        h1 { color: #4ade80; }
        button {
            padding: 12px 20px;
            background: #4ade80;
            border: none;
            border-radius: 8px;
            color: #000;
            font-weight: bold;
            cursor: pointer;
            margin: 5px;
        }
        pre {
            background: #1a1a2e;
            padding: 15px;
            border-radius: 8px;
            overflow-x: auto;
            margin-top: 20px;
        }
        .error { color: #f87171; }
        .success { color: #4ade80; }
        .status { margin-top: 10px; }
    </style>
</head>
<body>
    <h1>🚜 FarmIOT</h1>
    <p>Testing server endpoints...</p>
    
    <div>
        <button onclick="testRegister()">Test Register</button>
        <button onclick="testLogin()">Test Login</button>
        <button onclick="testHealth()">Health Check</button>
    </div>
    
    <div id="result" class="status">
        <p>Click a button to test...</p>
    </div>

    <script>
        async function testHealth() {
            const result = document.getElementById('result');
            result.innerHTML = 'Loading...';
            
            try {
                const res = await fetch('/health');
                const data = await res.json();
                result.innerHTML = \`
                    <div class="success">✅ Status: \${res.status}</div>
                    <pre>\${JSON.stringify(data, null, 2)}</pre>
                \`;
            } catch (error) {
                result.innerHTML = \`<div class="error">❌ Error: \${error.message}</div>\`;
            }
        }

        async function testRegister() {
            const result = document.getElementById('result');
            result.innerHTML = 'Loading...';
            
            try {
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        email: 'test@example.com', 
                        password: 'test123' 
                    })
                });
                
                const data = await res.json();
                result.innerHTML = \`
                    <div class="\${res.ok ? 'success' : 'error'}">\${res.ok ? '✅' : '❌'} Status: \${res.status}</div>
                    <pre>\${JSON.stringify(data, null, 2)}</pre>
                \`;
            } catch (error) {
                result.innerHTML = \`<div class="error">❌ Error: \${error.message}</div>\`;
            }
        }

        async function testLogin() {
            const result = document.getElementById('result');
            result.innerHTML = 'Loading...';
            
            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        email: 'test@example.com', 
                        password: 'test123' 
                    })
                });
                
                const data = await res.json();
                result.innerHTML = \`
                    <div class="\${res.ok ? 'success' : 'error'}">\${res.ok ? '✅' : '❌'} Status: \${res.status}</div>
                    <pre>\${JSON.stringify(data, null, 2)}</pre>
                \`;
            } catch (error) {
                result.innerHTML = \`<div class="error">❌ Error: \${error.message}</div>\`;
            }
        }
    </script>
</body>
</html>
  `);
});

// ==========================================
// API ENDPOINTS
// ==========================================

// Health check
app.get('/health', (req, res) => {
  console.log('✅ Health check');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// REGISTER
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

// LOGIN
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