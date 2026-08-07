import pg from 'pg';
async function checkNeon() {
    const url = process.env.DATABASE_URL;
    if (!url)
        throw new Error('DATABASE_URL required');
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    const r = await c.query(`SELECT id::text, username, display_name,
            LEFT(avatar, 40) AS avatar_prefix,
            password_hash IS NULL AS pw_hash_null,
            created_at
       FROM profiles
       ORDER BY created_at`);
    await c.end();
    return r.rows;
}
async function checkSupabase() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
        throw new Error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required');
    const r = await fetch(`${url}/rest/v1/profiles?select=id,username,display_name,avatar`, {
        headers: { apikey: key, Authorization: 'Bearer ' + key },
    });
    if (!r.ok)
        throw new Error(`supabase ${r.status}: ${await r.text()}`);
    return (await r.json());
}
async function main() {
    console.log('=== Neon profiles (post-import) ===');
    const neon = await checkNeon();
    console.log('rowCount:', neon.length);
    console.table(neon);
    console.log('\n=== Supabase profiles (live) ===');
    const supa = await checkSupabase();
    console.log('rowCount:', supa.length);
    console.table(supa.map((x) => ({
        id: x.id,
        username: x.username,
        display_name: x.display_name ?? '',
        avatar_prefix: (x.avatar ?? '').slice(0, 40),
        would_be_inserted: /^[A-Za-z_]{3,20}$/.test(x.username ?? ''),
    })));
    const neonIds = new Set(neon.map((r) => r.id));
    const supaIds = new Set(supa.map((r) => r.id));
    const onlySupa = supa.filter((r) => !neonIds.has(r.id));
    console.log('\n=== diff ===');
    console.log(`in supabase but NOT in neon: ${onlySupa.length}`);
    if (onlySupa.length)
        console.table(onlySupa.map((x) => ({ id: x.id, username: x.username })));
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
