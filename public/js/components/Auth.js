class AuthComponent {
    constructor(container, onLogin) {
        this.container = container;
        this.onLogin = onLogin;
        this.render();
        this.initGoogle();
        this.checkSession();
    }
    
    render() {
        this.container.innerHTML = `
            <div class="card auth-card" id="signinCard">
                <h2>🚜 Welcome to FarmIOT</h2>
                <p>Sign in with your Google account to continue</p>
                <div id="googleBtn"></div>
            </div>
            <div class="card user-card hidden" id="userCard">
                <img id="userPic" src="" alt="Profile">
                <div class="name" id="userName">User</div>
                <div class="email" id="userEmail">user@example.com</div>
                <button class="btn btn-danger" id="logoutBtn">Sign Out</button>
            </div>
        `;
    }
    
    initGoogle() {
        google.accounts.id.initialize({
            client_id: '472048491207-hofjvaisdj9vnaglutb9kd23ci948jc5.apps.googleusercontent.com',
            callback: async (response) => {
                const result = await api.googleLogin(response.credential);
                if (result.success) {
                    localStorage.setItem('token', result.token);
                    localStorage.setItem('user', JSON.stringify(result.user));
                    this.showUser(result.user);
                    this.onLogin(result.user);
                    showToast('✅ Welcome, ' + result.user.name + '!');
                } else {
                    showToast('❌ ' + result.error, 'error');
                }
            },
            cancel_on_tap_outside: false,
        });
        
        google.accounts.id.renderButton(
            document.getElementById('googleBtn'),
            {
                theme: 'outline',
                size: 'large',
                text: 'signin_with',
                shape: 'pill',
                logo_alignment: 'left'
            }
        );
    }
    
    showUser(user) {
        document.getElementById('signinCard').classList.add('hidden');
        document.getElementById('userCard').classList.remove('hidden');
        document.getElementById('userPic').src = user.picture || '';
        document.getElementById('userName').textContent = user.name || user.email;
        document.getElementById('userEmail').textContent = user.email;
        
        document.getElementById('logoutBtn').onclick = () => {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            document.getElementById('signinCard').classList.remove('hidden');
            document.getElementById('userCard').classList.add('hidden');
            showToast('✅ Signed out');
            window.location.reload();
        };
    }
    
    checkSession() {
        const user = JSON.parse(localStorage.getItem('user') || 'null');
        const token = localStorage.getItem('token');
        if (token && user) {
            this.showUser(user);
            this.onLogin(user);
        }
    }
}