#!/usr/bin/env node
/**
 * Blacksmith V1 wallet MCP — stdio JSON-RPC 2.0, newline-delimited, zero dependencies.
 * Runs on Node 20+ or bun. Protocol surface: initialize, ping, tools/list, tools/call.
 */
import { createInterface } from 'node:readline';
import { TOOLS, callTool } from './tools.mjs';

const SERVER_INFO = { name: 'blacksmith-v1-wallet', version: '0.2.0' };
const INSTRUCTIONS = [
  'Blacksmith wallet (Kernel 0.2.4 / EntryPoint v0.6 on Ethereum and Base).',
  'Reads and drafts over JSON-RPC. Signing uses a local encrypted keystore and Kernel v2 session keys; private keys never appear in tool results.',
  'submit_userop is dry-run unless live:true and policy.json allows it. Direct EntryPoint.handleOps — no bundler. Prefer session keys for agent sends; pages.dev is the human wallet.',
].join(' ');

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    fail(null, -32600, 'Invalid Request');
    return;
  }
  const { id, method, params } = msg;
  const isReq = id !== undefined && id !== null;
  if (typeof method !== 'string') {
    if (isReq) fail(id, -32600, 'Invalid Request');
    return;
  }
  try {
    switch (method) {
      case 'initialize': {
        if (!isReq) return;
        const requested = params && typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        reply(id, {
          protocolVersion: requested || '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
        return;
      }
      case 'ping':
        if (isReq) reply(id, {});
        return;
      case 'tools/list':
        if (isReq) reply(id, { tools: TOOLS });
        return;
      case 'resources/list':
        if (isReq) reply(id, { resources: [] });
        return;
      case 'prompts/list':
        if (isReq) reply(id, { prompts: [] });
        return;
      case 'tools/call': {
        if (!isReq) return;
        const name = params && params.name;
        const args = params && params.arguments;
        if (typeof name !== 'string' || (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args)))) {
          fail(id, -32602, 'Invalid params');
          return;
        }
        try {
          const text = await callTool(name, args || {});
          reply(id, { content: [{ type: 'text', text }] });
        } catch (e) {
          if (e && e.code === -32602) {
            fail(id, -32602, e.message);
            return;
          }
          reply(id, { content: [{ type: 'text', text: (e && e.message) || 'Tool failed.' }], isError: true });
        }
        return;
      }
      default:
        if (isReq) fail(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (isReq) fail(id, -32603, (e && e.message) || 'Internal error');
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try {
    msg = JSON.parse(t);
  } catch {
    fail(null, -32700, 'Parse error');
    return;
  }
  handle(msg).catch((e) => {
    try {
      fail(msg && msg.id !== undefined ? msg.id : null, -32603, (e && e.message) || 'Internal error');
    } catch {
      /* stdout gone */
    }
  });
});
