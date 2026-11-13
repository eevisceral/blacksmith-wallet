import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDist, checkRecords, liveGap, publishedFromSol } from './pin-check.mjs';
import { ACCOUNT_FACTORY } from '../kernel.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('Deploy pins match dist keccak and kernel factory', () => {
  const pin = checkRecords();
  const dist = checkDist(pin);
  assert.ok(dist.chunks >= 1 && dist.chunks <= 16);
  assert.equal(dist.bytes, readFileSync(join(root, 'onchain-ui/dist/index.html')).length);
  assert.equal(pin.factory.toLowerCase(), ACCOUNT_FACTORY.toLowerCase());
  assert.equal(
    publishedFromSol(readFileSync(join(root, 'onchain-ui/contracts/script/Deploy.s.sol'), 'utf8')).keccak,
    dist.keccak,
  );
});

test('live pin fails when the host has no code', () => {
  assert.deepEqual(liveGap([{ id: 1, factoryOn: true, hostOn: false }]), [1]);
  assert.deepEqual(liveGap([{ id: 1, factoryOn: true, hostOn: true }, { id: 8453, factoryOn: true, hostOn: true }]), []);
});
