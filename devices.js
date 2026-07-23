const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ==========================================
// REGISTER HUB (ESP32 posts here)
// ==========================================
router.post('/hubs/register', async (req, res) => {
  try {
    const { hub_id, ip_address, mac_address, status, device_name } = req.body;
    
    if (!hub_id) {
      return res.status(400).json({ error: 'hub_id required' });
    }

    const { data: existing, error: checkError } = await supabase
      .from('hubs')
      .select('id')
      .eq('hub_id', hub_id)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    if (existing) {
      const { data, error } = await supabase
        .from('hubs')
        .update({
          ip_address,
          mac_address,
          status: status || 'online',
          device_name: device_name || hub_id,
          last_seen: new Date().toISOString()
        })
        .eq('hub_id', hub_id)
        .select();
      
      if (error) throw error;
      res.json({ success: true, hub: data });
    } else {
      const { data, error } = await supabase
        .from('hubs')
        .insert([{
          hub_id,
          ip_address,
          mac_address,
          status: status || 'pairing',
          device_name: device_name || hub_id,
          user_id: null,
          last_seen: new Date().toISOString()
        }])
        .select();
      
      if (error) throw error;
      res.status(201).json({ success: true, hub: data });
    }
  } catch (error) {
    console.error('Error registering hub:', error);
    res.status(500).json({ error: 'Failed to register hub' });
  }
});

// ==========================================
// HEARTBEAT (ESP32 keeps alive)
// ==========================================
router.post('/hubs/heartbeat/:hubId', async (req, res) => {
  try {
    const { hubId } = req.params;
    const { ip } = req.body;

    await supabase
      .from('hubs')
      .update({
        ip_address: ip,
        status: 'online',
        last_seen: new Date().toISOString()
      })
      .eq('hub_id', hubId);

    res.json({ success: true });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ error: 'Failed to update heartbeat' });
  }
});

// ==========================================
// GET ALL HUBS (Dashboard uses this)
// ==========================================
router.get('/hubs', authenticate, async (req, res) => {
  try {
    const { data: hubs, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Mark hubs as offline if last_seen is too old (> 2 minutes)
    const now = new Date();
    for (const hub of hubs || []) {
      if (hub.last_seen) {
        const lastSeen = new Date(hub.last_seen);
        const diff = (now - lastSeen) / 1000; // seconds
        if (diff > 120 && hub.status === 'online') {
          // Hub hasn't sent heartbeat in 2 minutes - mark offline
          await supabase
            .from('hubs')
            .update({ status: 'offline' })
            .eq('hub_id', hub.hub_id);
          hub.status = 'offline';
        }
      }
    }

    res.json(hubs || []);
  } catch (error) {
    console.error('Error fetching hubs:', error);
    res.status(500).json({ error: 'Failed to fetch hubs' });
  }
});

// ==========================================
// DISCOVER HUBS (Unclaimed hubs)
// ==========================================
router.get('/hubs/discover', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .is('user_id', null)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Error discovering hubs:', error);
    res.status(500).json({ error: 'Failed to discover hubs' });
  }
});

// ==========================================
// ADD/CLAIM HUB
// ==========================================
router.post('/hubs/add', authenticate, async (req, res) => {
  try {
    const { hub_id, ip_address, name } = req.body;
    
    if (!hub_id) {
      return res.status(400).json({ error: 'hub_id required' });
    }

    const { data, error } = await supabase
      .from('hubs')
      .update({
        user_id: req.user.id,
        device_name: name || hub_id,
        ip_address: ip_address || null,
        status: 'pairing'
      })
      .eq('hub_id', hub_id)
      .is('user_id', null)
      .select();

    if (error) throw error;
    
    if (!data || data.length === 0) {
      const { data: newData, error: insertError } = await supabase
        .from('hubs')
        .insert([{
          hub_id,
          user_id: req.user.id,
          device_name: name || hub_id,
          ip_address: ip_address || null,
          status: 'pairing'
        }])
        .select();

      if (insertError) throw insertError;
      return res.json({ success: true, hub: newData[0] });
    }

    res.json({ success: true, hub: data[0] });
  } catch (error) {
    console.error('Error adding hub:', error);
    res.status(500).json({ error: 'Failed to add hub' });
  }
});

// ==========================================
// DELETE HUB
// ==========================================
router.delete('/hubs/:hubId', authenticate, async (req, res) => {
  try {
    const { hubId } = req.params;
    
    const { error } = await supabase
      .from('hubs')
      .update({ user_id: null, status: 'pairing' })
      .eq('hub_id', hubId)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting hub:', error);
    res.status(500).json({ error: 'Failed to delete hub' });
  }
});

module.exports = router;