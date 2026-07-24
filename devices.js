const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const mqtt = require('mqtt');

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ==========================================
// MQTT Client (Server connects to broker)
// ==========================================
const mqttClient = mqtt.connect('mqtt://broker.hivemq.com', {
  clientId: 'farmiot_server_' + Math.random().toString(16).substr(2, 6)
});

mqttClient.on('connect', () => {
  console.log('✅ Server connected to MQTT broker');
  // Subscribe to responses from hubs
  mqttClient.subscribe('farmiot/hub/response/#', (err) => {
    if (!err) console.log('📡 Subscribed to hub responses');
  });
});

mqttClient.on('message', async (topic, message) => {
  const payload = message.toString();
  console.log(`📥 MQTT message on ${topic}:`, payload);
  
  try {
    const data = JSON.parse(payload);
    const hubId = topic.split('/').pop();
    
    if (data.status === 'online') {
      // Update hub status in database
      await supabase
        .from('hubs')
        .update({
          status: 'online',
          ip_address: data.ip || null,
          last_seen: new Date().toISOString(),
          soil_moisture: data.soil || null
        })
        .eq('hub_id', hubId);
      console.log(`✅ Hub ${hubId} status updated: ONLINE`);
    }
  } catch (error) {
    console.error('MQTT message error:', error);
  }
});

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
// POLL HUB STATUS (Server asks ESP32 via MQTT)
// ==========================================
async function pollHubViaMQTT(hubId) {
  return new Promise((resolve) => {
    const topic = `farmiot/hub/request/${hubId}`;
    const responseTopic = `farmiot/hub/response/${hubId}`;
    
    // Timeout after 5 seconds
    const timeout = setTimeout(() => {
      console.log(`⏰ Poll timeout for ${hubId}`);
      resolve({ online: false, error: 'Timeout' });
    }, 5000);

    // Listen for response
    const handler = (topic, message) => {
      if (topic === responseTopic) {
        clearTimeout(timeout);
        try {
          const data = JSON.parse(message.toString());
          console.log(`✅ Poll response from ${hubId}:`, data);
          resolve({ online: true, data });
        } catch (e) {
          resolve({ online: false, error: 'Invalid response' });
        }
        mqttClient.removeListener('message', handler);
      }
    };

    mqttClient.on('message', handler);
    
    // Send poll request
    const request = JSON.stringify({ command: 'status' });
    mqttClient.publish(topic, request);
    console.log(`📤 Polling ${hubId} via MQTT...`);
  });
}

// ==========================================
// POLL HUB VIA HTTP (Fallback)
// ==========================================
async function pollHubViaHTTP(ip) {
  try {
    const url = `http://${ip}/api/health`;
    const response = await axios.get(url, { timeout: 3000 });
    return { online: true, data: response.data };
  } catch (error) {
    return { online: false, error: error.message };
  }
}

// ==========================================
// GET ALL HUBS (Poll each hub)
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

    // Poll each hub for status
    for (const hub of hubs || []) {
      if (!hub.hub_id) continue;
      
      let online = false;
      let statusData = null;
      
      // Try MQTT first
      const mqttResult = await pollHubViaMQTT(hub.hub_id);
      if (mqttResult.online) {
        online = true;
        statusData = mqttResult.data;
      } else if (hub.ip_address) {
        // Fallback to HTTP
        const httpResult = await pollHubViaHTTP(hub.ip_address);
        if (httpResult.online) {
          online = true;
          statusData = httpResult.data;
        }
      }
      
      if (online) {
        // Update database with online status
        await supabase
          .from('hubs')
          .update({
            status: 'online',
            last_seen: new Date().toISOString(),
            soil_moisture: statusData?.soil || hub.soil_moisture
          })
          .eq('hub_id', hub.hub_id);
        hub.status = 'online';
        hub.last_seen = new Date().toISOString();
      } else {
        // Mark as offline in database
        await supabase
          .from('hubs')
          .update({
            status: 'offline',
            last_seen: new Date().toISOString()
          })
          .eq('hub_id', hub.hub_id);
        hub.status = 'offline';
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
// REBOOT HUB (via MQTT)
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

    // Send reboot command via MQTT
    const topic = `farmiot/hub/request/${hubId}`;
    const command = JSON.stringify({ command: 'reboot' });
    
    mqttClient.publish(topic, command);
    console.log(`📤 Reboot command sent to ${hubId} via MQTT`);

    // Also try HTTP as fallback
    if (hub.ip_address) {
      try {
        await axios.post(
          `http://${hub.ip_address}/api/reboot`,
          {},
          { timeout: 3000 }
        );
        console.log(`📤 Reboot command sent to ${hubId} via HTTP`);
      } catch (httpError) {
        console.log(`⚠️ HTTP reboot failed for ${hubId}:`, httpError.message);
      }
    }

    res.json({ 
      success: true, 
      message: 'Reboot command sent via MQTT'
    });
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