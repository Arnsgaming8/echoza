import pg from 'pg';
const { Pool } = pg;
const PROJECT_REF = 'cekfrmgiecswlioflmip';
const PASSWORD = 'Echoza2024!';
const REGION = 'us-east-1';
const sql = `
ALTER TABLE public.conversations 
  ADD COLUMN IF NOT EXISTS group_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS group_avatar TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_message TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_time TIMESTAMPTZ DEFAULT NULL;
`;
async function tryConnect(connectionString, label) {
    const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
    try {
        const client = await pool.connect();
        console.log(`✅ Connected via ${label}`);
        console.log('Running migration SQL...');
        await client.query(sql);
        console.log('✅ ALTER TABLE completed successfully');
        const { rows } = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'conversations'
        AND column_name IN ('group_name', 'group_avatar', 'last_message', 'last_time')
      ORDER BY column_name;
    `);
        if (rows.length === 4) {
            console.log('\n✅ All 4 columns verified in information_schema:');
            rows.forEach(r => console.log(`   - ${r.column_name} (${r.data_type}) default: ${r.column_default || 'none'}`));
        }
        else {
            console.log(`\n⚠️ Only found ${rows.length}/4 columns:`);
            rows.forEach(r => console.log(`   - ${r.column_name}`));
        }
        client.release();
        await pool.end();
        return true;
    }
    catch (err) {
        console.log(`❌ ${label} failed: ${err.message}`);
        await pool.end().catch(() => { });
        return false;
    }
}
async function main() {
    console.log('=== Supabase Migration: Add missing columns to conversations ===\n');
    const directUrl = `postgresql:
    if (await tryConnect(directUrl, 'direct connection')) {
        return;
    }
    const sessionPoolerUrl = `postgresql://postgres.${PROJECT_REF}:${PASSWORD}@aws-0-${REGION}.pooler.supabase.com:5432/postgres`;
    if (await tryConnect(sessionPoolerUrl, 'session pooler')) {
        return;
    }
    const txPoolerUrl = `postgresql:
    if (await tryConnect(txPoolerUrl, 'transaction pooler')) {
        return;
    }
    console.log('\n❌ All connection methods failed.');
    console.log('Please check:');
    console.log('  1. The database password is correct');
    console.log('  2. The project ref is correct');
    console.log('  3. IP allowlist in Supabase dashboard allows connections');
    process.exit(1);
}
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
