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
const crypto = require("crypto");
// ks required inside module.exports with cache-busting for hot reload
// Resource action builders (delegatebw / undelegatebw / buyram* / sellram) live
// in ONE place — Yamamoto's zero-dep module. index.js owns validation + the
// sign-intent gate; the module owns the on-chain action shape + asset precision.
const R = require("./resources");

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
    explorerTxFallback: "https://wax-test.bloks.io/transaction/",
    coreSymbol: "WAX", corePrecision: 8,
  },
  "wax-mainnet": {
    id: "wax-mainnet", name: "WAX Mainnet", kind: "mainnet",
    rpc: "https://wax.greymass.com",
    history: "https://wax.eosphere.io",
    chainId: "1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4",
    explorerTx: "https://waxblock.io/transaction/",
    explorerTxFallback: "https://wax.bloks.io/transaction/",
    coreSymbol: "WAX", corePrecision: 8,
  },
  "eos-testnet": { // Jungle4
    id: "eos-testnet", name: "EOS Jungle4 (testnet)", kind: "testnet",
    rpc: "https://jungle4.greymass.com",
    history: "https://jungle4.history.eosnation.io",
    chainId: "73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d",
    explorerTx: "https://jungle4.eosq.eosnation.io/tx/",
    explorerTxFallback: "https://jungle4.bloks.io/transaction/",
    coreSymbol: "EOS", corePrecision: 4,
  },
  "eos-mainnet": {
    id: "eos-mainnet", name: "EOS Mainnet", kind: "mainnet",
    rpc: "https://eos.greymass.com",
    history: "https://eos.hyperion.eosrio.io",
    chainId: "aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906",
    explorerTx: "https://bloks.io/transaction/",
    explorerTxFallback: "https://eos.eosq.eosnation.io/tx/",
    coreSymbol: "EOS", corePrecision: 4,
  },
  // Telos — RPC + Hyperion v2 share one host (live-verified 2026-06-24).
  "telos-testnet": {
    id: "telos-testnet", name: "Telos Testnet", kind: "testnet",
    rpc: "https://testnet.telos.net",
    history: "https://testnet.telos.net",
    chainId: "1eaa0824707c8c16bd25145493bf062aecddfeb56c736f6ba6397f3195f33c9f",
    explorerTx: "https://explorer.telos.net/transaction/",
    explorerTxFallback: "https://telos-test.bloks.io/transaction/",
    coreSymbol: "TLOS", corePrecision: 4,
  },
  "telos-mainnet": {
    id: "telos-mainnet", name: "Telos Mainnet", kind: "mainnet",
    rpc: "https://mainnet.telos.net",
    history: "https://mainnet.telos.net",
    chainId: "4667b205c6838ef70ff7988f6e8257e8be0e1284a2f59699054a018f743b1d11",
    explorerTx: "https://explorer.telos.net/transaction/",
    explorerTxFallback: "https://telos.bloks.io/transaction/",
    coreSymbol: "TLOS", corePrecision: 4,
  },
  // XPR Network (Proton) — RPC (eosusa) + Hyperion (saltant) on separate hosts.
  "xpr-testnet": {
    id: "xpr-testnet", name: "XPR Network Testnet", kind: "testnet",
    rpc: "https://test.proton.eosusa.io",
    history: "https://test.proton.eosusa.io",
    chainId: "71ee83bcf52142d61019d95f9cc5427ba6a0d7ff8accd9e2088ae2abeaf3d3dd",
    explorerTx: "https://explorer.xprnetwork.org/transaction/",
    explorerTxFallback: "https://proton-test.bloks.io/transaction/",
    coreSymbol: "XPR", corePrecision: 4,
  },
  "xpr-mainnet": {
    id: "xpr-mainnet", name: "XPR Network (Proton)", kind: "mainnet",
    rpc: "https://proton.eosusa.io",
    history: "https://api-xprnetwork-main.saltant.io",
    chainId: "384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0",
    explorerTx: "https://explorer.xprnetwork.org/transaction/",
    explorerTxFallback: "https://proton.bloks.io/transaction/",
    coreSymbol: "XPR", corePrecision: 4,
  },
};
const DEFAULT_NET = "wax-testnet"; // boss order — default network on a fresh store

// Adapt index.js's chain config to resources.js's ChainConfig (it keys off
// `symbol`/`precision`; ours uses `coreSymbol`/`corePrecision`). This is the one
// seam between the two precision tables — they MUST agree (WAX 8 dp, EOS/TLOS/XPR
// 4 dp), so the builder formats every asset at the exact precision of the chain.
function modChain(c) {
  return { id: c.id, symbol: c.coreSymbol, precision: c.corePrecision, contract: "eosio" };
}

// Public, key-safe view of a chain config (sent to the panel).
function publicChain(c) {
  return {
    id: c.id, name: c.name, kind: c.kind, rpc: c.rpc,
    chainId: c.chainId, explorerTx: c.explorerTx, explorerTxFallback: c.explorerTxFallback,
    coreSymbol: c.coreSymbol, corePrecision: c.corePrecision,
  };
}

// Single source of truth: build an explorer transaction URL for any network.
// Returns { primary, fallback } — both are full URLs including txId.
function explorerTxUrl(networkId, txId) {
  if (!networkId || !txId) return { primary: null, fallback: null };
  const c = CHAINS[networkId];
  if (!c) return { primary: null, fallback: null };
  return {
    primary: c.explorerTx ? c.explorerTx + txId : null,
    fallback: c.explorerTxFallback ? c.explorerTxFallback + txId : null,
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
  // self_delegated_bandwidth = tokens STAKED by this account (for Max button in unstake form)
  const bw = a.self_delegated_bandwidth;
  // CPU/NET rates derived from total_resources (same data, no extra RPC).
  const tr = a.total_resources || {};
  const cpuW = parseAssetAmount(tr.cpu_weight);
  const netW = parseAssetAmount(tr.net_weight);
  const cpuMax = (a.cpu_limit || {}).max || 0;
  const netMax = (a.net_limit || {}).max || 0;
  return {
    account: a.account_name, created: a.created,
    coreBalance: a.core_liquid_balance || `0.${"0".repeat(chain.corePrecision)} ${chain.coreSymbol}`,
    ram: { quota: a.ram_quota, usage: a.ram_usage },
    cpu: usage(a.cpu_limit), net: usage(a.net_limit),
    staked: bw ? { cpu: bw.cpu_weight, net: bw.net_weight } : { cpu: null, net: null },
    rates: {
      cpuUsPerWax:    cpuW > 0 && cpuMax > 0 ? cpuMax / cpuW : null,
      netBytesPerWax: netW > 0 && netMax > 0 ? netMax / netW : null,
      netKbPerWax:    netW > 0 && netMax > 0 ? (netMax / netW) / 1024 : null,
    },
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
  const items = acts.map((x) => {
    const txId = x.trx_id || x.transaction_id;
    return {
      time: x.timestamp || x["@timestamp"] || x.block_time,
      contract: x.contract || x.act?.account,
      action: x.action || x.act?.name,
      from: x.data?.from, to: x.data?.to,
      amount: x.data?.amount != null ? `${x.data.amount} ${x.data.symbol || ""}`.trim() : (x.data?.quantity || ""),
      memo: x.data?.memo, txId,
      explorer: (txId ? explorerTxUrl(chain.id, txId).primary : null),
    };
  });
  return { account: name, count: items.length, actions: items, explorerTx: chain.explorerTx };
}

// ── Hyperion v2 state API (auto-resolve + full token portfolio) ────────
// Anchor-style: when you import/create a key, we query the chain to find
// which accounts it controls, then auto-bind them. No more manual setaccount.
// Also provides full token balances (not just core symbol) for overview.
async function hyperionGet(chain, endpoint, params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const url = `${chain.history}/v2/state/${endpoint}?${qs}`;
  let res;
  try { res = await fetch(url, { headers: { connection: "close" } }); }
  catch (e) { throw new Error(`Hyperion unreachable (${chain.id}): ${e?.cause?.code || e.message}`); }
  if (!res.ok) {
    // 404 / empty response = no data (not an error — the key/account simply has none)
    if (res.status === 404 || res.status === 204) return {};
    throw new Error(`Hyperion ${endpoint} HTTP ${res.status}`);
  }
  return res.json();
}

// Look up which on-chain accounts a public key controls via Hyperion v2.
// Returns [] if the key controls no accounts (fresh key) or API doesn't know.
async function keyAccounts(chain, publicKey) {
  try {
    const data = await hyperionGet(chain, "get_key_accounts", { public_key: publicKey });
    return Array.isArray(data.account_names) ? data.account_names : [];
  } catch {
    return []; // best-effort: if Hyperion is down, don't block key import
  }
}

// Cross-network scan: when a key has 0 accounts on the selected chain, scan ALL
// other configured chains to find where it DOES control accounts. Returns a map
// of { networkId: [accountNames] } for chains with non-empty results, or {} if
// the key controls no accounts anywhere. Runs in parallel for speed.
async function crossNetworkScan(publicKey, excludeNetId) {
  const nets = Object.values(CHAINS).filter(c => c.id !== excludeNetId);
  const results = await Promise.all(nets.map(async (c) => {
    const accts = await keyAccounts(c, publicKey);
    return { netId: c.id, accounts: accts };
  }));
  const out = {};
  for (const r of results) {
    if (r.accounts.length > 0) out[r.netId] = r.accounts;
  }
  return out;
}

// Fetch ALL token balances for an account via Hyperion v2 (not just core symbol).
async function tokenBalances(chain, account) {
  try {
    const data = await hyperionGet(chain, "get_tokens", { account });
    return Array.isArray(data.tokens) ? data.tokens : [];
  } catch {
    return []; // best-effort
  }
}

// ── Resource pricing (CPU/NET/RAM rates + bidirectional converter) ────
// Rate engine for WAX ↔ CPU/NET/RAM conversion. CPU/NET rates are derived
// from the account's own total_resources + cpu/net_limit (proportional
// allocation, same for every staker). RAM uses the live Bancor market from
// the eosio rammarket table with 0.5% fee.

// Extract numeric amount from an Antelope asset string like "10.00000000 WAX".
function parseAssetAmount(assetStr) {
  if (!assetStr) return 0;
  const [amount] = String(assetStr).split(" ");
  return parseFloat(amount);
}

// Fetch the eosio rammarket singleton (Bancor RAM market).
async function getRAMMarket(chain) {
  const body = { code: "eosio", scope: "eosio", table: "rammarket", json: true, limit: 1 };
  const res = await rpc(chain, "get_table_rows", body);
  const row = (res.rows || [])[0];
  if (!row) throw new Error("rammarket table empty");
  return row;
}

// Bancor buy: WAX → RAM bytes (0.5% fee, equal weight 50/50).
//   bytes = baseBal * (effectiveWax / (quoteBal + effectiveWax))
//   where effectiveWax = waxAmount * 0.995
function ramBancorBuy(baseBal, quoteBal, waxAmount) {
  const effective = waxAmount * 0.995;
  return Math.floor(baseBal * (effective / (quoteBal + effective)));
}

// Bancor sell: RAM bytes → WAX received (0.5% fee).
//   tokens = quoteBal * (bytes / baseBal) * 0.995
function ramBancorSell(baseBal, quoteBal, bytes) {
  return quoteBal * (bytes / baseBal) * 0.995;
}

// Compute live per-chain rates: CPU μs/WAX, NET bytes/WAX (and KB), RAM bytes/WAX.
// The account MUST have some stake for CPU/NET rates; if it doesn't, they're null.
// RAM rate always works (fetched from rammarket).
async function computeRates(chain, accountName) {
  const [acct, market] = await Promise.all([
    rpc(chain, "get_account", { account_name: accountName }),
    getRAMMarket(chain),
  ]);
  const tr = acct.total_resources || {};
  const cpuW = parseAssetAmount(tr.cpu_weight);
  const netW = parseAssetAmount(tr.net_weight);
  const cpuMax = (acct.cpu_limit || {}).max || 0;
  const netMax = (acct.net_limit || {}).max || 0;
  const quoteBal = parseAssetAmount(market.quote.balance);
  const baseBal = parseAssetAmount(market.base.balance);
  return {
    cpuUsPerWax:    cpuW > 0 && cpuMax > 0 ? cpuMax / cpuW : null,
    netBytesPerWax: netW > 0 && netMax > 0 ? netMax / netW : null,
    netKbPerWax:    netW > 0 && netMax > 0 ? (netMax / netW) / 1024 : null,
    ramBytesPerWax: ramBancorBuy(baseBal, quoteBal, 1),
    ramWaxPerKb:    ramBancorSell(baseBal, quoteBal, 1024),
    ramMarket: { quote: market.quote.balance, base: market.base.balance, supply: market.supply },
  };
}

// ── Account names (Antelope base32) ──────────────────────────────────
// Names are base32: only a-z, 1-5 and '.', max 12 chars. wharfkit's Name.from()
// SILENTLY coerces anything else to '.', so a human label like "Wax Wing Super"
// becomes ".ax..ing..upe" — a non-existent account the chain rejects at broadcast
// ("authorizing actor … does not exist"). That was the real send bug (CEO saw a
// bare error). We validate loudly at every bind point instead of trusting wharfkit.
const NAME_RE = /^[a-z1-5.]{1,12}$/;
function assertAccountName(name, field = "account") {
  const s = String(name == null ? "" : name).trim();
  if (!s) throw new Error(`${field} name required`);
  if (!NAME_RE.test(s)) {
    const guess = s.toLowerCase().replace(/[^a-z1-5.]/g, "").slice(0, 12);
    throw new Error(
      `invalid ${field} name "${name}" — Antelope account names are 1-12 chars of a-z, 1-5 and '.' ` +
      `(no spaces or uppercase)${guess ? `. Did you mean "${guess}"?` : ""}`,
    );
  }
  return s;
}

// ── Keystore (encrypted at rest; accounts SCOPED PER NETWORK) ────────
// Store schema v4 — ONE wallet-level password, accounts bucketed per network:
//   {
//     version: 4,
//     network: "<netId>",                 // selected network (boss default wax-testnet)
//     passwordVerifier: {algo,salt,check}|null,  // WALLET-level (one password → whole safe)
//     config: { autoLockMs: 600000 },
//     byNet: {
//       "<netId>": { accounts: [rec], selected: "<account|publicKey>|null" }
//     }
//   }
// Keys are cryptographically chain-agnostic, but an *account* lives on one chain,
// so accounts + the selected account are bucketed per network. Switching network
// shows only that chain's accounts and signs against the right chain — that's the
// "separate session per network" the CEO asked for. rec shape is unchanged:
//   { label, account, permission, publicKey, kdf, cipher, createdAt }
function emptyBucket() { return { accounts: [], selected: null }; }
function hasAnyAccounts(store) {
  for (const [, b] of Object.entries(store.byNet || {})) {
    if (b && b.accounts && b.accounts.length > 0) return true;
  }
  return false;
}
function loadStore(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return { version: 4, network: DEFAULT_NET, passwordVerifier: null, config: {}, byNet: {} }; }
  if (raw && raw.version === 4 && raw.byNet) {
    // Ensure config field exists on v4 stores
    if (!raw.config) raw.config = {};
    return raw;
  }
  if (raw && (raw.version === 2 || raw.version === 3) && raw.byNet) {
    // Migrate v2/v3 → v4: move passwordVerifier from per-bucket to wallet-level.
    // CEO spec: if multiple verifiers exist, use the current network's as the
    // wallet password. Fall back to the first bucket that has one.
    const net = (raw.network && CHAINS[raw.network]) ? raw.network : DEFAULT_NET;
    // Auto-migrate v2→v3 first: add passwordVerifier:null to any bucket that lacks it
    for (const [, b] of Object.entries(raw.byNet)) {
      if (b && b.passwordVerifier === undefined) b.passwordVerifier = null;
    }
    // Pick verifier: prefer current network's bucket, else first non-null
    let verifier = null;
    if (raw.byNet[net] && raw.byNet[net].passwordVerifier) {
      verifier = raw.byNet[net].passwordVerifier;
    } else {
      for (const [, b] of Object.entries(raw.byNet)) {
        if (b && b.passwordVerifier) { verifier = b.passwordVerifier; break; }
      }
    }
    // Strip passwordVerifier from all buckets (it's now wallet-level)
    for (const [, b] of Object.entries(raw.byNet)) {
      delete b.passwordVerifier;
    }
    raw.version = 4;
    raw.passwordVerifier = verifier;
    raw.config = raw.config || {};
    // Persist the migration so the file is v4 on disk (not just in memory).
    saveStore(file, raw);
    return raw;
  }
  // Migrate v1 (flat accounts shared across every net) → v4 buckets. The old
  // accounts land in whatever network was selected when they were added.
  const net = (raw && CHAINS[raw.network]) ? raw.network : DEFAULT_NET;
  const accounts = Array.isArray(raw && raw.accounts) ? raw.accounts : [];
  const store = { version: 4, network: net, passwordVerifier: null, config: {}, byNet: {} };
  store.byNet[net] = { accounts, selected: accounts[0]?.account || accounts[0]?.publicKey || null };
  saveStore(file, store);
  return store;
}
function saveStore(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
}
function bucketOf(store, netId) {
  if (!store.byNet) store.byNet = {};
  if (!store.byNet[netId]) store.byNet[netId] = emptyBucket();
  return store.byNet[netId];
}
// Public view of ONE network's accounts — never leaks key material.
function publicView(store, netId) {
  const b = bucketOf(store, netId);
  return b.accounts.map((a) => ({
    label: a.label, account: a.account || null, permission: a.permission || "active",
    publicKey: a.publicKey, onChain: a.account ? undefined : false,
    selected: (b.selected === a.account || b.selected === a.publicKey) || undefined,
  }));
}

module.exports = (ctx) => {
  // Force-clear the keystore module cache so plugin reload picks up changes
  // to keystore.js without requiring a full daemon restart.
  try { delete require.cache[require.resolve("./keystore")]; } catch {}
  const ks = require("./keystore");
  // WAXWING_KEYSTORE_PATH env var overrides the keystore file path so e2e tests
  // can use a temp keystore without touching the user's real keystore.json.
  const FILE = process.env.WAXWING_KEYSTORE_PATH || path.join(ctx.dataDir, "keystore.json");
  // In-memory unlocked keys: publicKey -> privString. Wiped on lock / auto-lock.
  const unlocked = new Map();
  // In-memory sign-intents: id -> intent (built by `send`, broadcast by `confirm`).
  // Single-use, never holds key material, expires. See the sign-intent block below.
  const intents = new Map();
  const INTENT_TTL_MS = 5 * 60 * 1000;
  const DEFAULT_AUTO_LOCK_MS = 10 * 60 * 1000;
  let lockTimer = null;

  // Read auto-lock duration from the store config (persisted), falling back to default.
  function getAutoLockMs() {
    try {
      const store = loadStore(FILE);
      if (store.config && typeof store.config.autoLockMs === "number" && store.config.autoLockMs >= 30000) {
        return store.config.autoLockMs;
      }
    } catch {}
    return DEFAULT_AUTO_LOCK_MS;
  }

  function relock() {
    unlocked.clear();
    intents.clear(); // a locked wallet must not leave a signable intent behind
    if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
  }
  function armAutoLock() {
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = setTimeout(relock, getAutoLockMs());
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

  // Resolve a stored account WITHIN one network's bucket. No selector → the
  // network's selected account, else the first one in that bucket.
  function findAccount(store, netId, sel) {
    const b = bucketOf(store, netId);
    if (!sel) {
      if (b.selected) {
        const pick = b.accounts.find((a) => a.account === b.selected || a.publicKey === b.selected);
        if (pick) return pick;
      }
      return b.accounts[0];
    }
    return b.accounts.find((a) => a.account === sel || a.publicKey === sel || a.label === sel);
  }

  // ── One-password-per-WALLET enforcement (v4 wallet-level) ──────────────
  // The store has a top-level passwordVerifier (null = not set yet).
  //   • First create/import → set the wallet-level verifier from the password.
  //   • Subsequent create/import → verify password MATCHES before encrypting.
  //   • unlock → fast-check verifier before expensive per-key GCM decrypt.
  //   • v2/v3 wallets are auto-migrated on load (per-bucket verifier → top-level).
  function ensureWalletPassword(store, password) {
    if (store.passwordVerifier) {
      // Verifier exists — must match
      if (!ks.verifyPassword(password, store.passwordVerifier)) {
        throw new Error("password does not match this wallet's password");
      }
      return;
    }
    // No verifier yet
    if (hasAnyAccounts(store)) {
      // Existing keys from migration — verify password against first account
      let first;
      for (const [, b] of Object.entries(store.byNet || {})) {
        if (b && b.accounts && b.accounts.length > 0) { first = b.accounts[0]; break; }
      }
      try { ks.decrypt(first, password); }
      catch (e) {
        if (e.message === "bad password") throw new Error("password does not match the existing keys — this wallet was created with a different password");
        throw e; // structural corruption
      }
      // Password correct — upgrade silently
      store.passwordVerifier = ks.createVerifier(password);
      return;
    }
    // First key ever — set the wallet password.
    //
    // ⛔ PRODUCTION GUARD: without WAXWING_KEYSTORE_PATH set, any create/import
    // hitting an empty store via curl/headless will SET the wallet password →
    // contaminates the real keystore (the exact bug that locked CEO out).
    //
    // Two-tier guard:
    //   (A) SOFT — always logs a warning to the daemon console.
    //   (B) HARD — if WAXWING_HARDEN_KEYSTORE=1 is set on the daemon process,
    //       REJECTS the operation outright. The CEO enables this once to
    //       permanently prevent accidental overwrites from curl/headless.
    //   Both guards are skipped when WAXWING_KEYSTORE_PATH is set (test isolation).
    if (!process.env.WAXWING_KEYSTORE_PATH) {
      console.warn("waxwing: creating wallet password verifier on the default keystore. If this is a headless test, set WAXWING_KEYSTORE_PATH to isolate from the user's real keystore.");
      if (process.env.WAXWING_HARDEN_KEYSTORE === "1") {
        throw new Error(
          "wallet is empty — cannot create the first key from the command line. " +
          "Use the panel UI to create your first key and set the wallet password. " +
          "(To allow CLI init, set WAXWING_KEYSTORE_PATH to an explicit path.)"
        );
      }
    }
    store.passwordVerifier = ks.createVerifier(password);
  }

  // Generate a fresh keypair, encrypt the private key, persist it in the target
  // network's bucket (one-off `network` override, else the selected network).
  //
  // Anchor-style auto-resolve: after generating the key, we query the chain via
  // Hyperion /v2/state/get_key_accounts to find which on-chain accounts this key
  // controls. If exactly ONE is found → auto-bind (label + account). If MULTIPLE
  // are found → return the list so the user can pick. If NONE → fall back to the
  // caller-supplied `account` name (or leave unbound for later setaccount).
  async function create(password, account, permission, netSel) {
    if (!password) throw new Error("password required to encrypt the new key");
    const chain = resolveNet(netSel);
    if (account) assertAccountName(account);
    const store = loadStore(FILE);
    ensureWalletPassword(store, password);
    const b = bucketOf(store, chain.id);
    const { PrivateKey } = await wharf();
    const priv = PrivateKey.generate("K1");
    const pub = priv.toPublic().toString();
    const rec = ks.encrypt(priv.toString(), password);

    // Auto-resolve: look up accounts controlled by this public key
    const found = await keyAccounts(chain, pub);
    let boundAccount = account || null;
    let note = "";
    let crossScan = null;
    let targetChain = chain; let targetBucket = b;
    if (!account && found.length === 1) {
      boundAccount = found[0];
      note = `Auto-bound to on-chain account "${boundAccount}" (key controls this account)`;
    } else if (!account && found.length > 1) {
      note = `Found ${found.length} accounts controlled by this key — use "setaccount" to bind one`;
    } else if (!account && found.length === 0) {
      crossScan = await crossNetworkScan(pub, chain.id);
      const otherNets = Object.keys(crossScan);
      if (otherNets.length === 1) {
        // Found on exactly one other network → auto-redirect
        const correctId = otherNets[0];
        targetChain = CHAINS[correctId];
        targetBucket = bucketOf(store, correctId);
        boundAccount = crossScan[correctId][0];
        store.network = correctId;
        note = `Auto-bound to "${boundAccount}" on ${targetChain.name} (key controls this account there, not on ${chain.name})`;
      } else if (otherNets.length > 1) {
        // Multiple networks found — pre-store the key in each found bucket so the
        // user can switch network and bind without re-importing.
        const unboundEntry = {
          label: `key-${pub.slice(-6)}`,
          account: null, permission: permission || "active",
          publicKey: pub, ...rec, createdAt: new Date().toISOString(),
        };
        for (const [netId] of Object.entries(crossScan)) {
          const tb = bucketOf(store, netId);
          if (!tb.accounts.some(a => a.publicKey === pub)) {
            tb.accounts.push({ ...unboundEntry });
          }
        }
        note = `No on-chain accounts found for this key on ${chain.name}. Found on: ${otherNets.map(id => CHAINS[id].name).join(", ")}. Choose a network below.`;
      } else {
        note = `No on-chain accounts found for this key on any configured chain. The key may be fresh or belong to a chain not configured here.`;
      }
    } else if (account) {
      note = "Key stored encrypted. Make sure this public key is set on the account's permission on-chain.";
    }

    const entry = {
      label: boundAccount || `key-${pub.slice(-6)}`,
      account: boundAccount, permission: permission || "active",
      publicKey: pub, ...rec, createdAt: new Date().toISOString(),
    };
    targetBucket.accounts.push(entry);
    if (!targetBucket.selected && entry.account) targetBucket.selected = entry.account;
    saveStore(FILE, store);
    notify();
    const result = {
      created: true, publicKey: pub, account: entry.account, permission: entry.permission,
      network: targetChain.id, note,
    };
    if (found.length > 1 && !account) result.foundAccounts = found;
    if (crossScan && Object.keys(crossScan).length > 0) result.crossScan = crossScan;
    return result;
  }

  // Import an existing private key (PVT_K1_… or legacy WIF 5…) into a network bucket.
  //
  // Anchor-style auto-resolve (same as create): queries Hyperion get_key_accounts
  // to auto-bind on-chain accounts. Single → auto-bind. Multiple → return list.
  // None → fall back to manual binding later.
  async function importKey(password, privkey, account, permission, netSel) {
    if (!password) throw new Error("password required");
    if (!privkey) throw new Error("private key required");
    const chain = resolveNet(netSel);
    if (account) assertAccountName(account);
    const { PrivateKey } = await wharf();
    let priv;
    try { priv = PrivateKey.fromString(String(privkey).trim()); }
    catch (e) { throw new Error("invalid private key format"); }
    const pub = priv.toPublic().toString();
    const store = loadStore(FILE);
    const b = bucketOf(store, chain.id);
    if (b.accounts.some((a) => a.publicKey === pub)) throw new Error(`this key is already in the keystore on ${chain.name}`);
    ensureWalletPassword(store, password);
    const rec = ks.encrypt(priv.toString(), password);

    // Auto-resolve: look up accounts controlled by this public key
    const found = await keyAccounts(chain, pub);
    let boundAccount = account || null;
    let note = "";
    let crossScan = null;
    let targetChain = chain; let targetBucket = b;
    if (!account && found.length === 1) {
      boundAccount = found[0];
      note = `Auto-bound to on-chain account "${boundAccount}" (key controls this account)`;
    } else if (!account && found.length > 1) {
      note = `Found ${found.length} accounts controlled by this key — use "setaccount" to bind one`;
    } else if (!account && found.length === 0) {
      // No accounts on the selected chain — scan others
      crossScan = await crossNetworkScan(pub, chain.id);
      const otherNets = Object.keys(crossScan);
      if (otherNets.length === 1) {
        // Found on exactly one other network → auto-redirect
        const correctId = otherNets[0];
        targetChain = CHAINS[correctId];
        targetBucket = bucketOf(store, correctId);
        // Check duplicate in the correct bucket too
        if (targetBucket.accounts.some((a) => a.publicKey === pub)) throw new Error(`this key is already in the keystore on ${targetChain.name}`);
        boundAccount = crossScan[correctId][0];
        store.network = correctId;
        note = `Auto-bound to "${boundAccount}" on ${targetChain.name} (key controls this account there, not on ${chain.name})`;
      } else if (otherNets.length > 1) {
        // Multiple networks found — pre-store the key in each found bucket so the
        // user can switch network and bind without re-importing.
        const unboundEntry = {
          label: `key-${pub.slice(-6)}`,
          account: null, permission: permission || "active",
          publicKey: pub, ...rec, createdAt: new Date().toISOString(),
        };
        for (const [netId] of Object.entries(crossScan)) {
          const tb = bucketOf(store, netId);
          if (!tb.accounts.some(a => a.publicKey === pub)) {
            tb.accounts.push({ ...unboundEntry });
          }
        }
        note = `No on-chain accounts found for this key on ${chain.name}. Found on: ${otherNets.map(id => CHAINS[id].name).join(", ")}. Choose a network below.`;
      } else {
        note = `No on-chain accounts found for this key on any configured chain. The key may be fresh or belong to a chain not configured here.`;
      }
    } else if (account) {
      note = "Key imported encrypted.";
    }

    const entry = {
      label: boundAccount || `key-${pub.slice(-6)}`,
      account: boundAccount, permission: permission || "active",
      publicKey: pub, ...rec, createdAt: new Date().toISOString(),
    };
    targetBucket.accounts.push(entry);
    if (!targetBucket.selected && entry.account) targetBucket.selected = entry.account;
    saveStore(FILE, store);
    notify();
    const result = { imported: true, publicKey: pub, account: entry.account, permission: entry.permission, network: targetChain.id, note };
    if (found.length > 1 && !account) result.foundAccounts = found;
    if (crossScan && Object.keys(crossScan).length > 0) result.crossScan = crossScan;
    return result;
  }

  // Unlock = decrypt ALL keys from ALL networks into memory after verifying
  // the wallet-level password. One password opens the whole safe — once unlocked,
  // every network's keys are available for signing. The panel can switch networks
  // without re-entering the password.
  //
  // With the wallet-level passwordVerifier (v4):
  //   • Fast-check verifier BEFORE touching any key (avoids expensive scrypt+GCM).
  //   • v2/v3 stores with keys but no verifier are upgraded on first successful unlock.
  //   • One correct password unlocks EVERY key in every bucket.
  async function unlock(password, sel) {
    if (!password) throw new Error("password required");
    const store = loadStore(FILE);

    // Wallet-level verifier check (fast path)
    if (store.passwordVerifier) {
      if (!ks.verifyPassword(password, store.passwordVerifier)) {
        throw new Error("bad password — does not match the wallet password. Check your password and try again.");
      }
    } else {
      // No verifier yet — try decrypt against existing keys
      if (!hasAnyAccounts(store)) throw new Error("no keys in wallet — create or import a key first");
      let first;
      for (const [, b] of Object.entries(store.byNet || {})) {
        if (b && b.accounts && b.accounts.length > 0) { first = b.accounts[0]; break; }
      }
      try { ks.decrypt(first, password); }
      catch (e) {
        if (e.message === "bad password") throw new Error("bad password — none of the keys could be decrypted. Check your password and try again.");
        throw e;
      }
      // Upgrade: create wallet-level verifier from this password
      store.passwordVerifier = ks.createVerifier(password);
      saveStore(FILE, store);
    }

    // Password verified — decrypt ALL keys from ALL networks

    // ── Auto-upgrade old-shape verifier (pre-v0.4.2, no N/r/p embedded) ──
    // When the password is correct but the stored verifier still has the old
    // {algo,salt,check} shape (without scrypt N/r/p), silently re-create it
    // WITH the embedded params so a future KDF bump won't break this wallet.
    // Already-upgraded verifiers (those with N/r/p) are not touched.
    if (store.passwordVerifier
        && (typeof store.passwordVerifier.N !== "number"
            || typeof store.passwordVerifier.r !== "number"
            || typeof store.passwordVerifier.p !== "number")) {
      store.passwordVerifier = ks.createVerifier(password);
      saveStore(FILE, store);
    }

    let ok = 0, total = 0;
    const failures = [];
    for (const [netId, b] of Object.entries(store.byNet || {})) {
      if (!b || !b.accounts) continue;
      for (const a of b.accounts) {
        total++;
        try { unlocked.set(a.publicKey, ks.decrypt(a, password)); ok++; }
        catch (e) { failures.push({ network: netId, label: a.label, account: a.account, publicKey: a.publicKey, reason: String((e && e.message) || e) }); }
      }
    }

    if (total === 0) {
      // Password verified but no keys stored yet — wallet is empty. This is a
      // valid first-run state (e.g. after v3→v4 migration of a wallet that had
      // a verifier but no accounts).
      if (!store.passwordVerifier) throw new Error("no keys in wallet — create or import a key first");
      armAutoLock();
      notify();
      return { unlocked: 0, of: 0, autoLockMs: getAutoLockMs(), networks: [], note: "password verified — no keys stored yet" };
    }

    if (!ok) {
      const reasons = [...new Set(failures.map((f) => f.reason))];
      throw new Error(`corrupt key record(s): ${reasons.join("; ")}`);
    }

    armAutoLock();
    notify();
    const result = { unlocked: ok, of: total, autoLockMs: getAutoLockMs(), networks: [...new Set(Object.keys(store.byNet || {}))] };
    if (failures.length) {
      result.warning = `${failures.length} key(s) failed to unlock`;
      result.failures = failures.map((f) => ({ network: f.network, account: f.account, reason: f.reason }));
    }
    return result;
  }

  function lock() { relock(); notify(); return { locked: true }; }

  function status() {
    const store = loadStore(FILE);
    const net = currentNet();
    const b = bucketOf(store, net.id);

    // Auth lifecycle (v4 wallet-level password):
    //   needsSetup — no password set yet (fresh wallet or migrated v2 with no verifier)
    //   locked     — password exists but no keys decrypted in memory
    //   unlocked   — keys are decrypted and ready to sign
    let auth;
    if (!store.passwordVerifier) {
      auth = "needsSetup";
    } else if (unlocked.size > 0) {
      auth = "unlocked";
    } else {
      auth = "locked";
    }

    return {
      network: publicChain(net),
      networks: Object.values(CHAINS).map(publicChain),
      accounts: publicView(store, net.id), count: b.accounts.length,
      selected: b.selected || null,
      auth,
      unlocked: unlocked.size > 0, unlockedKeys: unlocked.size,
      hasPassword: !!store.passwordVerifier,
      autoLockMs: getAutoLockMs(),
      brand: BRAND,
    };
  }

  // REQ 2 → Anchor-style overview. ONE call returns every stored account on
  // the selected network with its OWN live balance (ALL tokens via Hyperion, not
  // just core symbol) + CPU/NET/RAM, each separate. Unbound keys listed as-is;
  // one bad account can't blank the whole view. This is the shape the panel
  // renders as an account list with per-row token portfolios + resources.
  async function overview(netSel) {
    const chain = resolveNet(netSel);
    const store = loadStore(FILE);
    const b = bucketOf(store, chain.id);
    const out = [];
    for (const a of b.accounts) {
      const base = {
        label: a.label, account: a.account || null, permission: a.permission || "active",
        publicKey: a.publicKey,
        selected: (b.selected === a.account || b.selected === a.publicKey) || undefined,
      };
      if (!a.account) { out.push({ ...base, bound: false, note: "no on-chain account bound" }); continue; }
      try {
        // Fetch resources (CPU/NET/RAM) and ALL token balances in parallel
        const [info, tokens] = await Promise.all([
          accountInfo(chain, a.account),
          tokenBalances(chain, a.account),
        ]);
        out.push({
          ...base, bound: true, coreBalance: info.coreBalance, created: info.created,
          ram: info.ram, cpu: info.cpu, net: info.net, staked: info.staked, rates: info.rates,
          tokens, // full portfolio: [{symbol,precision,amount,contract}, ...]
        });
      } catch (e) {
        out.push({ ...base, bound: true, error: String((e && e.message) || e) });
      }
    }
    return { network: chain.id, count: out.length, accounts: out };
  }

  // Bind / update the on-chain account name + permission for a stored key, within
  // the selected network's bucket. Validates the name (the send-bug fix).
  function setAccount(sel, account, permission, opts) {
    const net = currentNet();
    const store = loadStore(FILE);
    const a = findAccount(store, net.id, sel);
    if (!a) throw new Error(`no stored key matches "${sel}" on ${net.name}`);
    if (account) { assertAccountName(account); a.account = account; a.label = account; }
    if (permission) a.permission = permission;
    const b = bucketOf(store, net.id);
    if (a.account && (!b.selected || (opts && opts.makeSelected))) b.selected = a.account;
    saveStore(FILE, store);
    notify();
    return { ok: true, account: a.account, permission: a.permission, publicKey: a.publicKey, network: net.id };
  }

  // Pick which account is active (the default `from`) on the selected network.
  function selectAccount(sel) {
    if (!sel) throw new Error("which account? pass account / publicKey / label");
    const net = currentNet();
    const store = loadStore(FILE);
    const b = bucketOf(store, net.id);
    const a = b.accounts.find((x) => x.account === sel || x.publicKey === sel || x.label === sel);
    if (!a) throw new Error(`no stored account matches "${sel}" on ${net.name}`);
    b.selected = a.account || a.publicKey;
    saveStore(FILE, store);
    notify();
    return { selected: b.selected, network: net.id };
  }

  function removeKey(sel) {
    if (!sel) throw new Error("which key? pass account / publicKey / label");
    const net = currentNet();
    const store = loadStore(FILE);
    const b = bucketOf(store, net.id);
    const before = b.accounts.length;
    const gone = b.accounts.filter((a) => a.account === sel || a.publicKey === sel || a.label === sel);
    b.accounts = b.accounts.filter((a) => !(a.account === sel || a.publicKey === sel || a.label === sel));
    if (b.accounts.length === before) throw new Error(`no stored key matches "${sel}" on ${net.name}`);
    if (gone.some((a) => b.selected === a.account || b.selected === a.publicKey))
      b.selected = b.accounts[0]?.account || b.accounts[0]?.publicKey || null;
    saveStore(FILE, store);
    notify();
    return { removed: before - b.accounts.length, network: net.id };
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

  // Validate a user-supplied amount the same way (rejects bad input, ignores any
  // symbol — resource builders always format with the chain's core symbol) and
  // return it as a Number for resources.js's builders.
  function amountOf(chain, q) {
    return Number(normalizeQuantity(chain, q).split(" ")[0]);
  }

  // ── Sign-intent contract (confirm-before-broadcast) ──────────────────
  // `send` NO LONGER broadcasts. It fully validates the transfer (account names,
  // bound account, unlocked key, quantity, target network) and returns a
  // human-readable sign-intent for the UI to show in a "Sign?" popup. The popup
  // therefore only ever appears for a transaction that is actually ready to go.
  // `confirm {id}` broadcasts it; `cancel {id}` drops it. Intents are single-use,
  // in-memory, expire after INTENT_TTL_MS, and NEVER hold key material — confirm
  // re-reads the private key from the unlocked set, so a locked/expired wallet
  // can't be tricked into signing after the fact.
  //
  // Contract for Monanisa (UI) — command shapes:
  //   send    {from?, to, quantity|amount, memo?, contract?, network?}
  //             → { ok, confirmRequired:true, intent:{ id, kind, from, to, quantity,
  //                  memo, contract, network, networkId, chainKind, coreSymbol, expiresAt } }
  //   confirm {id}  → { ok, result:{ broadcast:true, txId, explorer, from, to,
  //                  quantity, contract, memo, network, networkId } }
  //   cancel  {id}  → { ok, cancelled:bool, id }
  function pruneIntents() {
    const now = Date.now();
    for (const [id, it] of intents) if (it.expiresAt <= now) intents.delete(id);
  }

  // Register a built intent (shared by transfer + every resource op). The caller
  // has already validated names/quantities and resolved the signer; we only mint
  // the id + TTL, stash the broadcast payload, and return the UI view. The record
  // references the signing key by publicKey ONLY (confirm re-reads it from the
  // `unlocked` map), so a locked/expired wallet can never be tricked into signing.
  //   actions — the on-chain action object(s) to broadcast on confirm
  //   view    — extra fields merged into the returned intent (UI "Sign?" popup)
  //   result  — extra fields merged into confirm's broadcast result
  function registerIntent({ kind, actor, permission, publicKey, networkId, actions, view, result }) {
    pruneIntents();
    const chain = resolveNet(networkId);
    const id = "sx_" + crypto.randomBytes(8).toString("hex");
    const expiresAt = Date.now() + INTENT_TTL_MS;
    intents.set(id, { id, kind, actor, permission, publicKey, networkId, actions, result, expiresAt });
    armAutoLock(); // building an intent counts as activity
    return {
      confirmRequired: true,
      intent: {
        id, kind, ...view,
        network: chain.name, networkId: chain.id, chainKind: chain.kind,
        coreSymbol: chain.coreSymbol, expiresAt,
      },
    };
  }

  // Resolve the signing account for an op: stored on `chain`, bound to an on-chain
  // name, and unlocked. `sel` picks which stored account (default = selected one).
  // Validates the on-chain name loudly (the silent-coercion send bug fix).
  function resolveSigner(store, chain, sel, field = "sender") {
    const rec = findAccount(store, chain.id, sel);
    if (!rec) {
      // If the selector isn't a known stored key, decide WHICH error fits: a
      // publicKey-like or valid-name-looking selector just isn't stored yet →
      // "no stored key"; but a selector with invalid Antelope-name chars (spaces,
      // uppercase, punctuation) is almost certainly a botched account name → run
      // it through assertAccountName so the user gets the clear "invalid name /
      // did you mean" diagnostic instead of the vague "no stored key". This closes
      // the last gap in the silent-coercion send-bug fix (wharfkit's Name.from()
      // used to munge these to '.' and broadcast to a non-existent actor).
      if (sel && !/^PUB_|^EOS/i.test(sel)) assertAccountName(sel, field);
      throw new Error(`no stored key for "${sel || "(default)"}" on ${chain.name}`);
    }
    if (!rec.account) throw new Error(`stored key "${rec.label}" has no on-chain account bound (use setaccount)`);
    const actor = assertAccountName(rec.account, field);
    if (!unlocked.get(rec.publicKey)) throw new Error("wallet is locked — unlock first");
    return { rec, actor, permission: rec.permission || "active" };
  }

  // Build + validate a transfer intent. No broadcast.
  async function send(params) {
    const p = typeof params === "object" ? params : {};
    const chain = resolveNet(p.network);
    const contract = p.contract || "eosio.token";
    const memo = p.memo != null ? String(p.memo) : "";
    if (p.to == null || p.to === "") throw new Error("to (recipient) is required");
    const toName = assertAccountName(p.to, "recipient");
    const quantity = normalizeQuantity(chain, p.quantity || p.amount);

    const store = loadStore(FILE);
    const { rec, actor: fromName, permission } = resolveSigner(store, chain, p.from);
    const action = {
      account: contract, name: "transfer",
      authorization: [{ actor: fromName, permission }],
      data: { from: fromName, to: toName, quantity, memo },
    };
    return registerIntent({
      kind: "transfer", actor: fromName, permission, publicKey: rec.publicKey,
      networkId: chain.id, actions: [action],
      view: { from: fromName, to: toName, quantity, memo, contract },
      result: { kind: "transfer", from: fromName, to: toName, quantity, contract, memo },
    });
  }

  // ── Resource ops (eosio system contract) — all gated like `send` ─────
  // delegatebw / undelegatebw / buyram / buyrambytes / sellram. Each builds a
  // sign-intent (NO immediate broadcast) so it inherits the same single-use,
  // 5-min-TTL, unlock-required confirm gate the transfer path uses. Field names
  // and per-chain asset precision follow resources-spec.md (the eosio account is
  // identical across WAX/EOS/Telos/XPR).

  // Stake CPU/NET (delegatebw). receiver defaults to self (the common case).
  async function stake(params) {
    const p = typeof params === "object" ? params : {};
    const chain = resolveNet(p.network);
    const store = loadStore(FILE);
    const { rec, actor, permission } = resolveSigner(store, chain, p.from);
    const receiver = assertAccountName(p.receiver || actor, "receiver");
    const netAmt = amountOf(chain, p.net != null ? p.net : 0);
    const cpuAmt = amountOf(chain, p.cpu != null ? p.cpu : 0);
    if (netAmt <= 0 && cpuAmt <= 0)
      throw new Error(`nothing to stake — set net and/or cpu (e.g. cpu:"1.0 ${chain.coreSymbol}")`);
    const transfer = p.transfer === true || p.transfer === "true";
    const action = R.stakeCPUNET(actor, receiver, cpuAmt, netAmt, modChain(chain), { transfer });
    action.authorization = [{ actor, permission }];
    const net = action.data.stake_net_quantity, cpu = action.data.stake_cpu_quantity;
    return registerIntent({
      kind: "stake", actor, permission, publicKey: rec.publicKey,
      networkId: chain.id, actions: [action],
      view: { from: actor, receiver, net, cpu, transfer },
      result: { kind: "stake", from: actor, receiver, net, cpu, transfer },
    });
  }

  // Unstake CPU/NET (undelegatebw). Tokens enter a 3-day refund (see spec §2.2).
  async function unstake(params) {
    const p = typeof params === "object" ? params : {};
    const chain = resolveNet(p.network);
    const store = loadStore(FILE);
    const { rec, actor, permission } = resolveSigner(store, chain, p.from);
    const receiver = assertAccountName(p.receiver || actor, "receiver");
    const netAmt = amountOf(chain, p.net != null ? p.net : 0);
    const cpuAmt = amountOf(chain, p.cpu != null ? p.cpu : 0);
    if (netAmt <= 0 && cpuAmt <= 0)
      throw new Error(`nothing to unstake — set net and/or cpu (e.g. cpu:"1.0 ${chain.coreSymbol}")`);
    const action = R.unstakeCPUNET(actor, receiver, cpuAmt, netAmt, modChain(chain));
    action.authorization = [{ actor, permission }];
    const net = action.data.unstake_net_quantity, cpu = action.data.unstake_cpu_quantity;
    return registerIntent({
      kind: "unstake", actor, permission, publicKey: rec.publicKey,
      networkId: chain.id, actions: [action],
      view: { from: actor, receiver, net, cpu, refundDelaySec: 259200 },
      result: { kind: "unstake", from: actor, receiver, net, cpu, refundDelaySec: 259200 },
    });
  }

  // Buy RAM. `bytes` → buyrambytes (exact bytes); otherwise a token `quantity`
  // → buyram (spend that much, market price). receiver defaults to self.
  async function buyRam(params) {
    const p = typeof params === "object" ? params : {};
    const chain = resolveNet(p.network);
    const store = loadStore(FILE);
    const { rec, actor, permission } = resolveSigner(store, chain, p.payer || p.from);
    const receiver = assertAccountName(p.receiver || actor, "receiver");
    let action, view, result;
    if (p.bytes != null && p.bytes !== "") {
      const bytes = parseInt(p.bytes, 10);
      if (!Number.isInteger(bytes) || bytes <= 0)
        throw new Error(`bad bytes "${p.bytes}" — pass a positive integer (e.g. bytes:8192)`);
      action = R.buyRAMBytes(actor, receiver, bytes);
      view = { payer: actor, receiver, bytes };
      result = { kind: "buyrambytes", payer: actor, receiver, bytes };
    } else {
      const amt = amountOf(chain, p.quantity || p.amount);
      if (amt <= 0)
        throw new Error(`buyram needs a positive token amount (e.g. "1.0 ${chain.coreSymbol}") or bytes:N`);
      action = R.buyRAMWithToken(actor, receiver, amt, modChain(chain));
      const quant = action.data.quant;
      view = { payer: actor, receiver, quant };
      result = { kind: "buyram", payer: actor, receiver, quant };
    }
    action.authorization = [{ actor, permission }];
    return registerIntent({
      kind: result.kind, actor, permission, publicKey: rec.publicKey,
      networkId: chain.id, actions: [action], view, result,
    });
  }

  // Sell RAM (sellram). Tokens are returned immediately (no refund delay).
  async function sellRam(params) {
    const p = typeof params === "object" ? params : {};
    const chain = resolveNet(p.network);
    const store = loadStore(FILE);
    const { rec, actor, permission } = resolveSigner(store, chain, p.account || p.from);
    const bytes = parseInt(p.bytes, 10);
    if (!Number.isInteger(bytes) || bytes <= 0)
      throw new Error(`bad bytes "${p.bytes}" — pass a positive integer of RAM bytes to sell`);
    const action = R.sellRAM(actor, bytes);
    action.authorization = [{ actor, permission }];
    return registerIntent({
      kind: "sellram", actor, permission, publicKey: rec.publicKey,
      networkId: chain.id, actions: [action],
      view: { account: actor, bytes },
      result: { kind: "sellram", account: actor, bytes },
    });
  }

  // Broadcast a previously-built intent after the user taps "Sign" in the popup.
  // Action-agnostic: it broadcasts whatever action(s) the intent carries, so
  // transfers and resource ops share one signing path.
  async function confirm(params) {
    const p = typeof params === "object" ? params : {};
    const id = p.id || p._raw;
    if (!id) throw new Error("intent id required (call send first)");
    pruneIntents();
    const it = intents.get(id);
    if (!it) throw new Error("no such sign-intent (expired or already used) — send again");
    const chain = resolveNet(it.networkId);
    const store = loadStore(FILE);
    const rec = bucketOf(store, chain.id).accounts.find((a) => a.publicKey === it.publicKey);
    if (!rec) throw new Error("the intent's account is no longer in the keystore");
    const priv = unlocked.get(it.publicKey);
    if (!priv) throw new Error("wallet is locked — unlock first, then send again");

    const { Session, WalletPluginPrivateKey } = await wharf();
    const session = new Session(
      {
        chain: { id: chain.chainId, url: chain.rpc },
        actor: it.actor, permission: it.permission,
        walletPlugin: new WalletPluginPrivateKey(priv),
      },
      { fetch: closeFetch }, // SessionOptions — must be the 2nd arg
    );
    const actions = it.actions || [];
    const tx = actions.length === 1 ? { action: actions[0] } : { actions };
    const result = await session.transact(tx, { broadcast: true });
    intents.delete(id); // single use
    armAutoLock();       // signing counts as activity
    const txId = String(result.response?.transaction_id || result.resolved?.transaction?.id || "");
    notify();
    return {
      broadcast: true, txId,
      explorer: (txId ? explorerTxUrl(chain.id, txId).primary : null),
      ...it.result,
      network: chain.name, networkId: chain.id,
    };
  }

  // Drop a pending sign-intent (user dismissed the popup).
  function cancel(params) {
    const p = typeof params === "object" ? params : {};
    const id = p.id || p._raw;
    if (!id) throw new Error("intent id required");
    return { cancelled: intents.delete(id), id };
  }

  // Create a brand-new on-chain account on the selected network, bound to a key
  // WE generate and store encrypted (full self-custody). `creator` is an
  // unlocked funded account that pays RAM + stakes CPU/NET.
  async function newAccount(params) {
    const p = typeof params === "object" ? params : {};
    const chain = resolveNet(p.network);
    const creatorSel = p.creator;
    if (!creatorSel) throw new Error("creator (a funded, unlocked account) required");
    // Same loud validator + "did you mean?" diagnostic as every other bind point.
    const name = assertAccountName(p.name, "account");
    const ramBytes = parseInt(p.ram, 10) || 4096;
    const stake = (s) => normalizeQuantity(chain, s || `0.5 ${chain.coreSymbol}`);
    const netStake = stake(p.net), cpuStake = stake(p.cpu);

    const store = loadStore(FILE);
    const creator = findAccount(store, chain.id, creatorSel);
    if (!creator || !creator.account) throw new Error(`no bound stored account for creator "${creatorSel}" on ${chain.name}`);
    const cpriv = unlocked.get(creator.publicKey);
    if (!cpriv) throw new Error("wallet is locked — unlock the creator account first");

    const { PrivateKey, Session, WalletPluginPrivateKey } = await wharf();
    // Use a supplied stored key, or generate+store a fresh one for the new account.
    let pub = p.pubkey;
    let newRec;
    if (!pub) {
      if (!p.password) throw new Error("password required to encrypt the new account's key");
      // Enforce one-password-per-wallet: the new key must be encrypted with the
      // wallet's password (or set it if this is the first key).
      ensureWalletPassword(store, p.password);
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
    if (newRec) { bucketOf(store, chain.id).accounts.push(newRec); saveStore(FILE, store); }
    armAutoLock();
    notify();
    return {
      created: true, account: name, publicKey: pub, ramBytes,
      netStake, cpuStake, creator: creator.account,
      txId, explorer: (txId ? explorerTxUrl(chain.id, txId).primary : null),
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

        // ── Resources: full resource picture + rates ──────────────────
        case "resources": {
          const net = resolveNet(a.network);
          const name = a.name || a.account || parts[0];
          if (!name) return reply({ ok: false, msg: "account name required" });
          const [info, rates] = await Promise.all([
            accountInfo(net, name),
            computeRates(net, name),
          ]);
          return reply({ ok: true, resources: { ...info, rates } });  // rates from computeRates override CPU/NET from accountInfo
        }

        // ── Convert: bidirectional WAX ↔ CPU/NET/RAM ──────────────────
        case "convert": {
          const net = resolveNet(a.network);
          const name = a.name || a.account || parts[0];
          if (!name) return reply({ ok: false, msg: "account name required (to derive rates)" });
          const from = (a.from || "").toLowerCase();   // "wax" | "cpu" | "net" | "ram"
          const to   = (a.to   || "").toLowerCase();   // "wax" | "cpu" | "net" | "ram"
          if (!from || !to) return reply({ ok: false, msg: "from and to required (wax | cpu | net | ram)" });
          if (from === to)  return reply({ ok: false, msg: "from and to must differ" });
          const amount = parseFloat(a.amount);         // wax amount or resource amount
          const bytes  = a.bytes != null ? parseInt(a.bytes, 10) : null; // for ram↔wax with bytes
          if (isNaN(amount) && bytes == null) return reply({ ok: false, msg: "amount (number) or bytes required" });

          const rates = await computeRates(net, name);
          let result = null;
          const fmtWax = (v) => `${v.toFixed(net.corePrecision)} ${net.coreSymbol}`;

          if (from === "wax" && to === "cpu") {
            if (!rates.cpuUsPerWax) return reply({ ok: false, msg: `account ${name} has no CPU stake — cannot compute CPU rate` });
            const us = amount * rates.cpuUsPerWax;
            result = { cpuUs: us, cpuMs: us / 1000, inputWax: fmtWax(amount), rateUsPerWax: rates.cpuUsPerWax };
          } else if (from === "cpu" && to === "wax") {
            if (!rates.cpuUsPerWax) return reply({ ok: false, msg: `account ${name} has no CPU stake — cannot compute CPU rate` });
            const wax = amount / rates.cpuUsPerWax;
            result = { wax: fmtWax(wax), inputCpuUs: amount, inputCpuMs: amount / 1000, rateUsPerWax: rates.cpuUsPerWax };
          } else if (from === "wax" && to === "net") {
            if (!rates.netBytesPerWax) return reply({ ok: false, msg: `account ${name} has no NET stake — cannot compute NET rate` });
            const b = amount * rates.netBytesPerWax;
            result = { netBytes: b, netKb: b / 1024, inputWax: fmtWax(amount), rateBytesPerWax: rates.netBytesPerWax };
          } else if (from === "net" && to === "wax") {
            if (!rates.netBytesPerWax) return reply({ ok: false, msg: `account ${name} has no NET stake — cannot compute NET rate` });
            const wax = amount / rates.netBytesPerWax;
            result = { wax: fmtWax(wax), inputNetBytes: amount, inputNetKb: amount / 1024, rateBytesPerWax: rates.netBytesPerWax };
          } else if (from === "wax" && to === "ram") {
            const qb = parseAssetAmount(rates.ramMarket.quote);
            const bb = parseAssetAmount(rates.ramMarket.base);
            const b = ramBancorBuy(bb, qb, amount);
            result = { ramBytes: b, ramKb: b / 1024, inputWax: fmtWax(amount), ramBytesPerWax: rates.ramBytesPerWax };
          } else if (from === "ram" && to === "wax") {
            const qb = parseAssetAmount(rates.ramMarket.quote);
            const bb = parseAssetAmount(rates.ramMarket.base);
            const b = bytes != null ? bytes : amount; // ram input can be bytes or amount
            const wax = ramBancorSell(bb, qb, b);
            result = { wax: fmtWax(wax), inputRamBytes: b, inputRamKb: b / 1024, ramWaxPerKb: rates.ramWaxPerKb };
          } else {
            return reply({ ok: false, msg: `unsupported conversion: ${from} → ${to}. Supported: wax↔cpu, wax↔net, wax↔ram` });
          }
          return reply({ ok: true, convert: { from, to, ...result, network: net.name } });
        }

        case "create":     return reply({ ok: true, ...(await create(a.password || parts[0], a.account || parts[1], a.permission || parts[2], a.network)) });
        case "import":     return reply({ ok: true, ...(await importKey(a.password || parts[0], a.privkey || a.key || parts[1], a.account || parts[2], a.permission || parts[3], a.network)) });
        case "accounts":   return reply({ ok: true, network: resolveNet(a.network).id, accounts: publicView(loadStore(FILE), resolveNet(a.network).id) });
        case "overview":   return reply({ ok: true, ...(await overview(a.network)) });
        case "unlock":     return reply({ ok: true, ...(await unlock(a.password || parts[0], a.account || parts[1])) });
        case "lock":       return reply({ ok: true, ...lock() });
        case "status":     return reply({ ok: true, status: status() });
        case "setaccount": return reply({ ok: true, ...setAccount(a.select || parts[0], a.account || parts[1], a.permission || parts[2], { makeSelected: a.makeSelected || a.active }) });
        case "select":     return reply({ ok: true, ...selectAccount(a.select || a.account || parts[0]) });
        case "remove":     return reply({ ok: true, ...removeKey(a.select || a.account || parts[0]) });
        case "send":       return reply({ ok: true, ...(await send(a)) });
        case "stake":      return reply({ ok: true, ...(await stake(a)) });
        case "unstake":    return reply({ ok: true, ...(await unstake(a)) });
        case "buyram":     return reply({ ok: true, ...(await buyRam(a)) });
        case "buyrambytes":return reply({ ok: true, ...(await buyRam(a)) });
        case "sellram":    return reply({ ok: true, ...(await sellRam(a)) });
        case "confirm":    return reply({ ok: true, result: await confirm(a) });
        case "cancel":     return reply({ ok: true, ...cancel(a) });
        case "keyaccounts":{
          const net = resolveNet(a.network);
          const pk = a.publicKey || a.pub || parts[0];
          if (!pk) return reply({ ok: false, msg: "publicKey required" });
          const list = await keyAccounts(net, pk);
          return reply({ ok: true, network: net.id, publicKey: pk, accountNames: list, count: list.length });
        }
        case "newaccount": return reply({ ok: true, result: await newAccount(a) });

        // ── Config (auto-lock duration) ────────────────────────────────
        case "config": {
          if (a.autoLockMs !== undefined && a.autoLockMs !== null && a.autoLockMs !== "") {
            const ms = parseInt(a.autoLockMs, 10);
            if (!Number.isInteger(ms) || ms < 30000) throw new Error("autoLockMs must be at least 30000 (30 seconds)");
            const store = loadStore(FILE);
            if (!store.config) store.config = {};
            store.config.autoLockMs = ms;
            saveStore(FILE, store);
            notify();
            return reply({ ok: true, config: { autoLockMs: ms } });
          }
          return reply({ ok: true, config: { autoLockMs: getAutoLockMs() } });
        }

        // ── Export (encrypted backup) ──────────────────────────────────
        // Encrypts the full store (byNet/accounts/selected + passwordVerifier)
        // with the wallet password or a separate export passphrase. Returns a
        // self-contained JSON blob safe to save as a file. NEVER plaintext.
        case "export": {
          const pw = a.password || a.passphrase || parts[0];
          if (!pw) throw new Error("password or export passphrase required");
          const store = loadStore(FILE);
          if (!hasAnyAccounts(store)) throw new Error("wallet is empty — nothing to export");
          const blob = ks.exportWallet(store, pw);
          return reply({ ok: true, export: blob });
        }

        // ── Import (restore from encrypted backup) ─────────────────────
        // Decrypts an export blob and restores the full byNet/accounts/selected.
        // Merges into the current store (replaces byNet and passwordVerifier,
        // keeps current network selection and config). Requires the same password
        // used during export.
        case "importwallet": {
          const pw = a.password || a.passphrase || parts[1] || parts[0];
          if (!pw) throw new Error("password required to decrypt the export");
          let data = a.data;
          if (!data && parts[0]) {
            // Accept raw JSON string as first positional arg
            try { data = JSON.parse(parts[0]); } catch { throw new Error("export data required — pass the JSON blob from the export command"); }
          }
          if (typeof data === "string") { try { data = JSON.parse(data); } catch { throw new Error("invalid export data JSON"); } }
          if (!data || typeof data !== "object") throw new Error("export data required (JSON blob from export command)");
          const imported = ks.importWallet(data, pw);
          const current = loadStore(FILE);
          const merged = {
            version: 4,
            network: current.network,           // keep current network selection
            passwordVerifier: imported.passwordVerifier,
            config: current.config || {},
            byNet: imported.byNet,
          };
          saveStore(FILE, merged);
          // Count total accounts imported
          let totalAccts = 0;
          for (const [, b] of Object.entries(imported.byNet || {})) {
            if (b && b.accounts) totalAccts += b.accounts.length;
          }
          notify();
          return reply({ ok: true, imported: true, network: merged.network, accountsImported: totalAccts });
        }

        default:           return reply({ ok: false, msg: `unknown command: ${cmd}` });
      }
    } catch (e) {
      const errRes = { ok: false, msg: String((e && e.message) || e) }; if (e && e.code === "CROSS_NETWORK_KEY" && e.crossScan) errRes.crossScan = e.crossScan; return reply(errRes);
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
module.exports._test = { rpc, chainInfo, accountInfo, tokenBalance, history, hyperionGet, keyAccounts, tokenBalances, parseAssetAmount, getRAMMarket, ramBancorBuy, ramBancorSell, computeRates, CHAINS, DEFAULT_NET, BRAND, wharf, publicChain, loadStore, saveStore, bucketOf, publicView, assertAccountName, NAME_RE, emptyBucket, hasAnyAccounts };
