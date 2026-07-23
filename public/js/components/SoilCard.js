class SoilCard {
    constructor(container) {
        this.container = container;
        this.render();
        this.refresh();
    }
    
    render() {
        this.container.innerHTML = `
            <div class="card">
                <div class="card-header">
                    <h2>💧 Soil Moisture</h2>
                    <span class="badge" id="soilStatus">Loading...</span>
                </div>
                <div class="soil-value" id="soilValue">—</div>
                <div style="color:#6b7280;font-size:14px;" id="soilTime">Waiting for data...</div>
            </div>
        `;
    }
    
    async refresh() {
        try {
            const data = await api.getLatestSoil();
            if (data && data.value) {
                document.getElementById('soilValue').textContent = data.value;
                document.getElementById('soilTime').textContent = 'Updated: ' + new Date(data.timestamp).toLocaleTimeString();
                document.getElementById('soilStatus').textContent = 'Online';
                document.getElementById('soilStatus').className = 'badge online';
            }
        } catch (error) {
            document.getElementById('soilStatus').textContent = 'Offline';
            document.getElementById('soilStatus').className = 'badge offline';
        }
    }
}