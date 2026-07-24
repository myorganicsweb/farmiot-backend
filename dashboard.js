// ==========================================
// FarmIOT Dashboard JavaScript
// ==========================================

const API_BASE = window.location.origin;
let token = localStorage.getItem('token') || null;
let user = JSON.parse(localStorage.getItem('user') || 'null');
let authMode = 'login';
let currentConfigDeviceId = null;
let currentBleDevice = null;
let currentBleCharacteristic = null;
let isConnected = false;
let isFirstLoad = true;
let allDevices = [];
let isUIActive = true;
let refreshCountdown = 0;
let countdownInterval = null;
let currentDeviceType = 'hub';
let availableHubs = [];

const BLE_SERVICE_UUID_HUB = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const BLE_CHARACTERISTIC_UUID_HUB = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
const BLE_SERVICE_UUID_SENSOR = "4fafc201-1fb5-459e-8fcc-c5c9c331914c";
const BLE_CHARACTERISTIC_UUID_SENSOR = "beb5483e-36e1-4688-b7f5-ea07361b26a9";

// ===== TOAST =====
function showToast(message, type) {
    if (!type) type = 'success';
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type + ' show';
    clearTimeout(toast._hide);
    toast._hide = setTimeout(function() {
        toast.classList.remove('show');
    }, 3500);
}

// ===== BLE STATUS =====
function updateBleStatus(status, message) {
    var el = document.getElementById('bleStatus');
    el.className = 'ble-status ' + status;
    var icons = { connected: '🟢', disconnected: '⚪', scanning: '🔄' };
    el.textContent = (icons[status] || '⚪') + ' ' + (message || status);
}

// ===== API =====
async function apiRequest(endpoint, options) {
    if (!options) options = {};
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var response = await fetch(API_BASE + endpoint, Object.assign({}, options, { headers: headers }));
    return response.json();
}

// ===== REFRESH SETTINGS =====
async function loadRefreshSettingsFromDB() {
    try {
        var response = await fetch(API_BASE + '/api/settings', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!response.ok) throw new Error('Failed to load settings');
        var settings = await response.json();
        
        document.getElementById('activeRefreshRate').value = settings.active_refresh_interval || 300;
        document.getElementById('inactiveRefreshRate').value = settings.inactive_refresh_interval || 3600;
        
        localStorage.setItem('farmiot_active_refresh', settings.active_refresh_interval || 300);
        localStorage.setItem('farmiot_inactive_refresh', settings.inactive_refresh_interval || 3600);
        
        return settings;
    } catch (error) {
        console.error('Error loading settings:', error);
        return { active_refresh_interval: 300, inactive_refresh_interval: 3600 };
    }
}

async function saveRefreshSettingsToDB() {
    var active = parseInt(document.getElementById('activeRefreshRate').value);
    var inactive = parseInt(document.getElementById('inactiveRefreshRate').value);
    
    try {
        var response = await fetch(API_BASE + '/api/settings', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                active_refresh_interval: active,
                inactive_refresh_interval: inactive
            })
        });
        
        if (!response.ok) throw new Error('Failed to save settings');
        var result = await response.json();
        
        localStorage.setItem('farmiot_active_refresh', active);
        localStorage.setItem('farmiot_inactive_refresh', inactive);
        
        showToast('✅ Settings saved to account', 'success');
        restartRefreshTimer();
        return result;
    } catch (error) {
        showToast('❌ Failed to save settings: ' + error.message, 'error');
    }
}

function saveRefreshSettings() {
    saveRefreshSettingsToDB();
}

function getRefreshSettings() {
    return {
        active: parseInt(localStorage.getItem('farmiot_active_refresh') || '300'),
        inactive: parseInt(localStorage.getItem('farmiot_inactive_refresh') || '3600')
    };
}

function getCurrentRefreshInterval() {
    var settings = getRefreshSettings();
    return isUIActive ? settings.active : settings.inactive;
}

// ===== COUNTDOWN =====
function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    refreshCountdown = getCurrentRefreshInterval();
    updateCountdownDisplay();
    
    countdownInterval = setInterval(function() {
        refreshCountdown--;
        if (refreshCountdown <= 0) {
            refreshCountdown = getCurrentRefreshInterval();
            if (token && user) {
                console.log('🔄 Auto-refresh triggered');
                loadDevices();
            }
        }
        updateCountdownDisplay();
    }, 1000);
}

function updateCountdownDisplay() {
    var seconds = refreshCountdown;
    var display;
    if (seconds < 60) {
        display = seconds + 's';
    } else {
        var mins = Math.floor(seconds / 60);
        var secs = seconds % 60;
        display = mins + 'm ' + secs + 's';
    }
    var countdownEl = document.getElementById('nextRefreshCountdown');
    var indicatorEl = document.getElementById('refreshIndicator');
    if (countdownEl) countdownEl.textContent = display;
    if (indicatorEl) indicatorEl.textContent = '⏱️ Refresh in: ' + display;
}

function restartRefreshTimer() {
    if (countdownInterval) clearInterval(countdownInterval);
    startCountdown();
}

// ===== FORCE REFRESH =====
async function forceRefreshNow() {
    showToast('🔄 Refreshing...', 'warning');
    refreshCountdown = getCurrentRefreshInterval();
    await loadDevices();
    showToast('✅ Devices refreshed', 'success');
}

// ===== AUTH =====
function setAuthMode(m) {
    authMode = m;
    document.getElementById('loginTab').classList.toggle('active', m === 'login');
    document.getElementById('registerTab').classList.toggle('active', m === 'register');
    document.getElementById('confirmGroup').style.display = m === 'register' ? 'block' : 'none';
    document.getElementById('submitBtn').textContent = m === 'login' ? 'Sign In' : 'Register';
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value.trim();
    var confirm = document.getElementById('confirmPassword').value.trim();
    var status = document.getElementById('authStatus');
    var btn = document.getElementById('submitBtn');

    if (!email || !password) {
        status.style.display = 'block'; status.className = 'error';
        status.textContent = '❌ Please fill in all fields'; return;
    }
    if (authMode === 'register' && password !== confirm) {
        status.style.display = 'block'; status.className = 'error';
        status.textContent = '❌ Passwords do not match'; return;
    }

    btn.disabled = true; btn.innerHTML = '⏳ Processing...'; status.style.display = 'none';

    try {
        var endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
        var data = await apiRequest(endpoint, { method: 'POST', body: JSON.stringify({ email: email, password: password }) });

        if (data.success) {
            token = data.token; user = data.user;
            localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user));
            showUser(user);
            showToast(authMode === 'login' ? '✅ Welcome back!' : '✅ Account created!', 'success');
            loadDashboard();
        } else {
            status.style.display = 'block'; status.className = 'error';
            status.textContent = '❌ ' + (data.error || 'Something went wrong');
            showToast('❌ ' + data.error, 'error');
        }
    } catch (error) {
        status.style.display = 'block'; status.className = 'error';
        status.textContent = '❌ Network error: ' + error.message;
        showToast('❌ Network error', 'error');
    }

    btn.disabled = false; btn.innerHTML = authMode === 'login' ? 'Sign In' : 'Register';
}

// ===== GOOGLE SSO =====
function initGoogleSSO() {
    console.log('🔑 Initializing Google SSO...');
    
    if (typeof google === 'undefined' || typeof google.accounts === 'undefined') {
        console.log('⏳ Waiting for Google API to load...');
        setTimeout(initGoogleSSO, 500);
        return;
    }
    
    try {
        google.accounts.id.initialize({
            client_id: '472048491207-hofjvaisdj9vnaglutb9kd23ci948jc5.apps.googleusercontent.com',
            callback: async function(response) {
                console.log('📥 Google SSO response received');
                try {
                    var result = await apiRequest('/api/auth/google', {
                        method: 'POST',
                        body: JSON.stringify({ id_token: response.credential })
                    });
                    if (result.success) {
                        token = result.token; user = result.user;
                        localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user));
                        showUser(user);
                        showToast('✅ Welcome, ' + user.name + '!', 'success');
                        loadDashboard();
                    } else {
                        showToast('❌ ' + result.error, 'error');
                    }
                } catch (error) {
                    showToast('❌ Login failed: ' + error.message, 'error');
                }
            },
            cancel_on_tap_outside: false
        });
        
        google.accounts.id.renderButton(
            document.getElementById('googleBtn'),
            { 
                theme: 'outline', 
                size: 'large', 
                text: 'signin_with', 
                shape: 'pill',
                width: 250
            }
        );
        
        console.log('✅ Google SSO button rendered');
    } catch (error) {
        console.error('❌ Google SSO init error:', error);
    }
}

function showUser(userData) {
    document.getElementById('signinCard').style.display = 'none';
    document.getElementById('dashboardContent').classList.remove('hidden');
    document.getElementById('avatarText').style.display = 'none';
    var img = document.getElementById('avatarImg');
    img.style.display = 'block';
    img.src = userData.picture || '';
    document.getElementById('dropdownName').textContent = userData.name || 'User';
    document.getElementById('dropdownEmail').textContent = userData.email;
    
    loadRefreshSettingsFromDB().then(function() {
        startCountdown();
    });
}

function logoutUser() {
    localStorage.removeItem('token'); localStorage.removeItem('user');
    token = null; user = null;
    document.getElementById('signinCard').style.display = 'block';
    document.getElementById('dashboardContent').classList.add('hidden');
    document.getElementById('avatarText').style.display = 'block';
    document.getElementById('avatarImg').style.display = 'none';
    document.getElementById('userDropdown').classList.remove('active');
    showToast('✅ Signed out', 'success');
    if (currentBleDevice && currentBleDevice.gatt) {
        try { currentBleDevice.gatt.disconnect(); } catch(e) {}
    }
    isConnected = false;
    updateBleStatus('disconnected', '');
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
}

function toggleDropdown() {
    document.getElementById('userDropdown').classList.toggle('active');
}

document.addEventListener('click', function(e) {
    var profile = document.getElementById('userProfile');
    if (!profile.contains(e.target)) {
        document.getElementById('userDropdown').classList.remove('active');
    }
});

function checkSession() {
    if (token && user) { showUser(user); loadDashboard(); }
}

// ===== UI ACTIVE/INACTIVE =====
function setupActivityDetection() {
    document.addEventListener('visibilitychange', function() {
        isUIActive = !document.hidden;
        console.log('📱 UI ' + (isUIActive ? 'ACTIVE' : 'INACTIVE'));
        restartRefreshTimer();
        if (isUIActive) {
            forceRefreshNow();
        }
    });

    var activityTimeout;
    var resetActivity = function() {
        isUIActive = true;
        clearTimeout(activityTimeout);
        activityTimeout = setTimeout(function() {
            isUIActive = false;
            console.log('📱 UI INACTIVE (no user interaction)');
            restartRefreshTimer();
        }, 300000);
    };

    document.addEventListener('mousemove', resetActivity);
    document.addEventListener('keydown', resetActivity);
    document.addEventListener('click', resetActivity);
    document.addEventListener('scroll', resetActivity);
    resetActivity();
}

// ===== DASHBOARD =====
async function loadDashboard() {
    setupActivityDetection();
    await loadDevices();
    autoReconnectBle();
}

// ===== FILTER DEVICES =====
function filterDevices() {
    var query = document.getElementById('searchInput').value.toLowerCase();
    var cards = document.querySelectorAll('.device-card');
    var visibleCount = 0;
    cards.forEach(function(card) {
        var name = card.dataset.name ? card.dataset.name.toLowerCase() : '';
        var id = card.dataset.id ? card.dataset.id.toLowerCase() : '';
        var match = name.indexOf(query) !== -1 || id.indexOf(query) !== -1;
        card.style.display = match ? '' : 'none';
        if (match) visibleCount++;
    });
    document.getElementById('deviceCount').textContent = visibleCount + ' devices shown';
}

// ===== LOAD HUBS FOR DROPDOWN =====
async function loadHubsForDropdown() {
    try {
        var response = await fetch(API_BASE + '/api/hubs', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!response.ok) throw new Error('Failed to load hubs');
        var hubs = await response.json();
        
        var select = document.getElementById('hubSelect');
        select.innerHTML = '<option value="">Select a hub...</option>';
        hubs.forEach(function(hub) {
            select.innerHTML += '<option value="' + hub.hub_id + '">' + 
                (hub.device_name || hub.hub_id) + 
                ' (' + (hub.ip_address || 'offline') + ')' +
                '</option>';
        });
        
        availableHubs = hubs;
        return hubs;
    } catch (error) {
        console.error('Error loading hubs:', error);
        return [];
    }
}

// ==========================================
// HUB SELECT - Auto-populate WiFi credentials
// ==========================================
function onHubSelect() {
    var select = document.getElementById('hubSelect');
    var hubId = select.value;
    
    if (!hubId) {
        document.getElementById('configSSID').value = '';
        document.getElementById('configPassword').value = '';
        return;
    }
    
    // Find the selected hub
    var hub = availableHubs.find(function(d) { 
        return d.hub_id === hubId;
    });
    
    if (hub) {
        // Try to get hub config from server
        fetch(API_BASE + '/api/hubs/' + hubId + '/config', {
            headers: { 'Authorization': 'Bearer ' + token }
        })
        .then(function(response) {
            if (response.ok) return response.json();
            throw new Error('Failed to get hub config');
        })
        .then(function(data) {
            if (data.config && data.config.ssid) {
                document.getElementById('configSSID').value = data.config.ssid || '';
                document.getElementById('configPassword').placeholder = 'Enter WiFi password (auto-filled from hub)';
                showToast('✅ WiFi SSID auto-filled from hub', 'success');
            }
        })
        .catch(function(error) {
            console.error('Error fetching hub config:', error);
        });
    }
}

// ===== LOAD DEVICES =====
async function loadDevices() {
    var grid = document.getElementById('deviceGrid');
    var countEl = document.getElementById('deviceCount');
    
    if (isFirstLoad) {
        grid.innerHTML = '<div class="loading"><div class="spinner"></div>Loading devices...</div>';
    }
    
    try {
        var hubsResponse = await fetch(API_BASE + '/api/hubs', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        var hubs = hubsResponse.ok ? await hubsResponse.json() : [];
        
        var sensorsResponse = await fetch(API_BASE + '/api/sensors', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        var sensors = sensorsResponse.ok ? await sensorsResponse.json() : [];
        
        var allDevices = [];
        
        (hubs || []).forEach(function(hub) {
            hub._type = 'hub';
            allDevices.push(hub);
        });
        
        (sensors || []).forEach(function(sensor) {
            sensor._type = 'sensor';
            allDevices.push(sensor);
        });
        
        allDevices = allDevices;

        var total = allDevices.length;
        var online = allDevices.filter(function(d) { return d.status === 'online'; }).length;
        countEl.textContent = total + ' devices · ' + online + ' online';

        var html = '';

        if (allDevices.length > 0) {
            allDevices.forEach(function(device) {
                var isHub = device._type === 'hub';
                var status = device.status || 'offline';
                var statusClass = status === 'online' ? 'online' : status === 'pairing' ? 'pairing' : 'offline';
                var icon = isHub ? (status === 'online' ? '🌿' : '📡') : '📟';
                var typeLabel = isHub ? 'HUB' : 'SENSOR';
                var typeClass = isHub ? 'hub' : 'sensor';
                var soil = device.soil_moisture || device.latestSoil || '--';
                var ip = device.ip_address || 'No IP';
                var id = device.device_id || device.hub_id;
                var name = device.device_name || device.hub_id || id;
                var hubLink = device.hub_id || 'Not linked';
                var isLinked = device.hub_id && device.hub_id.length > 0;
                
                html += '<div class="device-card" data-name="' + name.toLowerCase() + '" data-id="' + id.toLowerCase() + '">';
                html += '<div class="card-top"><div class="device-icon">' + icon + '</div>';
                html += '<div><span class="badge ' + statusClass + '"><span class="dot"></span> ' + status + '</span>';
                html += '<span class="device-type-badge ' + typeClass + '">' + typeLabel + '</span></div></div>';
                html += '<div class="device-name">' + name + '</div>';
                html += '<div class="device-id">🆔 ' + id + '</div>';
                html += '<div class="device-status"><span class="detail">📡 ' + ip + '</span></div>';
                
                if (!isHub) {
                    html += '<div class="device-details"><span class="detail">🔗 ' + hubLink + '</span></div>';
                }
                
                html += '<div class="device-soil"><span class="value">' + soil + '</span><span class="unit">%</span>';
                html += '<div class="mini-bar"><div class="fill" style="width:' + Math.min(soil, 100) + '%;"></div></div></div>';
                html += '<div class="device-details"><span class="detail">🕐 ' + (device.last_seen ? new Date(device.last_seen).toLocaleTimeString() : 'Never') + '</span></div>';
                html += '<div class="device-actions">';
                html += '<button class="btn btn-secondary btn-sm" onclick="refreshDevice(\'' + id + '\')" title="Refresh status">🔄</button>';
                
                if (isHub) {
                    html += '<button class="btn btn-secondary btn-sm" onclick="openConfig(\'' + id + '\', \'hub\')" title="Configure">⚙️</button>';
                    html += '<button class="btn btn-secondary btn-sm" onclick="rebootHub(\'' + id + '\')" title="Reboot">🔁</button>';
                } else {
                    html += '<button class="btn btn-secondary btn-sm" onclick="openConfig(\'' + id + '\', \'sensor\')" title="Configure">⚙️</button>';
                    if (!isLinked) {
                        html += '<button class="btn btn-warning btn-sm" onclick="linkSensor(\'' + id + '\')" title="Link to Hub">🔗</button>';
                    }
                }
                
                html += '<button class="btn btn-danger btn-sm" onclick="deleteDevice(\'' + id + '\', \'' + device._type + '\')" title="Delete">🗑️</button>';
                html += '</div></div>';
            });
        } else {
            html = '<div class="empty-state" style="grid-column:1/-1;"><div class="icon">🌿</div><div class="title">No devices yet</div><div class="sub">Click "Scan" to discover a hub or sensor via Bluetooth.</div></div>';
        }

        grid.innerHTML = html;
        isFirstLoad = false;

    } catch (error) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#f87171;">❌ ' + (error.message || 'Failed to load devices') + '<br><br><button class="btn btn-secondary btn-sm" onclick="loadDevices()">🔄 Retry</button></div>';
    }
}

// ===== REFRESH SINGLE DEVICE =====
async function refreshDevice(deviceId) {
    showToast('🔄 Checking ' + deviceId + '...', 'warning');
    try {
        await loadDevices();
        showToast('✅ Device status updated', 'success');
    } catch (error) {
        showToast('❌ Error: ' + error.message, 'error');
    }
}

// ===== DELETE DEVICE =====
async function deleteDevice(deviceId, type) {
    if (!confirm('Delete ' + deviceId + '?')) return;
    showToast('🗑️ Deleting...', 'warning');
    try {
        var endpoint = type === 'hub' ? '/api/hubs/' + deviceId : '/api/sensors/' + deviceId;
        var result = await apiRequest(endpoint, { method: 'DELETE' });
        if (result.success) {
            showToast('✅ Device deleted', 'success');
            loadDevices();
        } else {
            showToast('❌ ' + (result.error || 'Failed'), 'error');
        }
    } catch (error) {
        showToast('❌ Error: ' + error.message, 'error');
    }
}

// ==========================================
// SENSOR FUNCTIONS
// ==========================================

// ===== LINK SENSOR TO HUB =====
async function linkSensor(sensorId) {
    try {
        var hubs = await loadHubsForDropdown();
        
        if (hubs.length === 0) {
            showToast('❌ No hubs available to link. Please set up a hub first.', 'error');
            return;
        }
        
        currentConfigDeviceId = sensorId;
        currentDeviceType = 'sensor';
        document.getElementById('configHubId').textContent = sensorId;
        document.getElementById('configHubStatus').textContent = '🔗 Select a hub to link this sensor to';
        document.getElementById('hubSelectGroup').style.display = 'block';
        document.getElementById('configSSID').value = '';
        document.getElementById('configPassword').value = '';
        document.getElementById('configDeviceName').value = sensorId;
        document.getElementById('configSaveBtn').textContent = '🔗 Link & Configure';
        
        // If there's only one hub, auto-select it
        if (hubs.length === 1) {
            document.getElementById('hubSelect').value = hubs[0].hub_id;
            onHubSelect();
        }
        
        openModal('configModal');
        
    } catch (error) {
        showToast('❌ Error: ' + error.message, 'error');
    }
}

function delay(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
}

// ===== SAVE DEVICE CONFIG =====
async function saveDeviceConfig() {
    var deviceId = currentConfigDeviceId;
    var ssid = document.getElementById('configSSID').value.trim();
    var password = document.getElementById('configPassword').value.trim();
    var name = document.getElementById('configDeviceName').value.trim() || deviceId;
    var hubId = document.getElementById('hubSelect').value;
    
    if (!ssid) {
        showToast('❌ WiFi SSID is required', 'error');
        return;
    }
    
    var btn = document.getElementById('configSaveBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending...';
    document.getElementById('configHubStatus').textContent = '📤 Sending config...';
    
    try {
        var encoder = new TextEncoder();
        
        if (currentDeviceType === 'sensor' && hubId) {
            // First, link to hub
            var linkConfig = {
                command: 'link',
                hub_id: hubId
            };
            
            await currentBleCharacteristic.writeValue(encoder.encode(JSON.stringify(linkConfig)));
            await delay(500);
            
            // Then send WiFi config
            var wifiConfig = {
                command: 'configure_wifi',
                ssid: ssid,
                password: password
            };
            await currentBleCharacteristic.writeValue(encoder.encode(JSON.stringify(wifiConfig)));
        } else {
            // Just send WiFi config
            var config = {
                command: 'configure_wifi',
                ssid: ssid,
                password: password
            };
            await currentBleCharacteristic.writeValue(encoder.encode(JSON.stringify(config)));
        }
        
        showToast('✅ Config sent! Device is connecting...', 'success');
        document.getElementById('configHubStatus').textContent = '✅ Sent!';
        
        // Register in cloud
        if (currentDeviceType === 'sensor' && hubId) {
            await apiRequest('/api/sensors/link', {
                method: 'POST',
                body: JSON.stringify({
                    sensor_id: deviceId,
                    hub_id: hubId,
                    ssid: ssid
                })
            });
        }
        
        setTimeout(function() {
            closeModal('configModal');
            loadDevices();
            if (currentBleDevice && currentBleDevice.gatt) { 
                currentBleDevice.gatt.disconnect(); 
            }
            isConnected = false;
            updateBleStatus('disconnected', '');
        }, 2000);
        
    } catch (error) {
        showToast('❌ Failed: ' + error.message, 'error');
    }
    btn.disabled = false; 
    btn.innerHTML = currentDeviceType === 'sensor' && document.getElementById('hubSelect').value ? '🔗 Link & Configure' : '💾 Save';
}

// ==========================================
// SCAN FOR DEVICES
// ==========================================
async function scanForDevices() {
    updateBleStatus('scanning', 'Scanning...');
    showToast('🔍 Scanning for BLE devices...', 'warning');
    
    try {
        if (!navigator.bluetooth) {
            showToast('❌ Web Bluetooth not supported. Use Chrome/Edge.', 'error');
            updateBleStatus('disconnected', '');
            return;
        }
        
        var device = await navigator.bluetooth.requestDevice({
            filters: [
                { services: [BLE_SERVICE_UUID_HUB] },
                { services: [BLE_SERVICE_UUID_SENSOR] }
            ],
            optionalServices: [BLE_SERVICE_UUID_HUB, BLE_SERVICE_UUID_SENSOR]
        });
        
        if (!device) { 
            showToast('❌ No devices found', 'error'); 
            updateBleStatus('disconnected', ''); 
            return; 
        }
        
        await connectBleDevice(device);
        showToast('✅ Connected to ' + (device.name || 'device'), 'success');
        
        var services = await device.gatt.getPrimaryServices();
        var deviceType = 'hub';
        for (var i = 0; i < services.length; i++) {
            if (services[i].uuid === BLE_SERVICE_UUID_SENSOR) {
                deviceType = 'sensor';
                break;
            }
        }
        
        currentDeviceType = deviceType;
        currentConfigDeviceId = device.name || (deviceType === 'hub' ? 'FarmIOT_Hub_001' : 'FarmIOT_Sensor_001');
        document.getElementById('configHubId').textContent = currentConfigDeviceId;
        document.getElementById('configHubStatus').textContent = '📡 Connected via Bluetooth - ' + deviceType.toUpperCase();
        document.getElementById('configSSID').value = '';
        document.getElementById('configPassword').value = '';
        document.getElementById('configDeviceName').value = currentConfigDeviceId;
        document.getElementById('hubSelectGroup').style.display = deviceType === 'sensor' ? 'block' : 'none';
        document.getElementById('configSaveBtn').textContent = deviceType === 'sensor' ? '🔗 Link & Configure' : '💾 Configure';
        
        if (deviceType === 'sensor') {
            var hubs = await loadHubsForDropdown();
            
            // If there's only one hub, auto-select it
            if (hubs.length === 1) {
                document.getElementById('hubSelect').value = hubs[0].hub_id;
                onHubSelect();
            }
        }
        
        openModal('configModal');
        
    } catch (error) {
        updateBleStatus('disconnected', '');
        showToast('❌ Scan failed: ' + error.message, 'error');
    }
}

// ===== BLE FUNCTIONS =====
async function autoReconnectBle() {
    try {
        if (!navigator.bluetooth) return;
        var devices = await navigator.bluetooth.getDevices();
        if (devices.length === 0) { updateBleStatus('disconnected', ''); return; }

        var found = null;
        for (var i = 0; i < devices.length; i++) {
            var d = devices[i];
            try {
                var s = await d.gatt.connect();
                var services = await s.getPrimaryServices();
                for (var j = 0; j < services.length; j++) {
                    if (services[j].uuid === BLE_SERVICE_UUID_HUB || services[j].uuid === BLE_SERVICE_UUID_SENSOR) { 
                        found = d; 
                        break; 
                    }
                }
                if (found) break;
                await d.gatt.disconnect();
            } catch (e) {}
        }

        if (!found) { updateBleStatus('disconnected', ''); return; }
        await connectBleDevice(found);
    } catch (error) {
        updateBleStatus('disconnected', '');
    }
}

async function connectBleDevice(device) {
    try {
        var server = await device.gatt.connect();
        var services = await server.getPrimaryServices();
        var characteristic = null;
        
        for (var i = 0; i < services.length; i++) {
            var svc = services[i];
            if (svc.uuid === BLE_SERVICE_UUID_HUB) {
                characteristic = await svc.getCharacteristic(BLE_CHARACTERISTIC_UUID_HUB);
                break;
            } else if (svc.uuid === BLE_SERVICE_UUID_SENSOR) {
                characteristic = await svc.getCharacteristic(BLE_CHARACTERISTIC_UUID_SENSOR);
                break;
            }
        }
        
        if (!characteristic) {
            throw new Error('No matching characteristic found');
        }
        
        currentBleDevice = device;
        currentBleCharacteristic = characteristic;
        isConnected = true;
        updateBleStatus('connected', device.name || 'Connected');
        return true;
    } catch (error) {
        isConnected = false;
        updateBleStatus('disconnected', '');
        return false;
    }
}

// ===== OPEN CONFIG =====
async function openConfig(deviceId, type) {
    currentConfigDeviceId = deviceId;
    currentDeviceType = type || 'hub';
    document.getElementById('configHubId').textContent = deviceId;
    document.getElementById('configHubStatus').textContent = 'Loading...';
    document.getElementById('configSSID').value = '';
    document.getElementById('configPassword').value = '';
    document.getElementById('configDeviceName').value = deviceId;
    document.getElementById('hubSelectGroup').style.display = type === 'sensor' ? 'block' : 'none';
    document.getElementById('configSaveBtn').textContent = type === 'sensor' ? '🔗 Link & Configure' : '💾 Configure';
    
    if (type === 'sensor') {
        var hubs = await loadHubsForDropdown();
        if (hubs.length === 1) {
            document.getElementById('hubSelect').value = hubs[0].hub_id;
            onHubSelect();
        }
    }
    
    try {
        var endpoint = type === 'hub' ? '/api/hubs/' + deviceId + '/config' : '/api/sensors/' + deviceId + '/config';
        var data = await apiRequest(endpoint);
        if (data.config) {
            document.getElementById('configSSID').value = data.config.ssid || '';
            document.getElementById('configDeviceName').value = data.config.device_name || deviceId;
        }
    } catch (e) {}
    document.getElementById('configHubStatus').textContent = 'Ready';
    openModal('configModal');
}

// ===== REBOOT HUB =====
async function rebootHub(hubId) {
    if (!confirm('Reboot ' + hubId + '?')) return;
    showToast('🔄 Rebooting...', 'warning');
    try {
        var result = await apiRequest('/api/hubs/' + hubId + '/reboot', { method: 'POST' });
        if (result.success) {
            showToast('✅ Reboot command sent', 'success');
            setTimeout(loadDevices, 3000);
        } else {
            showToast('❌ ' + (result.error || 'Failed'), 'error');
        }
    } catch (error) {
        showToast('❌ Error: ' + error.message, 'error');
    }
}

// ===== MODAL =====
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

document.querySelectorAll('.modal').forEach(function(modal) {
    modal.addEventListener('click', function(e) { if (e.target === modal) modal.classList.remove('active'); });
});

// ===== INIT =====
document.addEventListener('DOMContentLoaded', function() {
    console.log('📱 FarmIOT Dashboard loaded');
    setTimeout(function() {
        initGoogleSSO();
    }, 100);
    checkSession();
    setAuthMode('login');
});