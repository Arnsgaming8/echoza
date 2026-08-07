import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url) {
    console.error('[cleanup] DATABASE_URL is not set. Aborting.');
    process.exit(1);
}
const client = new pg.Client({ connectionString: url });
async function count() {
    const r = await client.query(`
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE expires_at < NOW())::text AS expired,
      COUNT(*) FILTER (WHERE expires_at >= NOW())::text AS active
    FROM refresh_tokens
  `);
    const row = r.rows[0];
    return {
        total: parseInt(row.total, 10),
        expired: parseInt(row.expired, 10),
        active: parseInt(row.active, 10),
    };
}
console.log('[cleanup] connecting to Neon…');
await client.connect();
const before = await count();
console.log(`[cleanup] BEFORE — total: ${before.total} | expired: ${before.expired} | active: ${before.active}`);
if (before.expired === 0) {
    console.log('[cleanup] nothing to delete. exiting.');
    await client.end();
    process.exit(0);
}
const del = await client.query(`DELETE FROM refresh_tokens WHERE expires_at < NOW()`);
const deleted = del.rowCount ?? 0;
const after = await count();
console.log(`[cleanup] DELETED: ${deleted}`);
console.log(`[cleanup] AFTER  — total: ${after.total} | expired: ${after.expired} | active: ${after.active}`);
console.log('[cleanup] DONE 🎉');
await client.end();
