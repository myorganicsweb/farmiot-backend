const API_BASE = window.location.origin;

class ApiClient {
    constructor() {
        this.token = localStorage.getItem('token');
    }
    
    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers
        });
        
        return response.json();
    }
    
    async googleLogin(id_token) {
        return this.request('/api/auth/google', {
            method: 'POST',
            body: JSON.stringify({ id_token })
        });
    }
    
    async getHubs() {
        return this.request('/api/hubs');
    }
    
    async discoverHubs() {
        return this.request('/api/hubs/discover');
    }
    
    async getConfig(hubId) {
        return this.request(`/api/hubs/${hubId}/config`);
    }
    
    async saveConfig(hubId, config) {
        return this.request(`/api/hubs/${hubId}/config`, {
            method: 'POST',
            body: JSON.stringify(config)
        });
    }
    
    async getLatestSoil() {
        return this.request('/api/devices/soil/latest');
    }
}

const api = new ApiClient();