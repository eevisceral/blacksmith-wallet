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
import { jrpc, call, kernelImpl, getRpcUrl } from './rpc.mjs';
import { word } from './util.mjs';

async function funds(addr) {
  if (!addr) return { eth: 0n, deposit: 0n };
  const [ethHex, depHex] = await Promise.all([
    jrpc(getRpcUrl(), 'eth_getBalance', [addr, 'latest']),
    call(ENTRY_POINT, encodeBalanceOf(addr)),
  ]);
  return { eth: word(ethHex), deposit: word(depHex) };
}

async function predicted(factoryOn, factory, data) {
  if (!factoryOn) return '';
  const addr = accountFromWord(await call(factory, data));
  if (!addr) throw new Error('Could not read the account address from the chain.');
  return addr;
}

export async function readAccount(eoa) {
  const [eoaHex, factoryCode, legacyFactoryCode] = await Promise.all([
    jrpc(getRpcUrl(), 'eth_getBalance', [eoa, 'latest']),
    jrpc(getRpcUrl(), 'eth_getCode', [ACCOUNT_FACTORY, 'latest']),
    jrpc(getRpcUrl(), 'eth_getCode', [KERNEL_FACTORY, 'latest']),
  ]);
  const factoryOnChain = hasCode(factoryCode);
  const legacyFactoryOn = hasCode(legacyFactoryCode);
  const [legacyAddr, ourAddr] = await Promise.all([
    predicted(legacyFactoryOn, KERNEL_FACTORY, encodeGetAccountAddress(eoa)),
    predicted(factoryOnChain, ACCOUNT_FACTORY, encodeFactoryGetAccount(eoa)),
  ]);
  const [legacyCode, legacyFunds, ourCode, ourFunds] = await Promise.all([
    legacyAddr ? jrpc(getRpcUrl(), 'eth_getCode', [legacyAddr, 'latest']) : '0x',
    funds(legacyAddr),
    ourAddr ? jrpc(getRpcUrl(), 'eth_getCode', [ourAddr, 'latest']) : '0x',
    funds(ourAddr),
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
    impl = await kernelImpl(picked.aa);
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
