#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearDelegatedUnlocks, waitForRpc } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.FORK_RPC || 'http://127.0.0.1:8545';
const steps = [
  'smoke-tokens.mjs',
  'smoke-create.mjs',
  'smoke-withdraw.mjs',
  'smoke-ops.mjs',
  'smoke-walkaway.mjs',
  'smoke-host.mjs',
  'smoke-ui.mjs',
];

async function main() {
  try {
    await waitForRpc(RPC, 8);
    await clearDelegatedUnlocks(RPC);
  } catch {
    console.error('FAIL start node onchain-ui/dev/run.mjs first');
    process.exit(1);
  }
  for (const f of steps) {
    console.log('\n==', f, '==');
    const r = spawnSync(process.execPath, [join(here, f)], {
      encoding: 'utf8',
      stdio: 'inherit',
      env: process.env,
    });
    if (r.status !== 0) process.exit(r.status || 1);
  }
  console.log('\nok fork suite');
}

main().catch((e) => {
  console.error('FAIL', e.message || e);
  process.exit(1);
});
