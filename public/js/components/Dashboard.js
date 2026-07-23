class Dashboard {
    constructor(container) {
        this.container = container;
        this.render();
        this.initComponents();
    }
    
    render() {
        this.container.innerHTML = `
            <div class="header">
                <div>
                    <h1>🚜 FarmIOT</h1>
                    <div class="subtitle">Smart Agriculture Platform</div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <span id="userBadge" style="color:#6b7280;font-size:14px;"></span>
                </div>
            </div>
            <div id="authContainer"></div>
            <div id="dashboardContent" class="hidden">
                <div id="soilContainer"></div>
                <div id="hubsContainer"></div>
            </div>
        `;
    }
    
    initComponents() {
        this.auth = new AuthComponent(
            document.getElementById('authContainer'),
            (user) => {
                document.getElementById('dashboardContent').classList.remove('hidden');
                document.getElementById('userBadge').textContent = '👋 ' + user.name;
                this.loadDashboard();
            }
        );
    }
    
    loadDashboard() {
        this.soilCard = new SoilCard(document.getElementById('soilContainer'));
        this.hubList = new HubList(document.getElementById('hubsContainer'));
        
        // Refresh soil data every 30 seconds
        setInterval(() => {
            if (this.soilCard) this.soilCard.refresh();
        }, 30000);
    }
}