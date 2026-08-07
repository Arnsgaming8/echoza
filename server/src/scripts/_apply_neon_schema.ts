import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url) {
    console.error('[apply] DATABASE_URL is not set. Aborting.');
    process.exit(1);
}
const schemaPath = join(process.cwd(), 'src', 'sql', 'neon_schema.sql');
const sql = readFileSync(schemaPath, 'utf8');
const client = new pg.Client({ connectionString: url });
console.log('[apply] connecting to Neon…');
await client.connect();
console.log('[apply] connected. applying schema…');
try {
    await client.query(sql);
    console.log('[apply] schema applied.');
}
catch (err) {
    console.error('[apply] schema application failed:', err instanceof Error ? err.message : err);
    await client.end().catch(() => { });
    process.exit(1);
}
const r = await client.query(`
  SELECT tablename, 'table' AS type FROM pg_tables WHERE schemaname = 'public'
  UNION ALL
  SELECT indexname AS tablename, 'index' AS type FROM pg_indexes WHERE schemaname = 'public'
   AND indexname IN ('idx_one_conversation_per_pair','idx_refresh_user','idx_messages_conv_time')
  ORDER BY type, tablename;
`);
console.log('\n[apply] Neon public schema now contains:');
for (const row of r.rows)
    console.log(`   ${row.type.padEnd(6)} ${row.tablename}`);
await client.end();
console.log('\n[apply] DONE 🎉');
