// ==========================================
// FarmIOT Dashboard JavaScript
// ==========================================

const API_BASE = window.location.origin;
let token = localStorage.getItem('token') || null;
let user = JSON.parse(localStorage.getItem('user') || 'null');
let authMode = 'login';
let currentConfigHubId = null;
let currentBleDevice = null;
let currentBleCharacteristic = null;
let isConnected = false;
let isFirstLoad = true;
let allDevices = [];
let isUIActive = true;
let refreshCountdown = 0;
let countdownInterval = null;

const BLE_SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const BLE_CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

// ===== TOAST =====
function showToast(message, type) {
    if (!type) type = 'success';
    const toast = document.getElementById('toast');
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
    var mins = Math.floor(seconds / 60);
    var secs = seconds % 60;
    var display = mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';
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

function initGoogleSSO() {
    google.accounts.id.initialize({
        client_id: '472048491207-hofjvaisdj9vnaglutb9kd23ci948jc5.apps.googleusercontent.com',
        callback: async function(response) {
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
                } else showToast('❌ ' + result.error, 'error');
            } catch (error) { showToast('❌ Login failed: ' + error.message, 'error'); }
        }
    });
    google.accounts.id.renderButton(document.getElementById('googleBtn'),
        { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' }
    );
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

// ===== LOAD DEVICES =====
async function loadDevices() {
    var grid = document.getElementById('deviceGrid');
    var countEl = document.getElementById('deviceCount');
    
    if (isFirstLoad) {
        grid.innerHTML = '<div class="loading"><div class="spinner"></div>Loading devices...</div>';
    }
    
    try {
        var response = await fetch(API_BASE + '/api/hubs', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!response.ok) throw new Error('Failed to load devices');
        var hubs = await response.json();
        allDevices = hubs;

        var claimed = hubs.filter(function(h) { return h.user_id === user.id || h.user_id === user.email; });
        var unclaimed = hubs.filter(function(h) { return h.user_id === null && h.status === 'online'; });

        var total = claimed.length + unclaimed.length;
        var online = hubs.filter(function(h) { return h.status === 'online'; }).length;
        countEl.textContent = total + ' devices · ' + online + ' online';

        var html = '';

        if (claimed.length > 0) {
            claimed.forEach(function(hub) {
                var status = hub.status || 'offline';
                var statusClass = status === 'online' ? 'online' : status === 'pairing' ? 'pairing' : 'offline';
                var icon = status === 'online' ? '🌿' : '📡';
                var soil = hub.soil_moisture || '--';
                var ip = hub.ip_address || 'No IP';
                var id = hub.hub_id;
                var name = hub.device_name || hub.hub_id;
                
                html += '<div class="device-card" data-name="' + name.toLowerCase() + '" data-id="' + id.toLowerCase() + '">';
                html += '<div class="card-top"><div class="device-icon">' + icon + '</div>';
                html += '<div><span class="badge ' + statusClass + '"><span class="dot"></span> ' + status + '</span></div></div>';
                html += '<div class="device-name">' + name + '</div>';
                html += '<div class="device-id">🆔 ' + id + '</div>';
                html += '<div class="device-status"><span class="detail">📡 ' + ip + '</span></div>';
                html += '<div class="device-soil"><span class="value">' + soil + '</span><span class="unit">%</span>';
                html += '<div class="mini-bar"><div class="fill" style="width:' + Math.min(soil, 100) + '%;"></div></div></div>';
                html += '<div class="device-details"><span class="detail">🕐 ' + (hub.last_seen ? new Date(hub.last_seen).toLocaleTimeString() : 'Never') + '</span></div>';
                html += '<div class="device-actions">';
                html += '<button class="btn btn-secondary btn-sm" onclick="refreshDevice(\'' + id + '\')" title="Refresh status">🔄</button>';
                html += '<button class="btn btn-secondary btn-sm" onclick="openConfig(\'' + id + '\')" title="Configure">⚙️</button>';
                html += '<button class="btn btn-secondary btn-sm" onclick="rebootHub(\'' + id + '\')" title="Reboot">🔁</button>';
                html += '<button class="btn btn-danger btn-sm" onclick="deleteHub(\'' + id + '\')" title="Delete">🗑️</button>';
                html += '</div></div>';
            });
        }

        if (unclaimed.length > 0) {
            html += '<div style="grid-column:1/-1;padding:8px 0 4px;font-size:12px;color:#6b7280;border-top:1px solid rgba(255,255,255,0.06);">🔍 Discovered (Click to Claim)</div>';
            unclaimed.forEach(function(hub) {
                html += '<div class="discovered-card" style="grid-column:1/-1;">';
                html += '<div class="info"><span class="icon">📡</span>';
                html += '<div><div style="font-weight:600;">' + (hub.device_name || hub.hub_id) + '</div>';
                html += '<div style="font-size:11px;color:#6b7280;">' + (hub.ip_address || 'No IP') + ' · <span class="badge online"><span class="dot"></span> online</span></div></div></div>';
                html += '<button class="btn btn-success btn-sm" onclick="claimHub(\'' + hub.hub_id + '\')">📥 Claim</button>';
                html += '</div>';
            });
        }

        if (!html) {
            html = '<div class="empty-state" style="grid-column:1/-1;"><div class="icon">🌿</div><div class="title">No devices yet</div><div class="sub">Set up your ESP32 hub and it will appear here automatically.</div></div>';
        }

        grid.innerHTML = html;
        isFirstLoad = false;

    } catch (error) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#f87171;">❌ ' + (error.message || 'Failed to load devices') + '<br><br><button class="btn btn-secondary btn-sm" onclick="loadDevices()">🔄 Retry</button></div>';
    }
}

// ===== REFRESH SINGLE DEVICE =====
async function refreshDevice(hubId) {
    showToast('🔄 Checking ' + hubId + '...', 'warning');
    try {
        await loadDevices();
        showToast('✅ Device status updated', 'success');
    } catch (error) {
        showToast('❌ Error: ' + error.message, 'error');
    }
}

// ===== CLAIM HUB =====
async function claimHub(hubId) {
    showToast('📥 Claiming hub...', 'warning');
    try {
        var result = await apiRequest('/api/hubs/claim', {
            method: 'POST',
            body: JSON.stringify({ hub_id: hubId })
        });
        if (result.success) {
            showToast('✅ Hub claimed!', 'success');
            loadDevices();
        } else {
            showToast('❌ ' + (result.error || 'Failed'), 'error');
        }
    } catch (error) {
        showToast('❌ Error: ' + error.message, 'error');
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
                    if (services[j].uuid === BLE_SERVICE_UUID) { found = d; break; }
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
        var service = await server.getPrimaryService(BLE_SERVICE_UUID);
        var characteristic = await service.getCharacteristic(BLE_CHARACTERISTIC_UUID);
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

async function scanForHubs() {
    updateBleStatus('scanning', 'Scanning...');
    showToast('🔍 Scanning for BLE hubs...', 'warning');
    try {
        if (!navigator.bluetooth) {
            showToast('❌ Web Bluetooth not supported. Use Chrome/Edge.', 'error');
            updateBleStatus('disconnected', '');
            return;
        }
        var device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [BLE_SERVICE_UUID] }],
            optionalServices: [BLE_SERVICE_UUID]
        });
        if (!device) { showToast('❌ No devices found', 'error'); updateBleStatus('disconnected', ''); return; }
        await connectBleDevice(device);
        showToast('✅ Connected to ' + (device.name || 'device'), 'success');
        currentConfigHubId = device.name || 'FarmIOT_Hub_001';
        document.getElementById('configHubId').textContent = currentConfigHubId;
        document.getElementById('configHubStatus').textContent = '📡 Connected via Bluetooth';
        document.getElementById('configSSID').value = '';
        document.getElementById('configPassword').value = '';
        document.getElementById('configDeviceName').value = currentConfigHubId;
        openModal('configModal');
    } catch (error) {
        updateBleStatus('disconnected', '');
        showToast('❌ Scan failed: ' + error.message, 'error');
    }
}

// ===== CONFIG =====
async function saveConfig() {
    var ssid = document.getElementById('configSSID').value.trim();
    var password = document.getElementById('configPassword').value.trim();
    if (!ssid || !password) {
        showToast('❌ WiFi SSID and Password required', 'error');
        return;
    }

    var btn = document.getElementById('configSaveBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending...';
    document.getElementById('configHubStatus').textContent = '📤 Sending...';

    try {
        var config = { ssid: ssid, password: password };
        var encoder = new TextEncoder();
        await currentBleCharacteristic.writeValue(encoder.encode(JSON.stringify(config)));
        showToast('✅ Config sent! ESP32 is connecting...', 'success');
        document.getElementById('configHubStatus').textContent = '✅ Sent!';
        setTimeout(function() {
            closeModal('configModal');
            loadDevices();
            if (currentBleDevice && currentBleDevice.gatt) { currentBleDevice.gatt.disconnect(); }
            isConnected = false;
            updateBleStatus('disconnected', '');
        }, 2000);
    } catch (error) {
        showToast('❌ Failed: ' + error.message, 'error');
    }
    btn.disabled = false; btn.innerHTML = '💾 Save';
}

async function openConfig(hubId) {
    currentConfigHubId = hubId;
    document.getElementById('configHubId').textContent = hubId;
    document.getElementById('configHubStatus').textContent = 'Loading...';
    document.getElementById('configSSID').value = '';
    document.getElementById('configPassword').value = '';
    document.getElementById('configDeviceName').value = hubId;

    try {
        var data = await apiRequest('/api/hubs/' + hubId + '/config');
        if (data.config) {
            document.getElementById('configSSID').value = data.config.ssid || '';
            document.getElementById('configDeviceName').value = data.config.device_name || hubId;
        }
    } catch (e) {}
    document.getElementById('configHubStatus').textContent = 'Ready';
    openModal('configModal');
}

// ===== HUB MANAGEMENT =====
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

async function deleteHub(hubId) {
    if (!confirm('Delete ' + hubId + '?')) return;
    showToast('🗑️ Deleting...', 'warning');
    try {
        var result = await apiRequest('/api/hubs/' + hubId, { method: 'DELETE' });
        if (result.success) {
            showToast('✅ Hub deleted', 'success');
            loadDevices();
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
    initGoogleSSO();
    checkSession();
    setAuthMode('login');
});