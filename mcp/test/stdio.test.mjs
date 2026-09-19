import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');

/** Spawn the server and exchange newline-delimited JSON-RPC over stdio. */
function startServer() {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const pending = new Map();
  const errors = [];
  child.stdout.on('data', (d) => {
    buf += d;
    for (;;) {
      const i = buf.indexOf('\n');
      if (i < 0) break;
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.error) {
        errors.push(msg.error);
      }
    }
  });
  const call = (msg) => {
    if (msg.id != null) {
      const p = new Promise((resolve) => pending.set(msg.id, resolve));
      child.stdin.write(JSON.stringify(msg) + '\n');
      return p;
    }
    child.stdin.write(JSON.stringify(msg) + '\n');
    return Promise.resolve(null);
  };
  return { child, call, errors };
}

test('stdio handshake, tools/list, tools/call, error shapes', async () => {
  const { child, call, errors } = startServer();
  try {
    const init = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    });
    assert.equal(init.result.serverInfo.name, 'blacksmith-v1-wallet');
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.ok(init.result.capabilities.tools);
    assert.match(init.result.instructions, /policy/);

    await call({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.deepEqual(
      list.result.tools.map((t) => t.name),
      [
        'resolve_account',
        'get_balances',
        'list_tokens',
        'get_activity',
        'prepare_userop',
        'explain_userop',
        'wallet_url',
        'keystore',
        'session',
        'sign_userop',
        'submit_userop',
      ],
    );

    const url = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'wallet_url', arguments: {} } });
    assert.match(url.result.content[0].text, /https:\/\/blacksmith-wallet\.pages\.dev\//);
    assert.ok(!url.result.isError);

    const badTool = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } });
    assert.equal(badTool.error.code, -32602);

    const badArgs = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'resolve_account', arguments: {} } });
    assert.equal(badArgs.result.isError, true);
    assert.match(badArgs.result.content[0].text, /owner EOA/);

    const noChain = await call({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'explain_userop', arguments: { callData: '0x51945447' + '00'.repeat(32) } },
    });
    assert.equal(noChain.result.isError, true);
    assert.match(noChain.result.content[0].text, /truncated/);

    const ping = await call({ jsonrpc: '2.0', id: 7, method: 'ping' });
    assert.deepEqual(ping.result, {});

    const unknown = await call({ jsonrpc: '2.0', id: 8, method: 'resources/templates/list' });
    assert.equal(unknown.error.code, -32601);

    child.stdin.write('this is not json\n');
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(errors.some((e) => e.code === -32700));
  } finally {
    child.kill('SIGTERM');
  }
});
