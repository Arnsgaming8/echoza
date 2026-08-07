import { io as createSocket } from 'socket.io-client';
const BASE_URL = process.env.BASE_URL || 'https://echoza-5ysd.onrender.com';
async function main() {
    console.log('Testing Socket.IO connection to:', BASE_URL);
    const health = await fetch(BASE_URL + '/api/health');
    const healthJson = await health.json();
    console.log('Health check:', health.status, JSON.stringify(healthJson));
    const loginRes = await fetch(BASE_URL + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Arnav_The_Dev', password: 'St@yAwe$0me' }),
    });
    const loginJson = await loginRes.json();
    console.log('Login status:', loginRes.status);
    console.log('Has token:', !!loginJson.token);
    if (!loginJson.token) {
        console.log('Could not get token. Trying to register...');
        const ts = Date.now().toString(36).replace(/[0-9]/g, (m) => String.fromCharCode(97 + parseInt(m)));
        const reg = await fetch(BASE_URL + '/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: `Diag_${ts}`, password: 'TestPass123!' }),
        });
        const regJson = await reg.json();
        console.log('Register status:', reg.status, 'Has token:', !!regJson.token);
        if (!regJson.token) {
            console.log('Cannot proceed without auth token');
            return;
        }
        loginJson.token = regJson.token;
    }
    console.log('\nAttempting Socket.IO connection...');
    const socket = createSocket(BASE_URL, {
        auth: { token: loginJson.token },
        transports: ['polling', 'websocket'],
        timeout: 15000,
    });
    let connected = false;
    socket.on('connect', () => {
        console.log('✅ Socket connected! ID:', socket.id);
        connected = true;
    });
    socket.on('connect_error', (err) => {
        console.log('❌ Connection error:', err.message);
        if (err.description)
            console.log('  Description:', err.description);
        if (err.type)
            console.log('  Type:', err.type);
    });
    socket.on('error', (err) => {
        console.log('Socket error:', err?.message || err);
    });
    socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
    });
    socket.on('online-users', (data) => {
        console.log('📡 Received online-users:', JSON.stringify(data).slice(0, 100));
    });
    for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (connected) {
            console.log('Connected after', i + 1, 'seconds');
            break;
        }
        if (i === 10)
            console.log('Still waiting... (10s)');
        if (i === 20)
            console.log('Still waiting... (20s)');
    }
    if (!connected) {
        console.log('\n❌ Never connected after 30 seconds');
        console.log('Checking if socket URL resolves...');
        try {
            const ping = await fetch(BASE_URL + '/socket.io/?EIO=4&transport=polling');
            const text = await ping.text();
            console.log('Socket.IO polling response:', text.slice(0, 200));
        }
        catch (err) {
            console.log('Socket.IO polling failed:', err.message);
        }
    }
    socket.disconnect();
    console.log('\nDone');
}
main().catch(err => console.error('Fatal error:', err));
