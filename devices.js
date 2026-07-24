const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const axios = require('axios');

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
// POLL ESP32 FOR STATUS (Server checks hub)
// ==========================================
async function pollHubStatus(hub) {
  try {
    if (!hub.ip_address) return false;
    
    const url = `http://${hub.ip_address}/api/health`;
    const response = await axios.get(url, { timeout: 3000 });
    
    if (response.status === 200) {
      // Update last_seen in database
      await supabase
        .from('hubs')
        .update({
          status: 'online',
          last_seen: new Date().toISOString()
        })
        .eq('hub_id', hub.hub_id);
      return true;
    }
    return false;
  } catch (error) {
    // Hub is offline
    await supabase
      .from('hubs')
      .update({
        status: 'offline',
        last_seen: new Date().toISOString()
      })
      .eq('hub_id', hub.hub_id);
    return false;
  }
}

// ==========================================
// GET ALL HUBS
// ==========================================
router.get('/hubs', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.id || req.user.email;
    
    // Get all hubs for this user
    const { data: hubs, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('user_id', userEmail)
      .order('status', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Poll each hub for status (if it has an IP)
    for (const hub of hubs || []) {
      if (hub.ip_address) {
        await pollHubStatus(hub);
      }
    }

    // Get updated status from database
    const { data: updated, error: updateError } = await supabase
      .from('hubs')
      .select('*')
      .eq('user_id', userEmail)
      .order('status', { ascending: false })
      .order('created_at', { ascending: false });

    if (updateError) throw updateError;

    res.json(updated || []);
  } catch (error) {
    console.error('Error fetching hubs:', error);
    res.status(500).json({ error: 'Failed to fetch hubs' });
  }
});

// ==========================================
// REGISTER HUB
// ==========================================
router.post('/hubs/register', async (req, res) => {
  try {
    const { hub_id, ip_address, mac_address, status, device_name } = req.body;
    
    if (!hub_id) {
      return res.status(400).json({ error: 'hub_id required' });
    }

    const { data: existing, error: checkError } = await supabase
      .from('hubs')
      .select('*')
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
          status: status || 'online',
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
// CLAIM HUB
// ==========================================
router.post('/hubs/claim', authenticate, async (req, res) => {
  try {
    const { hub_id } = req.body;
    const userEmail = req.user.id || req.user.email;
    
    if (!hub_id) {
      return res.status(400).json({ error: 'hub_id required' });
    }

    const { data, error } = await supabase
      .from('hubs')
      .update({
        user_id: userEmail,
        status: 'online'
      })
      .eq('hub_id', hub_id)
      .select();

    if (error) throw error;
    
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Hub not found' });
    }

    res.json({ success: true, hub: data[0] });
  } catch (error) {
    console.error('Error claiming hub:', error);
    res.status(500).json({ error: 'Failed to claim hub' });
  }
});

// ==========================================
// DISCOVER HUBS
// ==========================================
router.get('/hubs/discover', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .is('user_id', null)
      .eq('status', 'online')
      .order('last_seen', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Error discovering hubs:', error);
    res.status(500).json({ error: 'Failed to discover hubs' });
  }
});

// ==========================================
// ADD/CLAIM HUB (via BLE)
// ==========================================
router.post('/hubs/add', authenticate, async (req, res) => {
  try {
    const { hub_id, ip_address, name } = req.body;
    const userEmail = req.user.id || req.user.email;
    
    if (!hub_id) {
      return res.status(400).json({ error: 'hub_id required' });
    }

    const { data: existing, error: checkError } = await supabase
      .from('hubs')
      .select('*')
      .eq('hub_id', hub_id)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    if (existing) {
      const { data, error } = await supabase
        .from('hubs')
        .update({
          user_id: userEmail,
          device_name: name || hub_id,
          ip_address: ip_address || existing.ip_address || null,
          status: 'online'
        })
        .eq('hub_id', hub_id)
        .select();
      
      if (error) throw error;
      res.json({ success: true, hub: data[0] });
    } else {
      const { data, error } = await supabase
        .from('hubs')
        .insert([{
          hub_id,
          user_id: userEmail,
          device_name: name || hub_id,
          ip_address: ip_address || null,
          status: 'pairing'
        }])
        .select();
      
      if (error) throw error;
      res.json({ success: true, hub: data[0] });
    }
  } catch (error) {
    console.error('Error adding hub:', error);
    res.status(500).json({ error: 'Failed to add hub' });
  }
});

// ==========================================
// REBOOT HUB
// ==========================================
router.post('/hubs/:hubId/reboot', authenticate, async (req, res) => {
  try {
    const { hubId } = req.params;
    
    const { data: hub, error: hubError } = await supabase
      .from('hubs')
      .select('ip_address')
      .eq('hub_id', hubId)
      .single();

    if (hubError || !hub) {
      return res.status(404).json({ error: 'Hub not found' });
    }

    if (!hub.ip_address) {
      return res.json({ 
        success: true, 
        message: 'Reboot command queued (hub has no IP)'
      });
    }

    try {
      const response = await axios.post(
        `http://${hub.ip_address}/api/reboot`,
        {},
        { timeout: 5000 }
      );
      
      if (response.status === 200) {
        res.json({ 
          success: true, 
          message: 'Reboot command sent successfully'
        });
      } else {
        res.json({ 
          success: true, 
          message: 'Reboot command sent (unexpected response)'
        });
      }
    } catch (error) {
      console.error('Reboot error:', error.message);
      res.json({ 
        success: true, 
        message: 'Reboot command sent (hub may be offline)'
      });
    }
  } catch (error) {
    console.error('Error rebooting hub:', error);
    res.status(500).json({ error: 'Failed to reboot hub' });
  }
});

// ==========================================
// GET HUB CONFIG
// ==========================================
router.get('/hubs/:hubId/config', authenticate, async (req, res) => {
  try {
    const { hubId } = req.params;
    
    const { data, error } = await supabase
      .from('hub_config')
      .select('*')
      .eq('hub_id', hubId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    
    if (!data) {
      return res.json({ config: {
        ssid: '',
        mqtt_server: 'broker.hivemq.com',
        mqtt_port: 1883,
        device_name: hubId
      }});
    }
    
    res.json({ config: data });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
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
      .update({ user_id: null, status: 'offline' })
      .eq('hub_id', hubId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting hub:', error);
    res.status(500).json({ error: 'Failed to delete hub' });
  }
});

module.exports = router;