import test from 'node:test';
import assert from 'node:assert/strict';
import { refuseDeploySecrets, parseDeployArgs, rpcForChain, forgeArgs } from './deploy.mjs';

test('deploy wrapper refuses private-key argv and env', () => {
  assert.match(refuseDeploySecrets(['--private-key', '0x' + 'ab'.repeat(32)]), /Do not pass --private-key/);
  assert.match(refuseDeploySecrets(['--private-key=0x' + 'ab'.repeat(32)]), /Do not pass --private-key/);
  assert.match(refuseDeploySecrets(['ab'.repeat(32)]), /64-hex private key/);
  assert.match(refuseDeploySecrets([], { FOUNDRY_ETH_PRIVATE_KEY: '0x' + 'ab'.repeat(32) }), /FOUNDRY_ETH_PRIVATE_KEY/);
  assert.equal(refuseDeploySecrets(['--account', 'deployer'], {}), '');
});

test('deploy wrapper requires exclusive RPC and keystore for broadcast', () => {
  const p = parseDeployArgs(['--broadcast', '--chain', 'base', '--account', 'deployer']);
  assert.equal(p.broadcast, true);
  assert.equal(p.chain, 8453);
  assert.equal(p.account, 'deployer');
  assert.match(rpcForChain(1, {}).error, /ETH_RPC/);
  assert.equal(rpcForChain(8453, { BASE_RPC: 'http://127.0.0.1:8545' }).url, 'http://127.0.0.1:8545');
  assert.match(forgeArgs({ broadcast: true, account: '', extra: [], rpcUrl: 'http://x' }).error, /--account/);
  const ok = forgeArgs({
    broadcast: true,
    chain: 8453,
    account: 'deployer',
    extra: [],
    rpcUrl: 'http://127.0.0.1:8545',
  });
  assert.ok(ok.args.includes('--broadcast'));
  assert.ok(ok.args.includes('deployer'));
  assert.equal(ok.args[ok.args.indexOf('--chain-id') + 1], '8453');
  assert.ok(!ok.args.includes('--sender'));
  assert.ok(!ok.args.some((a) => String(a).includes('private')));
  const sim = forgeArgs({
    broadcast: false,
    chain: 1,
    account: '',
    extra: [],
    rpcUrl: 'http://127.0.0.1:8545',
  });
  assert.ok(!sim.args.includes('--broadcast'));
  assert.equal(sim.args[sim.args.indexOf('--chain-id') + 1], '1');
});
