/* Local-only EIP-1193 wallet. Proxies an Anvil unlocked account (`?eoa=` or fork default). Not shipped in dist/. */
(() => {
  const cfg = { chainId: '0x1', ...(window.__V1_FORK__ || {
    rpc: 'http://127.0.0.1:8545',
    eoa: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  }) };
  cfg.rpcEth = cfg.rpcEth || cfg.rpc;
  try {
    const q = new URLSearchParams(location.search).get('eoa');
    if (q && /^0x[0-9a-fA-F]{40}$/.test(q)) cfg.eoa = q;
  } catch {
    /* ignore */
  }
  let rpcId = 1;

  async function jrpc(method, params) {
    const r = await fetch(cfg.rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
    });
    const raw = (await r.text()).replace(/^\uFEFF/, '').trim();
    if (!raw || raw[0] === '<' || /^<!doctype/i.test(raw)) {
      throw new Error('The RPC returned a web page instead of chain data. Check the RPC URL.');
    }
    let j;
    try {
      j = JSON.parse(raw);
    } catch {
      throw new Error('The RPC returned a web page instead of chain data. Check the RPC URL.');
    }
    if (j.error) {
      const err = new Error(j.error.message || method);
      err.code = j.error.code;
      throw err;
    }
    return j.result;
  }

  const provider = {
    isAnvilFork: !cfg.baseRpc,
    baseRpc: cfg.baseRpc,
    request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [cfg.eoa];
      if (method === 'eth_chainId') return cfg.chainId || '0x1';
      if (method === 'net_version') return String(parseInt(cfg.chainId || '0x1', 16));
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
        const cid = String(params?.[0]?.chainId || '').toLowerCase();
        const want1 = cid === '0x1' || cid === '1';
        const wantBase = cid === '0x2105' || cid === '8453';
        if (want1 && (cfg.baseRpc || cfg.chainId === '0x1')) {
          cfg.chainId = '0x1';
          cfg.rpc = cfg.rpcEth || cfg.rpc;
          return null;
        }
        if (wantBase && (cfg.baseRpc || cfg.chainId === '0x2105')) {
          cfg.chainId = '0x2105';
          cfg.rpc = cfg.baseRpc || cfg.rpc;
          return null;
        }
        const err = new Error(cfg.baseRpc ? 'unsupported chain' : 'this playground is one chain');
        err.code = 4902;
        throw err;
      }
      return jrpc(method, params || []);
    },
    on() {},
    removeListener() {},
    addListener() {},
  };

  window.__v1ForkProvider = provider;
  window.ethereum = provider;

  const detail = {
    info: {
      uuid: 'a3e7c8b1-4d2f-4c9a-8e11-6b0f2d9a7c44',
      name: 'Anvil mainnet fork',
      icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjM2Q2ZDRhIi8+PC9zdmc+',
      rdns: 'dev.blacksmith.anvil-fork',
    },
    provider,
  };
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
})();
