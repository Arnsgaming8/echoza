import pg from 'pg';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readFileSync } from 'fs';
void fileURLToPath;
void dirname;
void readFileSync;
async function main() {
    const url = process.env.DATABASE_URL;
    if (!url)
        throw new Error('DATABASE_URL required');
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    console.log('=== A. profiles table (all rows) ===');
    const r = await client.query(`SELECT username,
            display_name,
            password_hash IS NOT NULL AS has_pw,
            LEFT(password_hash, 7) AS hash_prefix,
            last_sign_in_at IS NOT NULL AS has_signed_in,
            created_at
       FROM profiles
       ORDER BY created_at`);
    console.table(r.rows);
    console.log('\n=== B. password_hash match against cutover temp password ===');
    const allWithPw = await client.query(`SELECT username, password_hash FROM profiles WHERE password_hash IS NOT NULL`);
    for (const row of allWithPw.rows) {
        const unlocks = await bcrypt.compare('EchozaMigrateTemp2026', row.password_hash);
        console.log(`  ${row.username.padEnd(20)}  →  unlocks with EchozaMigrateTemp2026 ?  ${unlocks}`);
    }
    console.log('\n=== C. summary ===');
    const summary = await client.query(`SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE password_hash IS NOT NULL) AS has_pw,
            COUNT(*) FILTER (WHERE password_hash IS NULL) AS pw_null,
            COUNT(*) FILTER (WHERE last_sign_in_at IS NOT NULL) AS has_signed_in
       FROM profiles`);
    console.log(`  total profiles:              ${summary.rows[0].total}`);
    console.log(`  with password_hash:          ${summary.rows[0].has_pw}`);
    console.log(`  with NULL password_hash:     ${summary.rows[0].pw_null}`);
    console.log(`  with non-NULL last_sign_in:  ${summary.rows[0].has_signed_in}`);
    await client.end();
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
