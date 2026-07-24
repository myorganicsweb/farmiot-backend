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
// MQTT Client
// ==========================================
const mqttClient = mqtt.connect('mqtt://broker.hivemq.com', {
  clientId: 'farmiot_server_' + Math.random().toString(16).substr(2, 6)
});

mqttClient.on('connect', () => {
  console.log('✅ Server connected to MQTT broker');
  mqttClient.subscribe('farmiot/hub/response/#', (err) => {
    if (!err) console.log('📡 Subscribed to hub responses');
  });
  mqttClient.subscribe('farmiot/sensor/response/#', (err) => {
    if (!err) console.log('📡 Subscribed to sensor responses');
  });
});

mqttClient.on('message', async (topic, message) => {
  const payload = message.toString();
  console.log(`📥 MQTT message on ${topic}:`, payload);
  
  try {
    const data = JSON.parse(payload);
    const deviceId = topic.split('/').pop();
    
    if (data.status === 'online') {
      // Determine if it's a hub or sensor
      if (topic.includes('/hub/')) {
        await supabase
          .from('hubs')
          .update({
            status: 'online',
            ip_address: data.ip || null,
            last_seen: new Date().toISOString(),
            soil_moisture: data.soil || null
          })
          .eq('hub_id', deviceId);
        console.log(`✅ Hub ${deviceId} status updated: ONLINE`);
      } else if (topic.includes('/sensor/')) {
        await supabase
          .from('sensors')
          .update({
            status: 'online',
            ip_address: data.ip || null,
            last_seen: new Date().toISOString(),
            soil_moisture: data.soil || null
          })
          .eq('device_id', deviceId);
        console.log(`✅ Sensor ${deviceId} status updated: ONLINE`);
      }
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
// POLL HUB VIA MQTT
// ==========================================
async function pollHubViaMQTT(hubId) {
  return new Promise((resolve) => {
    const topic = `farmiot/hub/request/${hubId}`;
    const responseTopic = `farmiot/hub/response/${hubId}`;
    
    const timeout = setTimeout(() => {
      console.log(`⏰ Poll timeout for hub ${hubId}`);
      resolve({ online: false, error: 'Timeout' });
    }, 5000);

    const handler = (topic, message) => {
      if (topic === responseTopic) {
        clearTimeout(timeout);
        try {
          const data = JSON.parse(message.toString());
          console.log(`✅ Poll response from hub ${hubId}:`, data);
          resolve({ online: true, data });
        } catch (e) {
          resolve({ online: false, error: 'Invalid response' });
        }
        mqttClient.removeListener('message', handler);
      }
    };

    mqttClient.on('message', handler);
    
    const request = JSON.stringify({ command: 'status' });
    mqttClient.publish(topic, request);
    console.log(`📤 Polling hub ${hubId} via MQTT...`);
  });
}

// ==========================================
// POLL SENSOR VIA MQTT
// ==========================================
async function pollSensorViaMQTT(sensorId) {
  return new Promise((resolve) => {
    const topic = `farmiot/sensor/request/${sensorId}`;
    const responseTopic = `farmiot/sensor/response/${sensorId}`;
    
    const timeout = setTimeout(() => {
      console.log(`⏰ Poll timeout for sensor ${sensorId}`);
      resolve({ online: false, error: 'Timeout' });
    }, 5000);

    const handler = (topic, message) => {
      if (topic === responseTopic) {
        clearTimeout(timeout);
        try {
          const data = JSON.parse(message.toString());
          console.log(`✅ Poll response from sensor ${sensorId}:`, data);
          resolve({ online: true, data });
        } catch (e) {
          resolve({ online: false, error: 'Invalid response' });
        }
        mqttClient.removeListener('message', handler);
      }
    };

    mqttClient.on('message', handler);
    
    const request = JSON.stringify({ command: 'status' });
    mqttClient.publish(topic, request);
    console.log(`📤 Polling sensor ${sensorId} via MQTT...`);
  });
}

// ==========================================
// POLL DEVICE VIA HTTP (Fallback)
// ==========================================
async function pollDeviceViaHTTP(ip) {
  try {
    const url = `http://${ip}/api/health`;
    const response = await axios.get(url, { timeout: 3000 });
    return { online: true, data: response.data };
  } catch (error) {
    return { online: false, error: error.message };
  }
}

// ==========================================
// GET USER SETTINGS
// ==========================================
router.get('/settings', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.id || req.user.email;
    
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userEmail)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!data) {
      const defaultSettings = {
        user_id: userEmail,
        active_refresh_interval: 300,
        inactive_refresh_interval: 3600,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      const { data: newData, error: insertError } = await supabase
        .from('user_settings')
        .insert([defaultSettings])
        .select()
        .single();

      if (insertError) throw insertError;
      return res.json(newData);
    }

    res.json(data);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// ==========================================
// UPDATE USER SETTINGS
// ==========================================
router.post('/settings', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.id || req.user.email;
    const { active_refresh_interval, inactive_refresh_interval } = req.body;

    const validIntervals = [5, 30, 60, 120, 300, 1800, 3600, 10800, 21600, 43200, 86400];
    if (active_refresh_interval && !validIntervals.includes(active_refresh_interval)) {
      return res.status(400).json({ error: 'Invalid active refresh interval' });
    }
    if (inactive_refresh_interval && !validIntervals.includes(inactive_refresh_interval)) {
      return res.status(400).json({ error: 'Invalid inactive refresh interval' });
    }

    const { data: existing, error: checkError } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userEmail)
      .maybeSingle();

    let result;

    if (existing) {
      const { data, error } = await supabase
        .from('user_settings')
        .update({
          active_refresh_interval: active_refresh_interval || existing.active_refresh_interval,
          inactive_refresh_interval: inactive_refresh_interval || existing.inactive_refresh_interval,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userEmail)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('user_settings')
        .insert([{
          user_id: userEmail,
          active_refresh_interval: active_refresh_interval || 300,
          inactive_refresh_interval: inactive_refresh_interval || 3600,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    res.json({ success: true, settings: result });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ==========================================
// HUBS
// ==========================================

// ==========================================
// GET ALL HUBS
// ==========================================
router.get('/hubs', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.id || req.user.email;
    
    const { data: hubs, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('user_id', userEmail)
      .order('status', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    for (const hub of hubs || []) {
      if (!hub.hub_id) continue;
      
      let online = false;
      let statusData = null;
      
      const mqttResult = await pollHubViaMQTT(hub.hub_id);
      if (mqttResult.online) {
        online = true;
        statusData = mqttResult.data;
      } else if (hub.ip_address) {
        const httpResult = await pollDeviceViaHTTP(hub.ip_address);
        if (httpResult.online) {
          online = true;
          statusData = httpResult.data;
        }
      }
      
      if (online) {
        await supabase
          .from('hubs')
          .update({
            status: 'online',
            last_seen: new Date().toISOString(),
            soil_moisture: statusData?.soil || hub.soil_moisture
          })
          .eq('hub_id', hub.hub_id);
        hub.status = 'online';
      } else {
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
    console.error('Error fetching hub config:', error);
    res.status(500).json({ error: 'Failed to fetch hub config' });
  }
});

// ==========================================
// CONFIGURE HUB - WITH PROPAGATION TO SENSORS
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

    // Save hub config
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
    
    // Update hub name and status
    await supabase
      .from('hubs')
      .update({ 
        device_name: device_name || hubId, 
        status: 'online' 
      })
      .eq('hub_id', hubId);

    // ==========================================
    // PROPAGATE TO LINKED SENSORS
    // ==========================================
    const { data: sensors, error: sensorError } = await supabase
      .from('sensors')
      .select('device_id, device_name')
      .eq('hub_id', hubId);

    let propagatedCount = 0;
    if (!sensorError && sensors && sensors.length > 0) {
      propagatedCount = sensors.length;
      console.log(`📡 Propagating WiFi config to ${propagatedCount} linked sensors...`);
      
      // Update sensors table with new SSID
      await supabase
        .from('sensors')
        .update({ 
          wifi_ssid: ssid,
          wifi_updated_at: new Date().toISOString()
        })
        .eq('hub_id', hubId);
      
      // Send MQTT notification to sensors
      try {
        const mqttClient2 = mqtt.connect('mqtt://broker.hivemq.com');
        mqttClient2.on('connect', () => {
          sensors.forEach(sensor => {
            const message = JSON.stringify({
              command: 'update_wifi',
              ssid: ssid,
              password: password
            });
            mqttClient2.publish(`farmiot/sensor/${sensor.device_id}/config`, message);
            console.log(`📤 Sent WiFi update to sensor ${sensor.device_id}`);
          });
          setTimeout(() => mqttClient2.end(), 2000);
        });
      } catch (mqttError) {
        console.log('MQTT notification failed:', mqttError.message);
      }
    }

    // Try to send config to hub via HTTP if we have IP
    if (hub.ip_address) {
      try {
        const formData = new URLSearchParams();
        formData.append('ssid', ssid);
        formData.append('password', password);
        formData.append('mqtt', mqtt_server || 'broker.hivemq.com');
        formData.append('port', mqtt_port || 1883);
        
        await axios.post(`http://${hub.ip_address}/api/config`, formData, {
          timeout: 5000,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        console.log(`✅ Config sent to hub ${hubId}`);
      } catch (sendError) {
        console.log(`⚠️ Could not send config to hub:`, sendError.message);
      }
    }

    res.json({ 
      success: true, 
      config: data,
      propagated_to: propagatedCount,
      message: propagatedCount > 0 ? `Config saved and propagated to ${propagatedCount} sensors` : 'Config saved successfully'
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
      .single();

    if (hubError || !hub) {
      return res.status(404).json({ error: 'Hub not found' });
    }

    // Send reboot via MQTT
    const topic = `farmiot/hub/request/${hubId}`;
    const command = JSON.stringify({ command: 'reboot' });
    mqttClient.publish(topic, command);
    console.log(`📤 Reboot command sent to hub ${hubId} via MQTT`);

    // HTTP fallback
    if (hub.ip_address) {
      try {
        await axios.post(
          `http://${hub.ip_address}/api/reboot`,
          {},
          { timeout: 3000 }
        );
        console.log(`📤 Reboot sent to hub ${hubId} via HTTP`);
      } catch (httpError) {
        console.log(`⚠️ HTTP reboot failed:`, httpError.message);
      }
    }

    res.json({ 
      success: true, 
      message: 'Reboot command sent'
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
    
    // Get linked sensors
    const { data: sensors, error: sensorError } = await supabase
      .from('sensors')
      .select('device_id')
      .eq('hub_id', hubId);

    // Unlink sensors
    if (!sensorError && sensors && sensors.length > 0) {
      await supabase
        .from('sensors')
        .update({ hub_id: null, wifi_ssid: null })
        .eq('hub_id', hubId);
    }

    // Delete hub config
    await supabase
      .from('hub_config')
      .delete()
      .eq('hub_id', hubId);

    // Delete hub (or unclaim it)
    const { error } = await supabase
      .from('hubs')
      .update({ user_id: null, status: 'offline' })
      .eq('hub_id', hubId);

    if (error) throw error;
    
    res.json({ 
      success: true, 
      unlinked_sensors: sensors?.length || 0
    });
  } catch (error) {
    console.error('Error deleting hub:', error);
    res.status(500).json({ error: 'Failed to delete hub' });
  }
});

// ==========================================
// SENSORS
// ==========================================

// ==========================================
// GET ALL SENSORS
// ==========================================
router.get('/sensors', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.id || req.user.email;
    
    const { data: sensors, error } = await supabase
      .from('sensors')
      .select('*')
      .eq('user_id', userEmail)
      .order('status', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Poll each sensor for status
    for (const sensor of sensors || []) {
      if (!sensor.device_id) continue;
      
      let online = false;
      let statusData = null;
      
      const mqttResult = await pollSensorViaMQTT(sensor.device_id);
      if (mqttResult.online) {
        online = true;
        statusData = mqttResult.data;
      } else if (sensor.ip_address) {
        const httpResult = await pollDeviceViaHTTP(sensor.ip_address);
        if (httpResult.online) {
          online = true;
          statusData = httpResult.data;
        }
      }
      
      if (online) {
        await supabase
          .from('sensors')
          .update({
            status: 'online',
            last_seen: new Date().toISOString(),
            soil_moisture: statusData?.soil || sensor.soil_moisture
          })
          .eq('device_id', sensor.device_id);
        sensor.status = 'online';
      } else {
        await supabase
          .from('sensors')
          .update({
            status: 'offline',
            last_seen: new Date().toISOString()
          })
          .eq('device_id', sensor.device_id);
        sensor.status = 'offline';
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('sensors')
      .select('*')
      .eq('user_id', userEmail)
      .order('status', { ascending: false })
      .order('created_at', { ascending: false });

    if (updateError) throw updateError;

    res.json(updated || []);
  } catch (error) {
    console.error('Error fetching sensors:', error);
    res.status(500).json({ error: 'Failed to fetch sensors' });
  }
});

// ==========================================
// REGISTER SENSOR
// ==========================================
router.post('/sensors/register', async (req, res) => {
  try {
    const { device_id, hub_id, ip, mac, device_name } = req.body;
    
    if (!device_id) {
      return res.status(400).json({ error: 'device_id required' });
    }

    const { data: existing, error: checkError } = await supabase
      .from('sensors')
      .select('*')
      .eq('device_id', device_id)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    if (existing) {
      const { data, error } = await supabase
        .from('sensors')
        .update({
          ip_address: ip,
          mac_address: mac,
          hub_id: hub_id || existing.hub_id,
          status: 'online',
          device_name: device_name || existing.device_name,
          last_seen: new Date().toISOString()
        })
        .eq('device_id', device_id)
        .select();
      
      if (error) throw error;
      res.json({ success: true, sensor: data });
    } else {
      const { data, error } = await supabase
        .from('sensors')
        .insert([{
          device_id,
          device_name: device_name || device_id,
          hub_id: hub_id || null,
          ip_address: ip || null,
          mac_address: mac || null,
          status: 'online',
          user_id: null,
          last_seen: new Date().toISOString()
        }])
        .select();
      
      if (error) throw error;
      res.status(201).json({ success: true, sensor: data });
    }
  } catch (error) {
    console.error('Error registering sensor:', error);
    res.status(500).json({ error: 'Failed to register sensor' });
  }
});

// ==========================================
// LINK SENSOR TO HUB
// ==========================================
router.post('/sensors/link', authenticate, async (req, res) => {
  try {
    const { sensor_id, hub_id, ssid } = req.body;
    const userEmail = req.user.id || req.user.email;
    
    if (!sensor_id || !hub_id) {
      return res.status(400).json({ error: 'sensor_id and hub_id required' });
    }

    // Verify hub belongs to user
    const { data: hub, error: hubError } = await supabase
      .from('hubs')
      .select('id')
      .eq('hub_id', hub_id)
      .eq('user_id', userEmail)
      .single();

    if (hubError || !hub) {
      return res.status(403).json({ error: 'Hub not found or not owned by user' });
    }

    // Get hub WiFi config to propagate
    const { data: hubConfig, error: configError } = await supabase
      .from('hub_config')
      .select('ssid, password')
      .eq('hub_id', hub_id)
      .single();

    // Update sensor
    const { data, error } = await supabase
      .from('sensors')
      .update({
        hub_id: hub_id,
        user_id: userEmail,
        wifi_ssid: hubConfig?.ssid || ssid || null,
        status: 'pairing'
      })
      .eq('device_id', sensor_id)
      .select();

    if (error) throw error;
    
    if (!data || data.length === 0) {
      // Sensor doesn't exist - create it
      const { data: newData, error: insertError } = await supabase
        .from('sensors')
        .insert([{
          device_id: sensor_id,
          hub_id: hub_id,
          user_id: userEmail,
          wifi_ssid: hubConfig?.ssid || ssid || null,
          status: 'pairing'
        }])
        .select();
      
      if (insertError) throw insertError;
      
      // Send WiFi config to sensor via MQTT
      if (hubConfig?.ssid && hubConfig?.password) {
        try {
          const mqttClient2 = mqtt.connect('mqtt://broker.hivemq.com');
          mqttClient2.on('connect', () => {
            const message = JSON.stringify({
              command: 'configure_wifi',
              ssid: hubConfig.ssid,
              password: hubConfig.password
            });
            mqttClient2.publish(`farmiot/sensor/${sensor_id}/config`, message);
            setTimeout(() => mqttClient2.end(), 1000);
          });
        } catch (mqttError) {
          console.log('MQTT send failed:', mqttError.message);
        }
      }
      
      return res.json({ success: true, sensor: newData[0] });
    }

    res.json({ success: true, sensor: data[0] });
  } catch (error) {
    console.error('Error linking sensor:', error);
    res.status(500).json({ error: 'Failed to link sensor' });
  }
});

// ==========================================
// GET SENSOR CONFIG
// ==========================================
router.get('/sensors/:sensorId/config', authenticate, async (req, res) => {
  try {
    const { sensorId } = req.params;
    
    const { data, error } = await supabase
      .from('sensors')
      .select('*')
      .eq('device_id', sensorId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    
    if (!data) {
      return res.json({ config: {
        wifi_ssid: '',
        device_name: sensorId
      }});
    }
    
    res.json({ config: data });
  } catch (error) {
    console.error('Error fetching sensor config:', error);
    res.status(500).json({ error: 'Failed to fetch sensor config' });
  }
});

// ==========================================
// DELETE SENSOR
// ==========================================
router.delete('/sensors/:sensorId', authenticate, async (req, res) => {
  try {
    const { sensorId } = req.params;
    
    const { error } = await supabase
      .from('sensors')
      .update({ user_id: null, hub_id: null, status: 'offline' })
      .eq('device_id', sensorId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting sensor:', error);
    res.status(500).json({ error: 'Failed to delete sensor' });
  }
});

// ==========================================
// RECEIVE SENSOR DATA
// ==========================================
router.post('/devices/data', async (req, res) => {
  try {
    const { device_id, hub_id, soil, temperature, humidity } = req.body;
    
    if (!device_id) {
      return res.status(400).json({ error: 'device_id required' });
    }

    // Update sensor data
    const { data, error } = await supabase
      .from('sensors')
      .update({
        soil_moisture: soil || null,
        temperature: temperature || null,
        humidity: humidity || null,
        last_seen: new Date().toISOString(),
        status: 'online'
      })
      .eq('device_id', device_id)
      .select();

    if (error) throw error;

    // Also store in readings table for history
    if (soil !== undefined || temperature !== undefined || humidity !== undefined) {
      await supabase
        .from('sensor_readings')
        .insert([{
          sensor_id: device_id,
          hub_id: hub_id || null,
          soil_moisture: soil || null,
          temperature: temperature || null,
          humidity: humidity || null,
          timestamp: new Date().toISOString()
        }]);
    }

    res.json({ success: true, sensor: data });
  } catch (error) {
    console.error('Error saving sensor data:', error);
    res.status(500).json({ error: 'Failed to save sensor data' });
  }
});

// ==========================================
// SOIL MOISTURE (Legacy support)
// ==========================================
router.get('/soil/latest', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sensor_readings')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(1);

    if (error) throw error;
    
    if (data && data.length > 0) {
      const reading = data[0];
      res.json({ 
        value: reading.soil_moisture || '—', 
        timestamp: reading.timestamp 
      });
    } else {
      res.json({ value: '—', timestamp: new Date().toISOString() });
    }
  } catch (error) {
    console.error('Error fetching soil data:', error);
    res.status(500).json({ error: 'Failed to fetch soil data' });
  }
});

router.post('/soil', async (req, res) => {
  try {
    const { hub_id, value } = req.body;
    
    if (!hub_id || value === undefined) {
      return res.status(400).json({ error: 'hub_id and value required' });
    }

    const { data, error } = await supabase
      .from('sensor_readings')
      .insert([{
        hub_id,
        soil_moisture: value,
        timestamp: new Date().toISOString()
      }]);

    if (error) throw error;
    
    // Also update hub's latest soil reading
    await supabase
      .from('hubs')
      .update({ soil_moisture: value })
      .eq('hub_id', hub_id);

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving soil data:', error);
    res.status(500).json({ error: 'Failed to save soil data' });
  }
});

module.exports = router;