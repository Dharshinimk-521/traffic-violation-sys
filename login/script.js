const SUPABASE_URL = 'https://abqfmubaxsglxncfriqt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFicWZtdWJheHNnbHhuY2ZyaXF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjI4MzAsImV4cCI6MjA4OTkzODgzMH0.eM6OgHv8scmYGNhWqrxeDFWrgA_HeUu0oMj-VjE5tXg';
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

//login part : checks the supabase user_roles table and then redirects after authentication
async function handleLogin() {
const email = document.getElementById('email').value.trim();
const password = document.getElementById('password').value.trim();
const err = document.getElementById('error-msg');
const btn = document.getElementById('login-btn');

if (!email || !password) {
    err.textContent = 'Please fill in all fields.';
    err.classList.add('show');
    return;
}

btn.disabled = true;
btn.textContent = 'Authenticating...';
err.classList.remove('show');

try {
    // 1. Sign in with Supabase Auth
    const { data: authData, error: authErr } = await sb.auth.signInWithPassword({ email, password });
    if (authErr) throw new Error(authErr.message);

    // 2. Fetch role from user_roles table
    const { data: roleData, error: roleErr } = await sb
    .from('user_roles')
    .select('role, full_name, badge_number')
    .eq('id', authData.user.id)
    .single();

    if (roleErr || !roleData) throw new Error('No role assigned. Contact admin.');

    // 3. Store session info
    sessionStorage.setItem('tg_role', roleData.role);
    sessionStorage.setItem('tg_user', email);
    sessionStorage.setItem('tg_name', roleData.full_name || 'Officer');
    sessionStorage.setItem('tg_badge', roleData.badge_number || '');

    // 4. Redirect based on role
    if (roleData.role === 'admin') {
    window.location.href = '../admin.html';
    } else {
    window.location.href = '../officer/officer.html';
    }

} catch (e) {
    err.textContent = e.message || 'Login failed. Please try again.';
    err.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Access Portal →';
}
}

//if forgot password then supabase resends the mail 
async function sendResetEmail() {
const email = document.getElementById('reset-email').value.trim();
const err = document.getElementById('reset-error');
const success = document.getElementById('reset-success');

if (!email || !email.includes('@')) {
    err.textContent = 'Please enter a valid email.';
    err.classList.add('show');
    return;
}
err.classList.remove('show');

const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset-password.html'
});

if (error) {
    err.textContent = error.message;
    err.classList.add('show');
} else {
    success.classList.add('show');
}
}

function openForgotModal() {
document.getElementById('forgot-modal').classList.add('open');
}
function closeForgotModal() {
document.getElementById('forgot-modal').classList.remove('open');
document.getElementById('reset-success').classList.remove('show');
document.getElementById('reset-error').classList.remove('show');
document.getElementById('reset-email').value = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

// If already logged in, redirect
(async () => {
const { data: { session } } = await sb.auth.getSession();
if (session) {
    const role = sessionStorage.getItem('tg_role');
    window.location.href = role === 'admin' ? '../admin.html' : '../officer/officer.html';
}
})();