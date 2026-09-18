import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTRY_POINT,
  KERNEL_FACTORY,
  ACCOUNT_FACTORY,
  KERNEL_IMPL,
  EIP1967_IMPL_SLOT,
  encodeExecute,
  encodeTransfer,
  encodeFactoryCreate,
} from '../../onchain-ui/kernel.mjs';
import { callTool } from '../tools.mjs';

/**
 * Recorded-RPC harness: a deterministic fake node answers the exact reads the
 * tools make (chooseRpc probes, resolve, balances, nonce, hash, simulate).
 */
const EOA = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const EOA2 = '0x3333333333333333333333333333333333333333';
const OUR_AA = '0x2222222222222222222222222222222222222222';
const OUR_AA2 = '0x4444444444444444444444444444444444444444';
const LEGACY_AA = '0x1111111111111111111111111111111111111111';
const LEGACY_AA2 = '0x5555555555555555555555555555555555555555';
const DEST = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USER_OP_HASH = '0x' + 'ab'.repeat(32);
const HEAD = 24000000;

const word32 = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => '0x' + a.replace(/^0x/i, '').toLowerCase().padStart(64, '0');
const abiString = (s) => {
  const h = Buffer.from(s, 'utf8').toString('hex');
  return '0x' + word32(32).slice(2) + word32(h.length / 2).slice(2) + h.padEnd(64, '0');
};

const hits = [];

function answer(method, params, url) {
  const noFactory = String(url).includes('nofactory');
  if (method === 'eth_chainId') return '0x1';
  if (method === 'eth_blockNumber') return '0x' + HEAD.toString(16);
  if (method === 'eth_getBlockByNumber') return { baseFeePerGas: '0x3b9aca00', timestamp: '0x66e00000' };
  if (method === 'eth_getBalance') {
    const a = params[0].toLowerCase();
    return a === OUR_AA ? word32(2n * 10n ** 18n) : '0x0';
  }
  if (method === 'eth_getCode') {
    const a = params[0].toLowerCase();
    if (a === ACCOUNT_FACTORY.toLowerCase()) return noFactory ? '0x' : '0x6000';
    if (a === KERNEL_FACTORY.toLowerCase() || a === OUR_AA) return '0x6000';
    return '0x';
  }
  if (method === 'eth_getStorageAt') {
    return params[0].toLowerCase() === OUR_AA && params[1] === EIP1967_IMPL_SLOT ? addrWord(KERNEL_IMPL) : word32(0);
  }
  if (method === 'eth_getLogs') {
    // chooseRpc deep probe: a 2023 block with unaddressed Transfer logs must answer >0.
    return parseInt(params[0].fromBlock, 16) === 17000000
      ? [{ blockNumber: '0x1036640', transactionHash: '0x' + 'cd'.repeat(32), address: USDC, topics: [], data: '0x' }]
      : [];
  }
  if (method === 'eth_call') {
    const to = params[0].to.toLowerCase();
    const data = params[0].data || '0x';
    const sel = data.slice(2, 10);
    if (to === KERNEL_FACTORY.toLowerCase()) {
      if (sel === '4d6cb700') return addrWord(data.includes(EOA2.slice(2).toLowerCase()) ? LEGACY_AA2 : LEGACY_AA);
      if (sel === '6544c828') return word32(1);
    }
    if (to === ACCOUNT_FACTORY.toLowerCase() && sel === '0d253d76') {
      return addrWord(data.includes(EOA2.slice(2).toLowerCase()) ? OUR_AA2 : OUR_AA);
    }
    if (to === ENTRY_POINT.toLowerCase()) {
      if (sel === '35567e1a') return word32(5);
      if (sel === 'a6193531') return USER_OP_HASH;
      if (sel === '70a08231') return word32(data.slice(-40) === OUR_AA.slice(2) ? 5n * 10n ** 16n : 0n);
      if (sel === '1fad948c') return { error: 'execution reverted: AA24 signature error' };
    }
    if (to === USDC.toLowerCase()) {
      if (sel === '70a08231') return word32(5000000);
      if (sel === '95d89b41') return abiString('USDC');
      if (sel === '313ce567') return word32(6);
    }
    if (sel === '70a08231') return word32(0);
    return { error: 'execution reverted' };
  }
  return { error: 'unexpected method ' + method };
}

function recordedFetch(url, init) {
  const body = JSON.parse(init.body);
  hits.push([url, body.method]);
  const r = answer(body.method, body.params || [], url);
  const payload = r && r.error ? { error: { code: -32000, message: r.error } } : { result: r };
  return Promise.resolve({
    ok: true,
    text: () => Promise.resolve(JSON.stringify({ jsonrpc: '2.0', id: body.id, ...payload })),
  });
}

const realFetch = globalThis.fetch;

test.before(() => {
  globalThis.fetch = recordedFetch;
});

test.after(() => {
  globalThis.fetch = realFetch;
});

test('resolve_account reconnects the live page-factory Kernel', async () => {
  const text = await callTool('resolve_account', { eoa: EOA, chain: 1 });
  assert.match(text, new RegExp(`\\*\\*${OUR_AA}\\*\\* — live`));
  assert.match(text, /this page's factory/);
  assert.match(text, new RegExp(KERNEL_IMPL, 'i'));
  assert.match(text, /execute \+ executeBatch/);
});

test('resolve_account returns the create path when nothing is deployed', async () => {
  const text = await callTool('resolve_account', { eoa: EOA2, chain: 1 });
  assert.match(text, /not deployed yet/);
  assert.match(text, new RegExp(OUR_AA2));
  assert.match(text, new RegExp(ACCOUNT_FACTORY));
  assert.ok(text.includes(encodeFactoryCreate(EOA2)));
});

test('get_balances reads ETH, deposit, and a pasted token', async () => {
  const text = await callTool('get_balances', { account: OUR_AA, chain: 1, tokens: [USDC] });
  assert.match(text, /ETH: 2 ETH \(2000000000000000000 wei\)/);
  assert.match(text, /EntryPoint deposit: 0\.05 ETH/);
  assert.match(text, /5 USDC — 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \(5000000 base units\)/);
});

test('get_balances without tokens probes majors (nonzero only)', async () => {
  const text = await callTool('get_balances', { account: OUR_AA, chain: 1 });
  assert.match(text, /5 USDC/);
  assert.match(text, /Only nonzero pinned majors shown/);
  assert.equal((text.match(/base units/g) || []).length, 1);
});

test('list_tokens probes majors and points at the walk', async () => {
  const text = await callTool('list_tokens', { account: OUR_AA, chain: 1 });
  assert.match(text, /5 USDC/);
  assert.match(text, /walk: true/);
});

test('list_tokens walk stops on the public budget and says how far it got', async () => {
  const text = await callTool('list_tokens', { account: OUR_AA, chain: 1, walk: true });
  assert.match(text, /5 USDC/);
  assert.match(text, /Scanned back to block \d+/);
  assert.doesNotMatch(text, /No tokens on this account yet/);
});

test('get_activity over the recent window, honest about log-less ETH', async () => {
  const text = await callTool('get_activity', { account: OUR_AA, chain: 1 });
  assert.match(text, /newest first, 0 rows/);
  assert.match(text, /No logs in this window/);
  assert.match(text, /Native ETH out and ETH in with calldata leave no log/);
  assert.match(text, /~120000-block window/);
});

test('prepare_send drafts a native send (recorded node)', async () => {
  const text = await callTool('prepare_send', {
    eoa: EOA,
    chain: 1,
    to: DEST,
    assets: [{ kind: 'eth', amount: '0.5' }],
  });
  assert.match(text, /Dry-run send draft/);
  assert.ok(text.includes(encodeExecute(DEST, 5n * 10n ** 17n, '0x')));
  assert.match(text, /"nonce": "0x5"/);
  assert.match(text, new RegExp(USER_OP_HASH));
  // prefund = (280000 + 300000 + 80000) × 3 gwei
  assert.match(text, /Prefund 1980000000000000 wei/);
  assert.match(text, /reaches the signature check.*ready to sign/);
  assert.match(text, /never broadcasts/);
});

test('prepare_send batches eth + token max into executeBatch', async () => {
  const text = await callTool('prepare_send', {
    eoa: EOA,
    chain: 1,
    to: DEST,
    assets: [
      { kind: 'eth', amount: '0.1' },
      { kind: 'token', token: USDC, amount: 'max' },
    ],
    simulate: false,
  });
  assert.match(text, /0x34fcd5be/);
  assert.ok(text.includes(encodeTransfer(DEST, 5000000n).slice(2)));
  assert.match(text, /5 USDC/);
});

test('prepare_send blocks an over-cap native send without throwing', async () => {
  const text = await callTool('prepare_send', { eoa: EOA, chain: 1, to: DEST, assets: [{ kind: 'eth', amount: '5' }] });
  assert.match(text, /Cannot prepare this send: ETH: 5 leaves no room for the prefund — spendable max is/);
});

test('prepare_send on a chain without the account returns the create path', async () => {
  const text = await callTool('prepare_send', { eoa: EOA2, chain: 1, assets: [{ kind: 'eth', amount: '0.1' }] });
  assert.match(text, /No Kernel on Ethereum yet/);
  assert.match(text, new RegExp(ACCOUNT_FACTORY));
  assert.match(text, /not a UserOp/);
});

test('explain_userop with chain enriches token legs from the recorded node', async () => {
  const text = await callTool('explain_userop', {
    callData: encodeExecute(USDC, 0n, encodeTransfer(DEST, 2500000n)),
    chain: 1,
  });
  assert.match(text, /ERC-20 transfer 2\.5 USDC → 0xd8da6bf26964af9d7eed9e03e53415d37aa96045/);
});

test("resolve_account says the page's factory is missing when neither path exists", async () => {
  const text = await callTool('resolve_account', { eoa: EOA, chain: 1, rpc: 'https://nofactory.invalid' });
  assert.match(text, /This page's factory is not on Ethereum yet/);
  assert.match(text, /no live or funded legacy account/);
});

test('custom RPC is exclusive — failure never falls through to public', async () => {
  const before = hits.length;
  const real = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    if (String(url).includes('custom.invalid')) {
      hits.push([url, JSON.parse(init.body).method]);
      return Promise.reject(new DOMException('signal timed out', 'TimeoutError'));
    }
    return recordedFetch(url, init);
  };
  try {
    await assert.rejects(
      () => callTool('get_balances', { account: OUR_AA, chain: 1, rpc: 'https://custom.invalid' }),
      /Custom RPC failed[\s\S]*no public fall-through/,
    );
  } finally {
    globalThis.fetch = real;
  }
  const customHits = hits.slice(before).map(([u]) => u);
  assert.ok(customHits.length > 0);
  assert.ok(customHits.every((u) => u === 'https://custom.invalid'), customHits.join(' '));
});
