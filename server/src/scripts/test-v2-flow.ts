const BASE_URL = process.env.BASE_URL || 'https://echoza-5ysd.onrender.com';
let passed = 0;
let failed = 0;
const errors = [];
async function api(path, options = {}) {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    }
    catch {
        json = text;
    }
    return { status: res.status, json, text };
}
function check(name, ok, detail) {
    if (ok) {
        console.log(`  ✅ ${name}`);
        passed++;
    }
    else {
        console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
        failed++;
        errors.push(`${name}: ${detail || 'failed'}`);
    }
}
async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('  v2 Schema Integration Test');
    console.log(`  Target: ${BASE_URL}`);
    console.log('═══════════════════════════════════════════\n');
    console.log('─── 1. Health Check ───');
    const health = await api('/api/health');
    check('Server reachable', health.status === 200, `got ${health.status}`);
    console.log('');
    if (health.status !== 200)
        return;
    console.log('─── 2. DB Status ───');
    const dbStatus = await api('/api/db-status');
    const dbPaused = dbStatus.json?.status === 'paused';
    check('Database not paused', !dbPaused, dbStatus.json?.message);
    if (dbPaused)
        return;
    console.log(`  DB status: ${dbStatus.json?.status}`);
    console.log('');
    const testUsername = `Test_${Date.now().toString(36).replace(/[0-9]/g, (m) => String.fromCharCode(97 + parseInt(m)))}`;
    const testPassword = 'TestPass123!';
    console.log('─── 3. Register User ───');
    const reg = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username: testUsername, password: testPassword }),
    });
    const token = reg.json?.token;
    const refreshToken = reg.json?.refresh_token;
    const userId = reg.json?.user?.id;
    check('Register returns 201', reg.status === 201, reg.json?.error);
    check('Register returns token', !!token);
    check('Register returns user.id', !!userId, reg.json?.user?.id);
    if (token)
        console.log(`  Token: ${token.slice(0, 20)}...`);
    console.log('');
    console.log('─── 4. Get My Profile (auth/me) ───');
    const me = await api('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
    });
    check('auth/me returns 200', me.status === 200, `${me.status}: ${me.json?.error}`);
    check('auth/me has correct username', me.json?.username === testUsername, `got ${me.json?.username}`);
    check('auth/me has id', !!me.json?.id);
    console.log(`  Profile: username="${me.json?.username}" avatar="${me.json?.avatar}"`);
    console.log('');
    console.log('─── 5. Get User Profile (users/me) ───');
    const meAlt = await api('/api/users/me', {
        headers: { Authorization: `Bearer ${token}` },
    });
    check('users/me returns 200', meAlt.status === 200, `${meAlt.status}: ${meAlt.json?.error}`);
    check('users/me has correct username', meAlt.json?.username === testUsername, `got ${meAlt.json?.username}`);
    console.log('');
    console.log('─── 6. Register Second User ───');
    const testUser2 = `User_${Date.now().toString(36).replace(/[0-9]/g, (m) => String.fromCharCode(97 + parseInt(m)))}`;
    const reg2 = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username: testUser2, password: testPassword }),
    });
    const token2 = reg2.json?.token;
    const userId2 = reg2.json?.user?.id;
    check('Register user2 returns 201', reg2.status === 201, reg2.json?.error);
    check('Register user2 returns token', !!token2);
    check('Register user2 has user.id', !!userId2);
    console.log('');
    console.log('─── 7. Search Users ───');
    const searchRes = await api('/api/users/search?q=' + encodeURIComponent(testUser2), {
        headers: { Authorization: `Bearer ${token}` },
    });
    check('Search returns 200', searchRes.status === 200);
    const isArray = Array.isArray(searchRes.json);
    check('Search returns array', isArray, typeof searchRes.json);
    check('Search finds user2', Array.isArray(searchRes.json) && searchRes.json.length > 0, `found ${Array.isArray(searchRes.json) ? searchRes.json.length : 0} users`);
    if (Array.isArray(searchRes.json) && searchRes.json.length > 0) {
        check('Search username matches', searchRes.json[0].username === testUser2, searchRes.json[0].username);
    }
    console.log('');
    console.log('─── 8. Login ───');
    const login1 = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: testUsername, password: testPassword }),
    });
    check('Login returns 200', login1.status === 200, login1.json?.error);
    check('Login returns token', !!login1.json?.token);
    check('Login returns user', !!login1.json?.user?.id);
    check('Login username matches', login1.json?.user?.username === testUsername, login1.json?.user?.username);
    console.log('');
    console.log('─── 9. Token Refresh ───');
    const refreshRes = await api('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const refreshedToken = refreshRes.json?.token || token;
    check('Refresh returns 200', refreshRes.status === 200, `${refreshRes.status}: ${refreshRes.json?.error}`);
    check('Refresh returns token', !!refreshRes.json?.token);
    check('Refresh returns user', !!refreshRes.json?.user?.username, refreshRes.json?.user?.username);
    console.log('');
    console.log('─── 10. List Conversations ───');
    const convs = await api('/api/conversations', {
        headers: { Authorization: `Bearer ${refreshedToken}` },
    });
    check('Conversations returns 200', convs.status === 200, `${convs.status}: ${convs.json?.error}`);
    check('Conversations is array', Array.isArray(convs.json), typeof convs.json);
    check('No conversations for new user', Array.isArray(convs.json) && convs.json.length === 0, `got ${Array.isArray(convs.json) ? convs.json.length : '?'} conversations`);
    console.log('');
    console.log('─── 11. DB Debug (profiles table) ───');
    const debug = await api('/api/debug-db');
    check('Debug returns 200', debug.status === 200, debug.json?.error);
    check('Has profiles', debug.json?.profilesCount > 0, `count=${debug.json?.profilesCount}`);
    check('Has at least 2 profiles', debug.json?.profilesCount >= 2, `count=${debug.json?.profilesCount}`);
    const foundUser = debug.json?.profiles?.some((p) => p.username === testUsername);
    check(`${testUsername} in profiles table`, !!foundUser);
    console.log('\n═══════════════════════════════════════════');
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════');
    if (errors.length > 0) {
        console.log('\n  Failures:');
        for (const err of errors) {
            console.log(`    • ${err}`);
        }
    }
    console.log(`\n  Test users:`);
    console.log(`    - "${testUsername}" / ${testPassword}`);
    console.log(`    - "${testUser2}" / ${testPassword}`);
    console.log('');
}
main().catch(err => {
    console.error('\n  ❌ Script error:', err.message);
    console.log('\n═══════════════════════════════════════════');
});
