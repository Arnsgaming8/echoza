import pg from 'pg';
const conn = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_3oIGjm1MDfZr@ep-solitary-violet-at50sbq6-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const pool = new pg.Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  try {
    console.log('=== TEST A: CTE cleanup WITHOUT keepEndpoint ===');
    const r1 = await pool.query(
      `WITH deleted AS (
         DELETE FROM push_subscriptions WHERE user_id = $1 RETURNING 1
       )
       SELECT COUNT(*)::int AS deleted_count FROM deleted`,
      [TEST_USER_ID]
    );
    console.log('A result:', r1.rows);

    console.log('=== TEST B: plain DELETE without CTE ===');
    const r2 = await pool.query(
      `DELETE FROM push_subscriptions WHERE user_id = $1`,
      [TEST_USER_ID]
    );
    console.log('B rowCount:', r2.rowCount);

    console.log('=== TEST C: CTE cleanup WITH keepEndpoint ===');
    const r3 = await pool.query(
      `WITH deleted AS (
         DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint <> $2 RETURNING 1
       )
       SELECT COUNT(*)::int AS deleted_count FROM deleted`,
      [TEST_USER_ID, 'https://example.com/nonexistent']
    );
    console.log('C result:', r3.rows);
  } catch (e: any) {
    console.error('PG ERROR:', e.message);
    console.error('SQLSTATE:', e.code);
    console.error('position:', e.position);
    console.error('hint:', e.hint);
  } finally {
    await pool.end();
  }
}
main();
