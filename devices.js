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
// CHECK ESP32 STATUS (Server polls ESP32)
// ==========================================
async function checkHubStatus(hub) {
  try {
    // Try to reach ESP32's health endpoint
    const url = `http://${hub.ip_address}/api/health`;
    const response = await axios.get(url, { timeout: 3000 });
    
    if (response.status === 200) {
      // ESP32 is online - update database
      await supabase
        .from('hubs')
        .update({
          status: 'online',
          last_seen: new Date().toISOString()
        })
        .eq('hub_id', hub.hub_id);
      return true;
    }
  } catch (error) {
    // ESP32 is offline - update database
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
// GET ALL HUBS (With status check)
// ==========================================
router.get('/hubs', authenticate, async (req, res) => {
  try {
    // Get all hubs for this user
    const { data: hubs, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Check status of each hub (if it has an IP)
    for (const hub of hubs) {
      if (hub.ip_address) {
        await checkHubStatus(hub);
      }
    }

    // Get updated status from database
    const { data: updatedHubs, error: updateError } = await supabase
      .from('hubs')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (updateError) throw updateError;

    res.json(updatedHubs || []);
  } catch (error) {
    console.error('Error fetching hubs:', error);
    res.status(500).json({ error: 'Failed to fetch hubs' });
  }
});

// ==========================================
// REGISTER HUB (Discovery - no POST from ESP32)
// ==========================================
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
      res.json({ success: true, hub: data });
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
      res.status(201).json({ success: true, hub: data });
    }
  } catch (error) {
    console.error('Error registering hub:', error);
    res.status(500).json({ error: 'Failed to register hub' });
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
    
    // Check status of discovered hubs
    for (const hub of data || []) {
      if (hub.ip_address) {
        await checkHubStatus(hub);
      }
    }

    // Get updated status
    const { data: updated, error: updateError } = await supabase
      .from('hubs')
      .select('*')
      .is('user_id', null)
      .order('created_at', { ascending: false })
      .limit(20);

    if (updateError) throw updateError;

    res.json(updated || []);
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
// CONFIGURE HUB (Server sends config to ESP32)
// ==========================================
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

    // Save config in cloud (without password - security)
    const { data, error } = await supabase
      .from('hub_config')
      .upsert({
        hub_id: hubId,
        ssid,
        // password NOT stored in cloud (security)
        mqtt_server: mqtt_server || 'broker.hivemq.com',
        mqtt_port: mqtt_port || 1883,
        device_name: device_name || hubId,
        updated_at: new Date().toISOString()
      })
      .select();

    if (error) throw error;
    
    // Try to send config to ESP32 via HTTP
    let sentToHub = false;
    if (hub.ip_address) {
      try {
        const axios = require('axios');
        const formData = new URLSearchParams();
        formData.append('ssid', ssid);
        formData.append('password', password);
        formData.append('mqtt', mqtt_server || 'broker.hivemq.com');
        formData.append('port', mqtt_port || 1883);
        
        await axios.post(`http://${hub.ip_address}/api/config`, formData, {
          timeout: 5000,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        sentToHub = true;
        console.log(`✅ Config sent to hub ${hubId}`);
      } catch (sendError) {
        console.log(`⚠️ Could not send config to hub:`, sendError.message);
      }
    }

    // Update hub status
    await supabase
      .from('hubs')
      .update({ 
        device_name: device_name || hubId, 
        status: sentToHub ? 'online' : 'pairing' 
      })
      .eq('hub_id', hubId);

    res.json({ 
      success: true, 
      message: sentToHub ? 'Config sent to hub' : 'Config saved (hub offline)',
      config: data 
    });
  } catch (error) {
    console.error('Error configuring hub:', error);
    res.status(500).json({ error: 'Failed to configure hub' });
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
      .eq('user_id', req.user.id)
      .single();

    if (hubError || !hub) {
      return res.status(403).json({ error: 'Hub not found or not owned by user' });
    }

    let rebooted = false;
    if (hub.ip_address) {
      try {
        await axios.post(`http://${hub.ip_address}/api/reboot`, {}, { timeout: 5000 });
        rebooted = true;
      } catch (sendError) {}
    }

    res.json({ 
      success: true, 
      message: rebooted ? 'Reboot command sent' : 'Reboot queued (hub may be offline)'
    });
  } catch (error) {
    console.error('Error rebooting hub:', error);
    res.status(500).json({ error: 'Failed to reboot hub' });
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