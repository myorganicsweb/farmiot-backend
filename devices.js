const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Initialize Supabase
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
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ==========================================
// SOIL MOISTURE ROUTES
// ==========================================

// Get latest soil moisture reading
router.get('/soil/latest', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('soil_readings')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(1);

    if (error) throw error;
    
    if (data && data.length > 0) {
      res.json(data[0]);
    } else {
      res.json({ value: '—', timestamp: new Date().toISOString() });
    }
  } catch (error) {
    console.error('Error fetching soil data:', error);
    res.status(500).json({ error: 'Failed to fetch soil data' });
  }
});

// Add soil moisture reading (from ESP32)
router.post('/soil', async (req, res) => {
  try {
    const { hub_id, value } = req.body;
    
    if (!hub_id || value === undefined) {
      return res.status(400).json({ error: 'hub_id and value required' });
    }

    const { data, error } = await supabase
      .from('soil_readings')
      .insert([{
        hub_id,
        value,
        timestamp: new Date().toISOString()
      }]);

    if (error) throw error;
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving soil data:', error);
    res.status(500).json({ error: 'Failed to save soil data' });
  }
});

// ==========================================
// HUB ROUTES
// ==========================================

// Get all hubs for a user
router.get('/hubs', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    res.json(data || []);
  } catch (error) {
    console.error('Error fetching hubs:', error);
    res.status(500).json({ error: 'Failed to fetch hubs' });
  }
});

// Register hub (ESP32 calls this)
router.post('/hubs/register', async (req, res) => {
  try {
    const { hub_id, ip_address, mac_address, status, device_name } = req.body;
    
    if (!hub_id) {
      return res.status(400).json({ error: 'hub_id required' });
    }

    // Check if hub exists
    const { data: existing, error: checkError } = await supabase
      .from('hubs')
      .select('id')
      .eq('hub_id', hub_id)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    let result;
    if (existing) {
      // Update existing hub
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
      result = data;
    } else {
      // Create new hub (unclaimed)
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
      result = data;
    }

    res.status(201).json({ success: true, hub: result });
  } catch (error) {
    console.error('Error registering hub:', error);
    res.status(500).json({ error: 'Failed to register hub' });
  }
});

// Discover hubs (unclaimed hubs on network)
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

// Add/claim hub
router.post('/hubs/add', authenticate, async (req, res) => {
  try {
    const { hub_id, ip_address, name } = req.body;
    
    if (!hub_id) {
      return res.status(400).json({ error: 'hub_id required' });
    }

    // First check if hub exists and is unclaimed
    const { data: existing, error: checkError } = await supabase
      .from('hubs')
      .select('*')
      .eq('hub_id', hub_id)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    let result;
    if (existing) {
      // Update existing hub - claim it
      const { data, error } = await supabase
        .from('hubs')
        .update({
          user_id: req.user.id,
          device_name: name || hub_id,
          ip_address: ip_address || existing.ip_address,
          status: 'online'
        })
        .eq('hub_id', hub_id)
        .is('user_id', null)  // Only claim if not already claimed
        .select();

      if (error) throw error;
      
      if (!data || data.length === 0) {
        return res.status(400).json({ error: 'Hub already claimed or not found' });
      }
      result = data;
    } else {
      // Create new hub and claim it
      const { data, error } = await supabase
        .from('hubs')
        .insert([{
          hub_id,
          user_id: req.user.id,
          device_name: name || hub_id,
          ip_address: ip_address || null,
          status: 'online'
        }])
        .select();

      if (error) throw error;
      result = data;
    }

    res.json({ success: true, hub: result[0] });
  } catch (error) {
    console.error('Error adding hub:', error);
    res.status(500).json({ error: 'Failed to add hub' });
  }
});

// Get hub config
router.get('/hubs/:hubId/config', authenticate, async (req, res) => {
  try {
    const { hubId } = req.params;
    
    const { data, error } = await supabase
      .from('hub_config')
      .select('*')
      .eq('hub_id', hubId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    
    // If no config found, return defaults
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

// Configure hub
router.post('/hubs/:hubId/configure', authenticate, async (req, res) => {
  try {
    const { hubId } = req.params;
    const { ssid, password, mqtt_server, mqtt_port, device_name } = req.body;
    
    if (!ssid) {
      return res.status(400).json({ error: 'SSID required' });
    }

    // Check if hub belongs to user
    const { data: hub, error: hubError } = await supabase
      .from('hubs')
      .select('id, ip_address')
      .eq('hub_id', hubId)
      .eq('user_id', req.user.id)
      .single();

    if (hubError || !hub) {
      return res.status(403).json({ error: 'Hub not found or not owned by user' });
    }

    // Save config
    const { data, error } = await supabase
      .from('hub_config')
      .upsert({
        hub_id: hubId,
        ssid,
        password,
        mqtt_server: mqtt_server || 'broker.hivemq.com',
        mqtt_port: mqtt_port || 1883,
        device_name: device_name || hubId,
        updated_at: new Date().toISOString()
      })
      .select();

    if (error) throw error;
    
    // Update hub name
    await supabase
      .from('hubs')
      .update({ device_name: device_name || hubId, status: 'online' })
      .eq('hub_id', hubId);

    // Try to send config to hub via HTTP if we have IP
    if (hub.ip_address) {
      try {
        const axios = require('axios');
        const configData = {
          ssid,
          password,
          mqtt: mqtt_server || 'broker.hivemq.com',
          port: mqtt_port || 1883
        };
        await axios.post(`http://${hub.ip_address}/api/config`, configData, { timeout: 5000 });
        console.log(`✅ Config sent to hub ${hubId} at ${hub.ip_address}`);
      } catch (sendError) {
        console.log(`⚠️ Could not send config to hub ${hubId}:`, sendError.message);
      }
    }

    res.json({ success: true, config: data });
  } catch (error) {
    console.error('Error configuring hub:', error);
    res.status(500).json({ error: 'Failed to configure hub' });
  }
});

// Reboot hub
router.post('/hubs/:hubId/reboot', authenticate, async (req, res) => {
  try {
    const { hubId } = req.params;
    
    const { data: hub, error: hubError } = await supabase
      .from('hubs')
      .select('ip_address')
      .eq('hub_id', hubId)
      .eq('user_id', req.user.id)
      .single();

    if (hubError || !hub) {
      return res.status(403).json({ error: 'Hub not found or not owned by user' });
    }

    let rebooted = false;
    if (hub.ip_address) {
      try {
        const axios = require('axios');
        await axios.post(`http://${hub.ip_address}/api/reboot`, {}, { timeout: 5000 });
        rebooted = true;
        console.log(`✅ Reboot command sent to hub ${hubId}`);
      } catch (sendError) {
        console.log(`⚠️ Could not send reboot to hub ${hubId}:`, sendError.message);
      }
    }

    res.json({ 
      success: true, 
      message: rebooted ? 'Reboot command sent' : 'Reboot command queued (hub may be offline)'
    });
  } catch (error) {
    console.error('Error rebooting hub:', error);
    res.status(500).json({ error: 'Failed to reboot hub' });
  }
});

// Delete/remove hub
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