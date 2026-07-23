const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// Import the authenticate middleware from auth.js
const { authenticate } = require('./auth');

const router = express.Router();

// ==========================================
// SUPABASE
// ==========================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ==========================================
// 1. DISCOVER HUBS
// ==========================================
router.get('/hubs/discover', authenticate, async (req, res) => {
  console.log('🔍 Scanning for hubs...');
  
  try {
    const cutoffTime = new Date(Date.now() - 120000).toISOString();
    const { data: hubs, error } = await supabase
      .from('hubs')
      .select('*')
      .or(`status.eq.discovering,status.eq.offline`)
      .gte('last_seen', cutoffTime)
      .neq('user_id', req.user.id);
    
    if (error) throw error;
    
    console.log(`✅ Found ${hubs?.length || 0} hubs in discovery mode`);
    res.json(hubs || []);
    
  } catch (error) {
    console.error('❌ Discovery error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 2. GET ALL HUBS FOR USER
// ==========================================
router.get('/hubs', authenticate, async (req, res) => {
  console.log(`📡 Getting hubs for user: ${req.user.id}`);
  
  try {
    const { data, error } = await supabase
      .from('hubs')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    console.log(`✅ Found ${data?.length || 0} hubs`);
    res.json(data || []);
  } catch (error) {
    console.error('❌ Error getting hubs:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 3. ADD HUB
// ==========================================
router.post('/hubs/add', authenticate, async (req, res) => {
  console.log('📥 Add hub request');
  console.log('📦 Body:', req.body);
  
  try {
    const { hub_id, ip_address, mac_address, name } = req.body;
    
    if (!hub_id) {
      return res.status(400).json({ error: 'hub_id is required' });
    }
    
    // Check if hub already exists
    const { data: existing } = await supabase
      .from('hubs')
      .select('*')
      .eq('hub_id', hub_id)
      .single();
    
    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from('hubs')
        .update({
          user_id: req.user.id,
          name: name || existing.name || hub_id,
          status: 'online',
          ip_address: ip_address || existing.ip_address,
          last_seen: new Date().toISOString()
        })
        .eq('hub_id', hub_id)
        .select()
        .single();
      
      if (updateError) throw updateError;
      
      return res.json({ 
        success: true, 
        hub: updated,
        message: 'Hub updated successfully' 
      });
    }
    
    const { data: newHub, error: createError } = await supabase
      .from('hubs')
      .insert({
        hub_id: hub_id,
        user_id: req.user.id,
        name: name || hub_id,
        status: 'online',
        ip_address: ip_address || null,
        last_seen: new Date().toISOString()
      })
      .select()
      .single();
    
    if (createError) throw createError;
    
    await supabase
      .from('hub_configs')
      .insert({
        hub_id: hub_id,
        ssid: '',
        password: '',
        mqtt_server: 'broker.hivemq.com',
        mqtt_port: 1883,
        device_name: name || hub_id
      });
    
    console.log(`✅ Hub added: ${hub_id}`);
    
    res.json({ 
      success: true, 
      hub: newHub,
      message: 'Hub added successfully' 
    });
    
  } catch (error) {
    console.error('❌ Add hub error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 4. GET HUB CONFIG
// ==========================================
router.get('/hubs/:hubId/config', authenticate, async (req, res) => {
  console.log(`📥 Get config for hub: ${req.params.hubId}`);
  
  try {
    const { hubId } = req.params;
    
    const { data: hub, error: hubError } = await supabase
      .from('hubs')
      .select('*')
      .eq('hub_id', hubId)
      .eq('user_id', req.user.id)
      .single();
    
    if (hubError || !hub) {
      return res.status(404).json({ error: 'Hub not found' });
    }
    
    const { data: config, error: configError } = await supabase
      .from('hub_configs')
      .select('*')
      .eq('hub_id', hubId)
      .single();
    
    if (configError) throw configError;
    
    res.json({
      ...hub,
      config: config || {}
    });
    
  } catch (error) {
    console.error('❌ Get config error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 5. CONFIGURE HUB (Push WiFi to ESP32)
// ==========================================
router.post('/hubs/:hubId/configure', authenticate, async (req, res) => {
  console.log(`📥 Configure hub: ${req.params.hubId}`);
  console.log('📦 Body:', req.body);
  
  try {
    const { hubId } = req.params;
    const { ssid, password, mqtt_server, mqtt_port, device_name } = req.body;
    
    if (!ssid) {
      return res.status(400).json({ error: 'SSID is required' });
    }
    
    const { data: hub, error: hubError } = await supabase
      .from('hubs')
      .select('*')
      .eq('hub_id', hubId)
      .eq('user_id', req.user.id)
      .single();
    
    if (hubError || !hub) {
      return res.status(404).json({ error: 'Hub not found' });
    }
    
    // Save config to Supabase
    const { error: configError } = await supabase
      .from('hub_configs')
      .update({
        ssid: ssid,
        password: password || '',
        mqtt_server: mqtt_server || 'broker.hivemq.com',
        mqtt_port: mqtt_port || 1883,
        device_name: device_name || hubId,
        updated_at: new Date().toISOString()
      })
      .eq('hub_id', hubId);
    
    if (configError) throw configError;
    
    await supabase
      .from('hubs')
      .update({
        name: device_name || hub.name,
        status: 'configuring',
        last_seen: new Date().toISOString()
      })
      .eq('hub_id', hubId);
    
    // Try to push config to ESP32 (if online)
    let esp32Response = null;
    if (hub.ip_address) {
      try {
        esp32Response = await axios.post(
          `http://${hub.ip_address}/api/config`,
          new URLSearchParams({
            ssid: ssid,
            password: password || '',
            mqtt: mqtt_server || 'broker.hivemq.com',
            port: String(mqtt_port || 1883)
          }),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 5000
          }
        );
        console.log('✅ Config pushed to ESP32');
        
        await supabase
          .from('hubs')
          .update({ status: 'online' })
          .eq('hub_id', hubId);
          
      } catch (error) {
        console.log('⚠️ ESP32 not reachable, config saved in Supabase');
        esp32Response = { error: 'ESP32 not reachable, config will be pulled later' };
      }
    }
    
    const { data: updatedConfig } = await supabase
      .from('hub_configs')
      .select('*')
      .eq('hub_id', hubId)
      .single();
    
    res.json({
      success: true,
      message: 'Configuration saved successfully',
      config: updatedConfig,
      esp32_push: esp32Response
    });
    
  } catch (error) {
    console.error('❌ Configure error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 6. REBOOT HUB
// ==========================================
router.post('/hubs/:hubId/reboot', authenticate, async (req, res) => {
  console.log(`🔄 Rebooting hub: ${req.params.hubId}`);
  
  try {
    const { hubId } = req.params;
    
    const { data: hub, error: hubError } = await supabase
      .from('hubs')
      .select('ip_address')
      .eq('hub_id', hubId)
      .eq('user_id', req.user.id)
      .single();
    
    if (hubError || !hub) {
      return res.status(404).json({ error: 'Hub not found' });
    }
    
    await supabase
      .from('hubs')
      .update({ 
        status: 'discovering',
        last_seen: new Date().toISOString()
      })
      .eq('hub_id', hubId);
    
    let rebootResult = null;
    if (hub.ip_address) {
      try {
        await axios.post(`http://${hub.ip_address}/api/reboot`, {}, { timeout: 3000 });
        rebootResult = { success: true, message: 'Reboot command sent' };
      } catch (error) {
        rebootResult = { success: false, message: 'ESP32 not reachable' };
      }
    }
    
    res.json({
      success: true,
      message: 'Hub reboot initiated',
      reboot: rebootResult
    });
    
  } catch (error) {
    console.error('❌ Reboot error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 7. DELETE HUB
// ==========================================
router.delete('/hubs/:hubId', authenticate, async (req, res) => {
  console.log(`🗑️ Deleting hub: ${req.params.hubId}`);
  
  try {
    const { hubId } = req.params;
    
    const { error } = await supabase
      .from('hubs')
      .delete()
      .eq('hub_id', hubId)
      .eq('user_id', req.user.id);
    
    if (error) throw error;
    
    res.json({ success: true, message: 'Hub deleted' });
  } catch (error) {
    console.error('❌ Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 8. SOIL API
// ==========================================
router.post('/soil', async (req, res) => {
  const { device_id, value } = req.body;
  
  if (!device_id || value === undefined) {
    return res.status(400).json({ error: 'device_id and value required' });
  }
  
  try {
    await supabase
      .from('soil_readings')
      .insert({
        device_id,
        value: parseInt(value),
        timestamp: new Date().toISOString()
      });
    
    await supabase
      .from('devices')
      .update({ latest_soil: parseInt(value), last_seen: new Date().toISOString() })
      .eq('device_id', device_id);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 9. GET LATEST SOIL
// ==========================================
router.get('/soil/latest', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('soil_readings')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(1);
    
    if (error) throw error;
    res.json(data?.[0] || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;