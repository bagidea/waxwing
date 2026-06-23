// 🪙 WAX Wallet plugin — server side (self-custody, MULTICHAIN, Antelope).
//
// Phase 2: config-driven multichain. The same encrypted keystore + offline
// signing (see keystore.js) now drives any Antelope network defined in CHAINS
// below — WAX and EOS share the same key format, signing and account model, so
// nothing key-related changes per chain; only the endpoint / chainId / explorer
// / core symbol differ. The active network is persisted per keystore and
// **defaults to WAX testnet** (boss order). Read commands accept a one-off
// `network` override; `setnetwork` changes the persisted default.
//
// SAFETY / BRANDING:
//   • The selected network is explicit and visible; mainnet chains are flagged
//     `kind:"mainnet"` so the UI can warn. Default stays WAX testnet.
//   • Private keys are encrypted on disk; plaintext lives only in memory while
//     unlocked, wiped on lock. Keys are never logged, never sent anywhere except
//     as a local signature input.
//   • Brand name + logo live in ONE place (BRAND below). Final name is locked:
//     "waxwing" (by Monanisa). Change here ONLY — the panel + plugin.json mirror it.

const fs = require("fs");
const path = require("path");
const ks = require("./keystore");

// ── BRAND (single source of truth) ───────────────────────────────────
// Final name locked by Monanisa: "waxwing". Change here ONLY and the panel picks
// it up (it fetches /plugin/wax-wallet/brand on load). plugin.json's `name` is the
// office-shelf label and mirrors this. The panel embeds the waxwing SVG logo
// (brand/icon.svg) inline; `logo` here is the emoji fallback for text contexts.
const BRAND = {
  name: "waxwing",                  // locked brand name (lowercase wordmark)
  short: "waxwing",                 // short word used in pills/badges
  logo: "🪙",                       // emoji fallback (panel inlines the SVG mark)
  tagline: "Sign. Seal. Soar.",     // your keys, your wax seal, your flight
};

// ── Antelope networks (config-driven; WAX · EOS · Telos · XPR/Proton) ─
// chainId is the canonical id; every read verifies the live node matches it.
// corePrecision: WAX core = 8 dp; EOS/TLOS/XPR core = 4 dp.
const CHAINS = {
  "wax-testnet": {
    id: "wax-testnet", name: "WAX Testnet", kind: "testnet",
    rpc: "https://testnet.waxsweden.org",
    history: "https://testnet.waxsweden.org",
    chainId: "f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12",
    explorerTx: "https://testnet.waxblock.io/transaction/",
    coreSymbol: "WAX", corePrecision: 8,
  },
  "wax-mainnet": {
    id: "wax-mainnet", name: "WAX Mainnet", kind: "mainnet",
    rpc: "https://wax.greymass.com",
    history: "https://wax.eosphere.io",
    chainId: "1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4",
    explorerTx: "https://waxblock.io/transaction/",
    coreSymbol: "WAX", corePrecision: 8,
  },
  "eos-testnet": { // Jungle4
    id: "eos-testnet", name: "EOS Jungle4 (testnet)", kind: "testnet",
    rpc: "https://jungle4.greymass.com",
    history: "https://jungle4.history.eosnation.io",
    chainId: "73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d",
    explorerTx: "https://jungle4.eosq.eosnation.io/tx/",
    coreSymbol: "EOS", corePrecision: 4,
  },
  "eos-mainnet": {
    id: "eos-mainnet", name: "EOS Mainnet", kind: "mainnet",
    rpc: "https://eos.greymass.com",
    history: "https://eos.hyperion.eosrio.io",
    chainId: "aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906",
    explorerTx: "https://bloks.io/transaction/",
    coreSymbol: "EOS", corePrecision: 4,
  },
  // Telos — RPC + Hyperion v2 share one host (live-verified 2026-06-24).
  "telos-testnet": {
    id: "telos-testnet", name: "Telos Testnet", kind: "testnet",
    rpc: "https://testnet.telos.net",
    history: "https://testnet.telos.net",
    chainId: "1eaa0824707c8c16bd25145493bf062aecddfeb56c736f6ba6397f3195f33c9f",
    explorerTx: "https://telos-test.bloks.io/transaction/",
    coreSymbol: "TLOS", corePrecision: 4,
  },
  "telos-mainnet": {
    id: "telos-mainnet", name: "Telos Mainnet", kind: "mainnet",
    rpc: "https://mainnet.telos.net",
    history: "https://mainnet.telos.net",
    chainId: "4667b205c6838ef70ff7988f6e8257e8be0e1284a2f59699054a018f743b1d11",
    explorerTx: "https://telos.bloks.io/transaction/",
    coreSymbol: "TLOS", corePrecision: 4,
  },
  // XPR Network (Proton) — RPC (eosusa) + Hyperion (saltant) on separate hosts.
  "xpr-testnet": {
    id: "xpr-testnet", name: "XPR Network Testnet", kind: "testnet",
    rpc: "https://test.proton.eosusa.io",
    history: "https://test.proton.eosusa.io",
    chainId: "71ee83bcf52142d61019d95f9cc5427ba6a0d7ff8accd9e2088ae2abeaf3d3dd",
    explorerTx: "https://proton-test.bloks.io/transaction/",
    coreSymbol: "XPR", corePrecision: 4,
  },
  "xpr-mainnet": {
    id: "xpr-mainnet", name: "XPR Network (Proton)", kind: "mainnet",
    rpc: "https://proton.eosusa.io",
    history: "https://api-xprnetwork-main.saltant.io",
    chainId: "384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0",
    explorerTx: "https://proton.bloks.io/transaction/",
    coreSymbol: "XPR", corePrecision: 4,
  },
};
const DEFAULT_NET = "wax-testnet"; // boss order — default network on a fresh store

// Public, key-safe view of a chain config (sent to the panel).
function publicChain(c) {
  return {
    id: c.id, name: c.name, kind: c.kind, rpc: c.rpc,
    chainId: c.chainId, explorerTx: c.explorerTx,
    coreSymbol: c.coreSymbol, corePrecision: c.corePrecision,
  };
}

// Cache the dynamically-imported ESM modules (index.js itself is CommonJS, which
// is what the office plugin loader require()s).
let _wharf;
async function wharf() {
  if (!_wharf) {
    const [antelope, session, pkPlugin] = await Promise.all([
      import("@wharfkit/antelope"),
      import("@wharfkit/session"),
      import("@wharfkit/wallet-plugin-privatekey"),
    ]);
    _wharf = {
      PrivateKey: antelope.PrivateKey,
      Asset: antelope.Asset,
      Name: antelope.Name,
      Session: session.Session,
      WalletPluginPrivateKey: pkPlugin.WalletPluginPrivateKey,
    };
  }
  return _wharf;
}

// Force `Connection: close` so undici never reuses a keep-alive socket that an
// RPC node may have already dropped (the multi-call transact path tripped
// UND_ERR_SOCKET / "fetch failed" otherwise).
const closeFetch = (url, opts = {}) =>
  fetch(url, { ...opts, headers: { ...(opts.headers || {}), connection: "close" } });

// ── Read-only chain RPC (no key involved); chain-scoped ──────────────
async function rpc(chain, endpoint, body, _retried) {
  const url = `${chain.rpc}/v1/chain/${endpoint}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify(body || {}),
    });
  } catch (e) {
    if (!_retried) return rpc(chain, endpoint, body, true); // RPC drops idle sockets
    throw new Error(`RPC unreachable (${chain.id}): ${e?.cause?.code || e.message}`);
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const detail = json?.error?.details?.[0]?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return json;
}

async function chainInfo(chain) {
  const info = await rpc(chain, "get_info");
  return {
    network: chain.name, id: chain.id, kind: chain.kind, rpc: chain.rpc,
    chainId: info.chain_id, expectedChainId: chain.chainId,
    chainMatches: info.chain_id === chain.chainId,
    coreSymbol: chain.coreSymbol,
    headBlock: info.head_block_num, headTime: info.head_block_time,
    serverVersion: info.server_version_string || info.server_version,
  };
}

async function accountInfo(chain, name) {
  if (!name) throw new Error("account name required");
  const a = await rpc(chain, "get_account", { account_name: name });
  const usage = (lim) => lim ? { used: lim.used, available: lim.available, max: lim.max } : null;
  return {
    account: a.account_name, created: a.created,
    coreBalance: a.core_liquid_balance || `0.${"0".repeat(chain.corePrecision)} ${chain.coreSymbol}`,
    ram: { quota: a.ram_quota, usage: a.ram_usage },
    cpu: usage(a.cpu_limit), net: usage(a.net_limit),
    permissions: (a.permissions || []).map((p) => p.perm_name),
  };
}

async function tokenBalance(chain, name, symbol, contract) {
  if (!name) throw new Error("account name required");
  const body = { code: contract || "eosio.token", account: name };
  if (symbol) body.symbol = symbol;
  const list = await rpc(chain, "get_currency_balance", body);
  return { account: name, contract: body.code, balances: Array.isArray(list) ? list : [] };
}

// Tx history via Hyperion v2 (best-effort: not every node runs history).
async function history(chain, name, limit) {
  if (!name) throw new Error("account name required");
  const n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const url = `${chain.history}/v2/history/get_actions?account=${encodeURIComponent(name)}&limit=${n}&simple=true&sort=desc`;
  let res;
  try { res = await fetch(url, { headers: { connection: "close" } }); }
  catch (e) { throw new Error(`history endpoint unreachable: ${e?.cause?.code || e.message}`); }
  if (!res.ok) throw new Error(`history HTTP ${res.status} (node may not run Hyperion)`);
  const json = await res.json();
  const acts = json.simple_actions || json.actions || [];
  const items = acts.map((x) => ({
    time: x.timestamp || x["@timestamp"] || x.block_time,
    contract: x.contract || x.act?.account,
    action: x.action || x.act?.name,
    from: x.data?.from, to: x.data?.to,
    amount: x.data?.amount != null ? `${x.data.amount} ${x.data.symbol || ""}`.trim() : (x.data?.quantity || ""),
    memo: x.data?.memo, txId: x.trx_id || x.transaction_id,
  }));
  return { account: name, count: items.length, actions: items, explorerTx: chain.explorerTx };
}

// ── Keystore (encrypted at rest; chain-agnostic keys) ────────────────
function loadStore(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return { version: 1, network: DEFAULT_NET, accounts: [] }; }
}
function saveStore(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
}
// Public view only — never leaks key material.
function publicView(store) {
  return store.accounts.map((a) => ({
    label: a.label, account: a.account || null, permission: a.permission || "active",
    publicKey: a.publicKey, onChain: a.account ? undefined : false,
  }));
}

module.exports = (ctx) => {
  const FILE = path.join(ctx.dataDir, "keystore.json");
  // In-memory unlocked keys: publicKey -> privString. Wiped on lock / auto-lock.
  const unlocked = new Map();
  let lockTimer = null;
  const AUTO_LOCK_MS = 10 * 60 * 1000;

  function relock() {
    unlocked.clear();
    if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
  }
  function armAutoLock() {
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = setTimeout(relock, AUTO_LOCK_MS);
    if (lockTimer.unref) lockTimer.unref();
  }
  function notify() {
    try { ctx.broadcast?.({ type: "plugin.event", plugin: "wax-wallet", at: Date.now() }); } catch {}
  }

  // ── Selected network (persisted in the store; defaults to WAX testnet) ──
  function currentNet() {
    const store = loadStore(FILE);
    const id = store.network && CHAINS[store.network] ? store.network : DEFAULT_NET;
    return CHAINS[id];
  }
  // Resolve a one-off override (read commands) or fall back to the persisted net.
  function resolveNet(sel) {
    if (!sel) return currentNet();
    if (CHAINS[sel]) return CHAINS[sel];
    throw new Error(`unknown network "${sel}" (have: ${Object.keys(CHAINS).join(", ")})`);
  }
  function setNetwork(sel) {
    if (!sel) throw new Error(`which network? (have: ${Object.keys(CHAINS).join(", ")})`);
    if (!CHAINS[sel]) throw new Error(`unknown network "${sel}" (have: ${Object.keys(CHAINS).join(", ")})`);
    const store = loadStore(FILE);
    store.network = sel;
    saveStore(FILE, store);
    notify();
    return { network: sel, chain: publicChain(CHAINS[sel]) };
  }

  function findAccount(store, sel) {
    if (!sel) return store.accounts[0];
    return store.accounts.find((a) => a.account === sel || a.publicKey === sel || a.label === sel);
  }

  // Generate a fresh keypair, encrypt the private key, persist the record.
  async function create(password, account, permission) {
    if (!password) throw new Error("password required to encrypt the new key");
    const { PrivateKey } = await wharf();
    const priv = PrivateKey.generate("K1");
    const pub = priv.toPublic().toString();
    const rec = ks.encrypt(priv.toString(), password);
    const store = loadStore(FILE);
    const entry = {
      label: account || `key-${pub.slice(-6)}`,
      account: account || null, permission: permission || "active",
      publicKey: pub, ...rec, createdAt: new Date().toISOString(),
    };
    store.accounts.push(entry);
    saveStore(FILE, store);
    notify();
    return {
      created: true, publicKey: pub, account: entry.account, permission: entry.permission,
      note: entry.account
        ? "Key stored encrypted. Make sure this public key is set on the account's permission on-chain."
        : "Key stored encrypted. Create/bind an account to this public key (faucet or `newaccount`), then set its `account` field to use it.",
    };
  }

  // Import an existing private key (PVT_K1_… or legacy WIF 5…).
  async function importKey(password, privkey, account, permission) {
    if (!password) throw new Error("password required");
    if (!privkey) throw new Error("private key required");
    const { PrivateKey } = await wharf();
    let priv;
    try { priv = PrivateKey.fromString(String(privkey).trim()); }
    catch (e) { throw new Error("invalid private key format"); }
    const pub = priv.toPublic().toString();
    const rec = ks.encrypt(priv.toString(), password);
    const store = loadStore(FILE);
    if (store.accounts.some((a) => a.publicKey === pub)) throw new Error("this key is already in the keystore");
    const entry = {
      label: account || `key-${pub.slice(-6)}`,
      account: account || null, permission: permission || "active",
      publicKey: pub, ...rec, createdAt: new Date().toISOString(),
    };
    store.accounts.push(entry);
    saveStore(FILE, store);
    notify();
    return { imported: true, publicKey: pub, account: entry.account, permission: entry.permission };
  }

  // Unlock = decrypt the chosen key(s) into memory after verifying the password.
  async function unlock(password, sel) {
    if (!password) throw new Error("password required");
    const store = loadStore(FILE);
    if (!store.accounts.length) throw new Error("keystore is empty — create or import a key first");
    const targets = sel ? [findAccount(store, sel)].filter(Boolean) : store.accounts;
    if (!targets.length) throw new Error(`no stored key matches "${sel}"`);
    let ok = 0;
    for (const a of targets) {
      try { unlocked.set(a.publicKey, ks.decrypt(a, password)); ok++; }
      catch { /* wrong password for this record */ }
    }
    if (!ok) throw new Error("bad password");
    armAutoLock();
    notify();
    return { unlocked: ok, of: targets.length, autoLockMs: AUTO_LOCK_MS };
  }

  function lock() { relock(); notify(); return { locked: true }; }

  function status() {
    const store = loadStore(FILE);
    const net = currentNet();
    return {
      network: publicChain(net),
      networks: Object.values(CHAINS).map(publicChain),
      accounts: publicView(store), count: store.accounts.length,
      unlocked: unlocked.size > 0, unlockedKeys: unlocked.size,
      brand: BRAND,
    };
  }

  // Bind / update the on-chain account name + permission for a stored key.
  function setAccount(sel, account, permission) {
    const store = loadStore(FILE);
    const a = findAccount(store, sel);
    if (!a) throw new Error(`no stored key matches "${sel}"`);
    if (account) { a.account = account; a.label = account; }
    if (permission) a.permission = permission;
    saveStore(FILE, store);
    notify();
    return { ok: true, account: a.account, permission: a.permission, publicKey: a.publicKey };
  }

  function removeKey(sel) {
    if (!sel) throw new Error("which key? pass account / publicKey / label");
    const store = loadStore(FILE);
    const before = store.accounts.length;
    store.accounts = store.accounts.filter((a) => !(a.account === sel || a.publicKey === sel || a.label === sel));
    if (store.accounts.length === before) throw new Error(`no stored key matches "${sel}"`);
    saveStore(FILE, store);
    notify();
    return { removed: before - store.accounts.length };
  }

  // Normalize a quantity to the selected chain's core precision + symbol.
  function normalizeQuantity(chain, q) {
    const s = String(q).trim();
    const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Z]{1,7})?$/);
    if (!m) throw new Error(`bad quantity "${q}" (e.g. "1.0 ${chain.coreSymbol}")`);
    const sym = m[2] || chain.coreSymbol;
    const amount = Number(m[1]).toFixed(chain.corePrecision);
    return `${amount} ${sym}`;
  }

  // SIGN + BROADCAST a real transfer on the selected (or overridden) network.
  async function send(params) {
    const p = typeof params === "object" ? params : {};
    const chain = resolveNet(p.network);
    const from = p.from, to = p.to;
    const contract = p.contract || "eosio.token";
    const memo = p.memo != null ? String(p.memo) : "";
    if (!from || !to) throw new Error("from and to are required");
    const quantity = normalizeQuantity(chain, p.quantity || p.amount);

    const store = loadStore(FILE);
    const rec = findAccount(store, from) || store.accounts.find((a) => a.account === from);
    if (!rec) throw new Error(`no stored key for "${from}"`);
    if (!rec.account) throw new Error(`stored key "${rec.label}" has no on-chain account bound (use setaccount)`);
    const priv = unlocked.get(rec.publicKey);
    if (!priv) throw new Error("wallet is locked — unlock first");

    const { Session, WalletPluginPrivateKey } = await wharf();
    const session = new Session(
      {
        chain: { id: chain.chainId, url: chain.rpc },
        actor: rec.account, permission: rec.permission || "active",
        walletPlugin: new WalletPluginPrivateKey(priv),
      },
      { fetch: closeFetch }, // SessionOptions — must be the 2nd arg
    );
    const action = {
      account: contract, name: "transfer",
      authorization: [{ actor: rec.account, permission: rec.permission || "active" }],
      data: { from: rec.account, to, quantity, memo },
    };
    const result = await session.transact({ action }, { broadcast: true });
    armAutoLock(); // signing counts as activity
    const txId = String(result.response?.transaction_id || result.resolved?.transaction?.id || "");
    notify();
    return {
      broadcast: true, txId,
      explorer: txId ? chain.explorerTx + txId : null,
      from: rec.account, to, quantity, contract, memo,
      network: chain.name, networkId: chain.id,
    };
  }

  // Create a brand-new on-chain account on the selected network, bound to a key
  // WE generate and store encrypted (full self-custody). `creator` is an
  // unlocked funded account that pays RAM + stakes CPU/NET.
  async function newAccount(params) {
    const p = typeof params === "object" ? params : {};
    const chain = resolveNet(p.network);
    const creatorSel = p.creator;
    const name = p.name;
    if (!creatorSel) throw new Error("creator (a funded, unlocked account) required");
    if (!name || !/^[a-z1-5.]{1,12}$/.test(name)) throw new Error("name must be 1-12 chars of a-z, 1-5, .");
    const ramBytes = parseInt(p.ram, 10) || 4096;
    const stake = (s) => normalizeQuantity(chain, s || `0.5 ${chain.coreSymbol}`);
    const netStake = stake(p.net), cpuStake = stake(p.cpu);

    const store = loadStore(FILE);
    const creator = findAccount(store, creatorSel);
    if (!creator || !creator.account) throw new Error(`no bound stored account for creator "${creatorSel}"`);
    const cpriv = unlocked.get(creator.publicKey);
    if (!cpriv) throw new Error("wallet is locked — unlock the creator account first");

    const { PrivateKey, Session, WalletPluginPrivateKey } = await wharf();
    // Use a supplied stored key, or generate+store a fresh one for the new account.
    let pub = p.pubkey;
    let newRec;
    if (!pub) {
      if (!p.password) throw new Error("password required to encrypt the new account's key");
      const np = PrivateKey.generate("K1");
      pub = np.toPublic().toString();
      newRec = { label: name, account: name, permission: "active", publicKey: pub, ...ks.encrypt(np.toString(), p.password), createdAt: new Date().toISOString() };
    }
    const auth = { threshold: 1, keys: [{ key: pub, weight: 1 }], accounts: [], waits: [] };
    const session = new Session(
      { chain: { id: chain.chainId, url: chain.rpc }, actor: creator.account, permission: creator.permission || "active", walletPlugin: new WalletPluginPrivateKey(cpriv) },
      { fetch: closeFetch },
    );
    const actions = [
      { account: "eosio", name: "newaccount", authorization: [{ actor: creator.account, permission: creator.permission || "active" }],
        data: { creator: creator.account, name, owner: auth, active: auth } },
      { account: "eosio", name: "buyrambytes", authorization: [{ actor: creator.account, permission: creator.permission || "active" }],
        data: { payer: creator.account, receiver: name, bytes: ramBytes } },
      { account: "eosio", name: "delegatebw", authorization: [{ actor: creator.account, permission: creator.permission || "active" }],
        data: { from: creator.account, receiver: name, stake_net_quantity: netStake, stake_cpu_quantity: cpuStake, transfer: false } },
    ];
    const result = await session.transact({ actions }, { broadcast: true });
    const txId = String(result.response?.transaction_id || "");
    // Persist the new account's key only AFTER the chain accepted it.
    if (newRec) { store.accounts.push(newRec); saveStore(FILE, store); }
    armAutoLock();
    notify();
    return {
      created: true, account: name, publicKey: pub, ramBytes,
      netStake, cpuStake, creator: creator.account,
      txId, explorer: txId ? chain.explorerTx + txId : null,
      network: chain.name, networkId: chain.id, keyStored: !!newRec,
    };
  }

  function parseArgs(args) {
    if (args && typeof args === "object") return args;
    const s = (args || "").trim();
    if (!s) return {};
    if (s.startsWith("{")) { try { return JSON.parse(s); } catch {} }
    return { _raw: s, _parts: s.split(/\s+/) };
  }

  async function onCommand(cmd, args, reply) {
    try {
      const a = parseArgs(args);
      const parts = a._parts || [];
      switch (cmd) {
        case "brand":      return reply({ ok: true, brand: BRAND });
        case "networks":   return reply({ ok: true, networks: Object.values(CHAINS).map(publicChain), current: currentNet().id, default: DEFAULT_NET });
        case "network":    return reply({ ok: true, network: publicChain(currentNet()) });
        case "setnetwork": return reply({ ok: true, ...setNetwork(a.network || a.id || parts[0]) });
        case "chaininfo":  return reply({ ok: true, info: await chainInfo(resolveNet(a.network)) });
        case "account":    return reply({ ok: true, account: await accountInfo(resolveNet(a.network), a.name || parts[0]) });
        case "balance":    return reply({ ok: true, balance: await tokenBalance(resolveNet(a.network), a.name || parts[0], a.symbol || parts[1], a.contract || parts[2]) });
        case "history":    return reply({ ok: true, history: await history(resolveNet(a.network), a.name || parts[0], a.limit || parts[1]) });
        case "create":     return reply({ ok: true, ...(await create(a.password || parts[0], a.account || parts[1], a.permission || parts[2])) });
        case "import":     return reply({ ok: true, ...(await importKey(a.password || parts[0], a.privkey || a.key || parts[1], a.account || parts[2], a.permission || parts[3])) });
        case "accounts":   return reply({ ok: true, accounts: publicView(loadStore(FILE)) });
        case "unlock":     return reply({ ok: true, ...(await unlock(a.password || parts[0], a.account || parts[1])) });
        case "lock":       return reply({ ok: true, ...lock() });
        case "status":     return reply({ ok: true, status: status() });
        case "setaccount": return reply({ ok: true, ...setAccount(a.select || parts[0], a.account || parts[1], a.permission || parts[2]) });
        case "remove":     return reply({ ok: true, ...removeKey(a.select || a.account || parts[0]) });
        case "send":       return reply({ ok: true, result: await send(a) });
        case "newaccount": return reply({ ok: true, result: await newAccount(a) });
        default:           return reply({ ok: false, msg: `unknown command: ${cmd}` });
      }
    } catch (e) {
      return reply({ ok: false, msg: String((e && e.message) || e) });
    }
  }

  return {
    onCommand,
    routes: {
      brand(req, res) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, brand: BRAND }));
      },
      networks(req, res) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, networks: Object.values(CHAINS).map(publicChain), current: currentNet().id, default: DEFAULT_NET }));
      },
    },
  };
};

// Pure helpers for standalone testing (require() this file directly).
module.exports._test = { rpc, chainInfo, accountInfo, tokenBalance, history, CHAINS, DEFAULT_NET, BRAND, wharf, publicChain };
