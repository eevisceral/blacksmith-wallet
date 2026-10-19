export function newAccountsWait(where) {
  return `New accounts on ${where} wait until AccountFactory is deployed. A Kernel that already has code still opens.`;
}

import {
  ENTRY_POINT,
  KERNEL_FACTORY,
  ACCOUNT_FACTORY,
  encodeBalanceOf,
  encodeGetAccountAddress,
  encodeFactoryGetAccount,
  hasCode,
  accountFromWord,
  pickAccount,
  kernelExecImpl,
  kernelBatchImpl,
} from './kernel.mjs';
import { jrpc, kernelImpl, getRpcUrl } from './rpc.mjs';
import { word } from './util.mjs';

function ethCall(url, to, data) {
  return jrpc(url, 'eth_call', [{ to, data }, 'latest']);
}

async function funds(url, addr) {
  if (!addr) return { eth: 0n, deposit: 0n };
  const [ethHex, depHex] = await Promise.all([
    jrpc(url, 'eth_getBalance', [addr, 'latest']),
    ethCall(url, ENTRY_POINT, encodeBalanceOf(addr)),
  ]);
  return { eth: word(ethHex), deposit: word(depHex) };
}

async function predicted(url, factoryOn, factory, data) {
  if (!factoryOn) return '';
  const addr = accountFromWord(await ethCall(url, factory, data));
  if (!addr) throw new Error('Could not read the account address from the chain.');
  return addr;
}

export async function readAccount(eoa) {
  return readAccountAt(eoa, getRpcUrl());
}

export async function readAccountAt(eoa, url) {
  if (!url) throw new Error('No RPC URL.');
  const [eoaHex, factoryCode, legacyFactoryCode] = await Promise.all([
    jrpc(url, 'eth_getBalance', [eoa, 'latest']),
    jrpc(url, 'eth_getCode', [ACCOUNT_FACTORY, 'latest']),
    jrpc(url, 'eth_getCode', [KERNEL_FACTORY, 'latest']),
  ]);
  const factoryOnChain = hasCode(factoryCode);
  const legacyFactoryOn = hasCode(legacyFactoryCode);
  const [legacyAddr, ourAddr] = await Promise.all([
    predicted(url, legacyFactoryOn, KERNEL_FACTORY, encodeGetAccountAddress(eoa)),
    predicted(url, factoryOnChain, ACCOUNT_FACTORY, encodeFactoryGetAccount(eoa)),
  ]);
  const [legacyCode, legacyFunds, ourCode, ourFunds] = await Promise.all([
    legacyAddr ? jrpc(url, 'eth_getCode', [legacyAddr, 'latest']) : '0x',
    funds(url, legacyAddr),
    ourAddr ? jrpc(url, 'eth_getCode', [ourAddr, 'latest']) : '0x',
    funds(url, ourAddr),
  ]);
  const picked = pickAccount({
    legacyAddr,
    legacyCode,
    legacyEth: legacyFunds.eth,
    legacyDeposit: legacyFunds.deposit,
    factoryOnChain,
    ourAddr,
    ourCode,
    ourEth: ourFunds.eth,
    ourDeposit: ourFunds.deposit,
  });
  let impl = '';
  let execOk = false;
  let batch = false;
  if (picked.deployed) {
    impl = await kernelImpl(picked.aa, url);
    execOk = kernelExecImpl(impl);
    batch = kernelBatchImpl(impl);
  }
  const held = picked.source === 'legacy' ? legacyFunds : ourFunds;
  return {
    eoaWei: word(eoaHex),
    factoryOnChain,
    legacyAddr,
    ourAddr,
    picked,
    impl,
    execOk,
    batch,
    eth: picked.aa ? held.eth : 0n,
    deposit: picked.aa ? held.deposit : 0n,
  };
}
