#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const skip = new Set(['node_modules', 'dist', 'cache', 'out']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const files = walk(process.cwd());
let bad = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    bad++;
    process.stderr.write((r.stderr || r.stdout || file) + '\n');
  }
}
if (bad) {
  console.error('FAIL syntax ' + bad + ' of ' + files.length);
  process.exit(1);
}
console.log('ok syntax ' + files.length + ' files');
