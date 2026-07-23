const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const hubRoutes = require('./routes/hubs');
const deviceRoutes = require('./routes/devices');

const app = express();
const PORT = process.env.PORT || 443;

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log requests
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  next();
});

// ==========================================
// API ROUTES
// ==========================================
app.use('/api/auth', authRoutes);
app.use('/api/hubs', hubRoutes);
app.use('/api/devices', deviceRoutes);

// ==========================================
// SERVE STATIC FILES
// ==========================================
app.use(express.static(path.join(__dirname, '../public')));

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ==========================================
// START
// ==========================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ API: /api/auth/google`);
  console.log(`✅ API: /api/hubs`);
  console.log(`✅ API: /api/devices`);
});