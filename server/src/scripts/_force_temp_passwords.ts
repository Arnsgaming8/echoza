import bcrypt from 'bcryptjs';
import pg from 'pg';
const TEMP_PASSWORD = 'EchozaMigrateTemp2026';
const BCRYPT_COST = 10;
const FORCE = process.env.FORCE === 'true';
const url = process.env.DATABASE_URL;
if (!url) {
    console.error('[force-pw] DATABASE_URL is not set. Aborting.');
    process.exit(1);
}
const client = new pg.Client({ connectionString: url });
console.log('[force-pw] connecting to Neon…');
await client.connect();
console.log(`[force-pw] bcrypting temp password (cost ${BCRYPT_COST})…`);
const tempHash = bcrypt.hashSync(TEMP_PASSWORD, BCRYPT_COST);
const sql = FORCE
    ? `UPDATE profiles
       SET password_hash = $1
     RETURNING id::text, username, last_sign_in_at`
    : `UPDATE profiles
       SET password_hash = $1
     WHERE password_hash IS NULL
     RETURNING id::text, username, last_sign_in_at`;
const r = await client.query(sql, [tempHash]);
console.log(`[force-pw] ${FORCE ? 'OVERWRITE: ' : ''}${r.rowCount} profiles updated.`);
console.log('\n  updated profiles:');
console.table(r.rows);
const unmigrated = await client.query(`SELECT username FROM profiles WHERE password_hash IS NULL`);
const unMigCount = unmigrated.rowCount ?? 0;
if (unMigCount > 0) {
    console.log(`\n[force-pw] ⚠️  ${unMigCount} profile(s) STILL have password_hash IS NULL:`);
    console.table(unmigrated.rows);
    console.log('  (these were inserted with no email + no fallback match; ignore if Echoza Security bot)');
}
else {
    console.log('\n[force-pw] ✅ every profile now has a password_hash set.');
}
console.log('\n─────────────────────────────────────────────────────────');
console.log(`  TEMP PASSWORD for all unlocked profiles:`);
console.log(`    ${TEMP_PASSWORD}`);
console.log('  ─ share this with your 5 users so they can sign in once ─');
console.log('  ─ each user can change their password later from Settings ─');
console.log('─────────────────────────────────────────────────────────\n');
await client.end();
