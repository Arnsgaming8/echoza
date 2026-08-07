#!/usr/bin/env node
import ts from 'typescript';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const exts = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx'];
const skipDirs = new Set(['node_modules', 'dist', '.git', '.bin', 'turn', '.cache']);
const keepFiles = new Set(['client/src/vite-env.d.ts']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (exts.includes(p.slice(p.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

function scriptKindFor(filename) {
  if (filename.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filename.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.TS;
}

function strip(src) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, src);
  let out = '';
  let pos = 0;
  while (true) {
    const token = scanner.scan();
    if (token === ts.SyntaxKind.EndOfFileToken) break;
    const tokenStart = scanner.getTokenPos();
    out += src.slice(pos, tokenStart).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g, '');
    out += src.slice(tokenStart, scanner.getTextPos());
    pos = scanner.getTextPos();
  }
  out += src.slice(pos).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g, '');
  return out;
}

const root = process.cwd();
const files = walk(root);
const errors = [];
const changed = [];
let bytesStripped = 0;
for (const f of files) {
  if (keepFiles.has(relative(root, f).replace(/\\/g, '/'))) continue;
  const src = readFileSync(f, 'utf8');
  let stripped;
  try {
    stripped = strip(src);
  } catch (err) {
    errors.push({ file: relative(root, f), error: err.message });
    continue;
  }
  if (stripped !== src) {
    writeFileSync(f, stripped);
    changed.push(relative(root, f));
    bytesStripped += src.length - stripped.length;
  }
}

console.log(`Files scanned: ${files.length}`);
console.log(`Files changed: ${changed.length}`);
console.log(`Bytes stripped: ${bytesStripped}`);
if (errors.length) {
  console.log('');
  console.log('Files with errors (NOT modified):');
  for (const e of errors) console.log(`  ${e.file}: ${e.error}`);
}
console.log('');
console.log('Modified:');
for (const f of changed) console.log(`  ${f}`);
