#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import pg from 'pg';
const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnvFile(path) {
    try {
        const raw = readFileSync(path, 'utf8');
        for (const line of raw.split('\n')) {
            const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
            if (!m)
                continue;
            const [, key, val] = m;
            if (process.env[key] === undefined) {
                process.env[key] = val.replace(/^['"]|['"]$/g, '');
            }
        }
    }
    catch {
    }
}
loadEnvFile(resolve(__dirname, '..', '.env'));
const stdinText = await new Promise((resolveText) => {
    if (process.stdin.isTTY) {
        resolveText('');
        return;
    }
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (buf += chunk));
    process.stdin.on('end', () => resolveText(buf));
});
const argvSql = process.argv.slice(2).join(' ').trim();
const stdinSql = stdinText.trim();
const sql = argvSql || stdinSql;
if (!sql) {
    process.stderr.write('USAGE: node server/scripts/sql.mjs "<SQL>"\n' +
        '   or: echo "<SQL>" | node server/scripts/sql.mjs\n' +
        'DATABASE_URL must be set (export it or put it in server/.env).\n');
    process.exit(2);
}
if (!process.env.DATABASE_URL) {
    process.stderr.write('ERROR: DATABASE_URL is not set.\n');
    process.exit(2);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let exitCode = 0;
try {
    const result = await pool.query(sql);
    process.stdout.write(JSON.stringify(result.rows, null, 2) + '\n');
    if (result.rowCount !== null && result.rowCount !== undefined) {
        process.stderr.write(`rowCount=${result.rowCount}\n`);
    }
}
catch (err) {
    process.stderr.write(`SQL_ERROR: ${err.message}\n`);
    if (err?.code)
        process.stderr.write(`SQL_CODE: ${err.code}\n`);
    if (err?.detail)
        process.stderr.write(`SQL_DETAIL: ${err.detail}\n`);
    exitCode = 1;
}
finally {
    await pool.end();
    process.exit(exitCode);
}
