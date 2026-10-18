#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256 } from '../../mcp/eth-crypto.mjs';
import {
  ACCOUNT_FACTORY,
  ECDSA_VALIDATOR,
  ENTRY_POINT,
  KERNEL_IMPL,
  PAGE_HOST,
  CHAINS,
} from '../kernel.mjs';
import { jrpc } from '../rpc.mjs';
import { loadRepoEnv } from './env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const MAX = 24576;
const NICK = '0x4e59b44847b379578588920cA78FbF26c0B4956C';

function grab(src, re, label) {
  const m = src.match(re);
  if (!m) throw new Error('missing ' + label);
  return m[1];
}

function normAddr(a) {
  return String(a).toLowerCase();
}

function abiString(hex) {
  const h = String(hex || '').replace(/^0x/i, '');
  if (h.length < 128) throw new Error('short html() return');
  const off = Number.parseInt(h.slice(0, 64), 16) * 2;
  const len = Number.parseInt(h.slice(off, off + 64), 16);
  return Buffer.from(h.slice(off + 64, off + 64 + len * 2), 'hex').toString('utf8');
}

export function publishedFromSol(src) {
  return {
    factory: grab(src, /PUBLISHED_FACTORY = (0x[0-9a-fA-F]{40})/, 'PUBLISHED_FACTORY'),
    host: grab(src, /PUBLISHED_HOST = (0x[0-9a-fA-F]{40})/, 'PUBLISHED_HOST'),
    keccak: grab(src, /PUBLISHED_KECCAK = (0x[0-9a-fA-F]{64})/, 'PUBLISHED_KECCAK').toLowerCase(),
    nick: grab(src, /NICK_FACTORY = (0x[0-9a-fA-F]{40})/, 'NICK_FACTORY'),
    impl: grab(src, /KERNEL_IMPL = (0x[0-9a-fA-F]{40})/, 'KERNEL_IMPL'),
    validator: grab(src, /ECDSA_VALIDATOR = (0x[0-9a-fA-F]{40})/, 'ECDSA_VALIDATOR'),
    entryPoint: grab(src, /ENTRY_POINT = (0x[0-9a-fA-F]{40})/, 'ENTRY_POINT'),
  };
}

export function checkRecords() {
  const deploySrc = readFileSync(join(root, 'onchain-ui/contracts/script/Deploy.s.sol'), 'utf8');
  const factorySrc = readFileSync(join(root, 'onchain-ui/contracts/src/AccountFactory.sol'), 'utf8');
  const testSrc = readFileSync(join(root, 'onchain-ui/contracts/test/VersionHost.t.sol'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const pin = publishedFromSol(deploySrc);
  const impl = grab(factorySrc, /IMPLEMENTATION = (0x[0-9a-fA-F]{40})/, 'AccountFactory.IMPLEMENTATION');
  const val = grab(factorySrc, /VALIDATOR = (0x[0-9a-fA-F]{40})/, 'AccountFactory.VALIDATOR');
  const testK = grab(testSrc, /PUBLISHED_KECCAK = (0x[0-9a-fA-F]{64})/, 'test keccak').toLowerCase();
  const testH = grab(testSrc, /PUBLISHED_HOST = (0x[0-9a-fA-F]{40})/, 'test host');
  const testN = grab(testSrc, /NICK_FACTORY = (0x[0-9a-fA-F]{40})/, 'test nick');

  const want = [
    ['factory', pin.factory, ACCOUNT_FACTORY],
    ['host keccak vs test', pin.keccak, testK],
    ['host vs test', pin.host, testH],
    ['nick', pin.nick, NICK],
    ['nick vs test', pin.nick, testN],
    ['impl vs factory', pin.impl, impl],
    ['impl vs kernel', pin.impl, KERNEL_IMPL],
    ['validator vs factory', pin.validator, val],
    ['validator vs kernel', pin.validator, ECDSA_VALIDATOR],
    ['entrypoint', pin.entryPoint, ENTRY_POINT],
  ];
  for (const [name, a, b] of want) {
    if (normAddr(a) !== normAddr(b)) throw new Error(name + ' ' + a + ' != ' + b);
  }
  if (PAGE_HOST !== '') throw new Error('PAGE_HOST must be empty; the contract address comes from the URL');
  for (const [label, v] of [
    ['keccak', pin.keccak],
    ['host', pin.host],
    ['factory', pin.factory],
    ['nick', pin.nick],
  ]) {
    if (!readme.toLowerCase().includes(v.toLowerCase())) throw new Error('README missing ' + label);
  }
  if (!readme.includes('not a gateway')) throw new Error('README must say the pin is html() keccak, not a gateway');
  return pin;
}

export function checkDist(pin) {
  const raw = readFileSync(join(root, 'onchain-ui/dist/index.html'));
  const html = raw.toString('utf8');
  if (Buffer.from(html).compare(raw) !== 0) throw new Error('dist is not utf8');
  const k = keccak256(raw).toLowerCase();
  if (k !== pin.keccak) throw new Error('dist keccak ' + k + ' != ' + pin.keccak);
  if (raw[0] === 0xef) throw new Error('dist starts with 0xEF');
  const n = Math.ceil(raw.length / MAX);
  if (n < 1 || n > 16) throw new Error('chunk count ' + n);
  for (let i = 0; i < n; i++) {
    const part = raw.subarray(i * MAX, (i + 1) * MAX);
    if (part.length && part[0] === 0xef) throw new Error('chunk ' + i + ' starts with 0xEF');
  }
  if (html.includes('src="./app.mjs"') || html.includes('wallet.css')) throw new Error('dist still linked');
  if (/src=["']https?:/i.test(html) || /href=["']https?:\/\/fonts/i.test(html)) {
    throw new Error('dist loads a remote script or font');
  }
  if (!html.includes('blacksmith-v1-wallet')) throw new Error('SKILL.md not inlined');
  if (!html.toLowerCase().includes(pin.factory.toLowerCase())) throw new Error('dist missing AccountFactory');
  return { bytes: raw.length, chunks: n, keccak: k };
}

async function codeAt(url, addr) {
  const c = await jrpc(url, 'eth_getCode', [addr, 'latest'], 12000);
  return c && c !== '0x' && c !== '0x0';
}

export async function checkLive(pin) {
  const htmlSel = keccak256(Buffer.from('html()')).slice(0, 10);
  const rows = [];
  for (const id of [1, 8453]) {
    const env = id === 1 ? process.env.ETH_RPC : process.env.BASE_RPC;
    const urls = [env, ...(CHAINS[id]?.rpcs || [])].filter(Boolean);
    let last;
    let ok;
    for (const url of urls) {
      try {
        const need = [
          ['nick', pin.nick, true],
          ['impl', pin.impl, true],
          ['validator', pin.validator, true],
          ['entrypoint', pin.entryPoint, true],
        ];
        for (const [name, addr, want] of need) {
          const has = await codeAt(url, addr);
          if (has !== want) throw new Error(name + ' code=' + has + ' on ' + url);
        }
        const factoryOn = await codeAt(url, pin.factory);
        const hostOn = await codeAt(url, pin.host);
        if (hostOn) {
          const ret = await jrpc(url, 'eth_call', [{ to: pin.host, data: htmlSel }, 'latest'], 20000);
          const served = abiString(ret);
          const k = keccak256(Buffer.from(served)).toLowerCase();
          if (k !== pin.keccak) throw new Error('live html() keccak ' + k + ' on chain ' + id);
        }
        rows.push({ id, url, factoryOn, hostOn });
        ok = true;
        break;
      } catch (e) {
        last = e;
      }
    }
    if (!ok) throw last || new Error('no RPC for chain ' + id);
  }
  return rows;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  loadRepoEnv();
  const live = process.argv.includes('--live');
  const pin = checkRecords();
  const dist = checkDist(pin);
  console.log(
    'freeze',
    dist.bytes,
    'B',
    dist.chunks,
    'chunks',
    dist.keccak,
    'host',
    pin.host,
    'factory',
    pin.factory,
  );
  if (live) {
    const rows = await checkLive(pin);
    for (const r of rows) {
      console.log(
        'chain',
        r.id,
        r.factoryOn ? 'factory live' : 'factory empty',
        r.hostOn ? 'host live' : 'host empty',
        r.url,
      );
    }
  }
}
