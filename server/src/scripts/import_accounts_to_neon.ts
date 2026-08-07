const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !NEON_DATABASE_URL) {
    console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEON_DATABASE_URL');
    process.exit(1);
}
import pg from 'pg';
const neonPool = new pg.Pool({ connectionString: NEON_DATABASE_URL });
async function listSupabaseProfiles() {
    const allRows = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
        const url = `${SUPABASE_URL}/rest/v1/profiles?select=id,username,display_name,avatar,created_at` +
            `&offset=${offset}&limit=${pageSize}`;
        const res = await fetch(url, {
            headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Supabase REST ${res.status}: ${body}`);
        }
        const rows = (await res.json());
        allRows.push(...rows);
        if (rows.length < pageSize)
            break;
        offset += pageSize;
    }
    return allRows;
}
async function main() {
    console.log('Fetching profiles from Supabase REST...');
    const rows = await listSupabaseProfiles();
    console.log(`Found ${rows.length} profile rows.`);
    await neonPool.query('SELECT 1 FROM profiles LIMIT 0').catch((err) => {
        throw new Error(`Neon 'profiles' table missing — did you run server/src/sql/neon_schema.sql? Underlying error: ${err.message}`);
    });
    let inserted = 0;
    let collision = 0;
    let skipped = 0;
    for (const r of rows) {
        if (!r.username || !/^[A-Za-z_]{3,20}$/.test(r.username)) {
            skipped++;
            continue;
        }
        const ins = await neonPool.query(`INSERT INTO profiles (id, username, display_name, avatar, created_at)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))
       ON CONFLICT (id) DO NOTHING
       RETURNING id`, [r.id, r.username, r.display_name || '', r.avatar || '', r.created_at || null]);
        if (ins.rowCount && ins.rowCount > 0)
            inserted++;
        else
            collision++;
    }
    console.log({ inserted, collision, skipped, total: rows.length });
    await neonPool.end();
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
void SUPABASE_URL;
void SUPABASE_SERVICE_ROLE_KEY;
