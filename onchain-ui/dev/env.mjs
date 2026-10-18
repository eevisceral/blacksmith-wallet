import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseEnvText(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

export function repoRootFromHere() {
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

export function loadRepoEnv(env = process.env, root = repoRootFromHere()) {
  const p = join(root, '.env');
  if (!existsSync(p)) return p;
  const parsed = parseEnvText(readFileSync(p, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (env[k] == null || env[k] === '') env[k] = v;
  }
  return p;
}
