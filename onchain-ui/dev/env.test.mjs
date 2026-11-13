import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvText, loadRepoEnv } from './env.mjs';

test('parseEnvText skips comments and quoted values', () => {
  const p = parseEnvText('# x=1\nETH_RPC=https://a.example\nBASE_RPC="https://b.example"\nBAD\n');
  assert.equal(p.ETH_RPC, 'https://a.example');
  assert.equal(p.BASE_RPC, 'https://b.example');
  assert.equal(p.x, undefined);
});

test('loadRepoEnv does not override a set shell var', () => {
  const env = { ETH_RPC: 'https://shell.example' };
  loadRepoEnv(env, '/tmp');
  assert.equal(env.ETH_RPC, 'https://shell.example');
});
