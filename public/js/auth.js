const Auth = (function() {
    let currentUser = null;
    let token = localStorage.getItem('token');

    async function refreshProfile() {
        if (!token) return null;
        const res = await fetch('/api/user/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Unable to load profile');
        currentUser = await res.json();
        updateUserStatus();
        return currentUser;
    }

    async function login() {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (data.token) {
                localStorage.setItem('token', data.token);
                token = data.token;
                currentUser = data.user;
                await refreshProfile();
                document.getElementById('auth-overlay').style.display = 'none';
                await Game.fetchUnits();
                Game.checkActiveSession();
            } else {
                alert(data.message || 'Login failed');
            }
        } catch (err) {
            alert('Cannot reach the server. Please try again.');
        }
    }

    async function register() {
        const username = document.getElementById('reg-username').value.trim();
        const password = document.getElementById('reg-password').value;
        const confirm = document.getElementById('reg-password-confirm').value;

        if (!username || !password) {
            alert('Please fill in all fields');
            return;
        }

        if (password !== confirm) {
            alert('Passwords do not match');
            return;
        }

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (res.ok) {
                alert('Registered successfully! Please login.');
                toggleForm('login');
            } else {
                alert(data.message || 'Registration failed');
            }
        } catch (err) {
            alert('Cannot reach the server. Please try again.');
        }
    }

    function toggleForm(type) {
        const loginForm = document.getElementById('login-form');
        const regForm = document.getElementById('register-form');
        const title = document.getElementById('auth-title');
        const tabs = document.querySelectorAll('[data-auth-tab]');

        if (type === 'register') {
            loginForm.style.display = 'none';
            regForm.style.display = 'block';
            title.innerText = 'Commander Registration';
        } else {
            loginForm.style.display = 'block';
            regForm.style.display = 'none';
            title.innerText = 'Commander Login';
        }

        tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.authTab === type));
    }

    function showForm(type) {
        document.getElementById('auth-overlay').style.display = 'flex';
        toggleForm(type);
    }

    async function checkSession() {
        console.log("Checking session. Token:", token);
        try {
            if (!token) {
                console.log("No token, showing auth overlay.");
                document.getElementById('auth-overlay').style.display = 'flex';
                return;
            }
            const res = await fetch('/api/user/profile', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            console.log("Profile response:", res.status);
            if (res.ok) {
                currentUser = await res.json();
                document.getElementById('auth-overlay').style.display = 'none';
                updateUserStatus();
                await Game.fetchUnits();
                Game.checkActiveSession();
            } else {
                console.log("Profile invalid, clearing token and showing auth overlay.");
                localStorage.removeItem('token');
                token = null;
                currentUser = null;
                document.getElementById('auth-overlay').style.display = 'flex';
            }
        } catch (err) {
            console.error("Session check failed", err);
            document.getElementById('auth-overlay').style.display = 'flex';
        }
    }

    function updateUserStatus() {
        const info = document.getElementById('user-info-text');
        const setupAdminWrap = document.getElementById('admin-setup-btn-wrap');
        const pauseBtn = document.getElementById('pause-btn');
        const authNavBtns = document.getElementById('auth-nav-btns');
        
        if (!info || !currentUser) {
            if (authNavBtns) authNavBtns.style.display = 'flex';
            return;
        }
        
        if (authNavBtns) authNavBtns.style.display = 'none';

        const adminBtnHtml = currentUser.role === 0 ? `<button type="button" onclick="Admin.show()" class="admin-badge">Admin</button>` : '';
        const adminSetupBtnHtml = currentUser.role === 0 ? `<button class="buy-btn secondary-btn setup-small-btn" onclick="Admin.show()">Admin Console</button>` : '';

        info.innerHTML = `
            <span class="status-chip">Commander <strong>${escapeHtml(currentUser.username)}</strong></span>
            ${adminBtnHtml}
            <span class="status-chip">Gold ${currentUser.gold}</span>
            <span class="status-chip">Record ${currentUser.wins}W / ${currentUser.losses}L</span>
            <button type="button" class="buy-btn compact-btn ghost-btn" onclick="Auth.logout()">Logout</button>
        `;

        if (setupAdminWrap) setupAdminWrap.innerHTML = adminSetupBtnHtml;
        if (pauseBtn) pauseBtn.style.display = 'block';
    }

    function logout() {
        localStorage.removeItem('token');
        location.reload();
    }

    function setUser(user) {
        currentUser = user;
        updateUserStatus();
    }

    return { login, register, toggleForm, showForm, checkSession, logout, refreshProfile, setUser, getToken: () => token, getUser: () => currentUser };
})();

