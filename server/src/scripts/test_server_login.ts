async function main() {
    const accounts = [
        { username: 'Emersyn', password: 'password123' },
        { username: 'Steph', password: 'steph@3467' },
        { username: 'Colin', password: 'password123' },
        { username: 'Scribble', password: 'password123' },
        { username: 'Vanra', password: 'password123' },
        { username: 'Ajuu', password: 'password123' },
        { username: 'Arnav_The_Dev', password: 'admin1234' },
    ];
    for (const { username, password } of accounts) {
        try {
            const res = await fetch('https://echoza-5ysd.onrender.com/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json();
            console.log(`${username}: ${res.ok ? 'OK' : 'FAIL - ' + (data.error || res.status)}`);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`${username}: ERROR - ${msg}`);
        }
    }
}
main().catch(e => {
    console.error('Unexpected error:', e);
    process.exit(1);
});
export {};
