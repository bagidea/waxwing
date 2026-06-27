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
    rpcs: ["https://waxtestnet.greymass.com", "https://wax-testnet.eosphere.io", "https://testnet.wax.pink.gg"],
    history: "https://testnet.waxsweden.org",
    historys: ["https://wax-testnet.eosphere.io"],
    chainId: "f16b1833c747c43682f4386fca9cbb327929334a762755ebec17f6f23c9b8a12",
    explorerTx: "https://testnet.waxblock.io/transaction/",
    explorerTxFallback: "https://wax-test.bloks.io/transaction/",
    coreSymbol: "WAX", corePrecision: 8,
    features: { atomicAssets: true, atomicMarket: true },
    atomicAssets: {
      assetsContract: "atomicassets",
      marketContract: "atomicmarket",
      apiPath: "/atomicassets/v1",
      marketApiPath: "/atomicmarket/v1",
      endpoints: ["https://test.wax.api.atomicassets.io"],
    },
  },
  "wax-mainnet": {
    id: "wax-mainnet", name: "WAX Mainnet", kind: "mainnet",
    rpc: "https://wax.greymass.com",
    rpcs: ["https://wax.eosphere.io", "https://wax.pink.gg", "https://wax.cryptolions.io"],
    history: "https://wax.eosphere.io",
    historys: ["https://wax.greymass.com"],
    chainId: "1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4",
    explorerTx: "https://waxblock.io/transaction/",
    explorerTxFallback: "https://wax.bloks.io/transaction/",
    coreSymbol: "WAX", corePrecision: 8,
    features: { atomicAssets: true, atomicMarket: true },
    atomicAssets: {
      assetsContract: "atomicassets",
      marketContract: "atomicmarket",
      apiPath: "/atomicassets/v1",
      marketApiPath: "/atomicmarket/v1",
      endpoints: [
        "https://atomic.wax.eosrio.io",      // verified OK, in sync
        "https://wax-atomic-api.eosphere.io", // verified OK, in sync
        "https://wax-aa.eu.eosamsterdam.net", // verified OK
        "https://wax.api.atomicassets.io",   // official pink.network; may be blocked by CDN
      ],
    },
  },
  "eos-testnet": { // Jungle4
    id: "eos-testnet", name: "EOS Jungle4 (testnet)", kind: "testnet",
    rpc: "https://jungle4.greymass.com",
    rpcs: ["https://jungle4.eosusa.io", "https://jungle4.eosdac.io"],
    history: "https://jungle4.history.eosnation.io",
    historys: ["https://jungle4.greymass.com"],
    chainId: "73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d",
    explorerTx: "https://jungle4.eosq.eosnation.io/tx/",
    explorerTxFallback: "https://jungle4.bloks.io/transaction/",
    coreSymbol: "EOS", corePrecision: 4,
    features: { atomicAssets: false, atomicMarket: false },
  },
  "eos-mainnet": {
    id: "eos-mainnet", name: "EOS Mainnet", kind: "mainnet",
    rpc: "https://eos.greymass.com",
    rpcs: ["https://eos.eosphere.io", "https://eos.api.eosnation.io", "https://eos.eosusa.io"],
    history: "https://eos.hyperion.eosrio.io",
    historys: ["https://eos.eosphere.io", "https://eos.api.eosnation.io"],
    chainId: "aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906",
    explorerTx: "https://bloks.io/transaction/",
    explorerTxFallback: "https://eos.eosq.eosnation.io/tx/",
    coreSymbol: "EOS", corePrecision: 4,
    features: { atomicAssets: false, atomicMarket: false },
  },
  // Telos — RPC + Hyperion v2 share one host (live-verified 2026-06-24).
  "telos-testnet": {
    id: "telos-testnet", name: "Telos Testnet", kind: "testnet",
    rpc: "https://testnet.telos.net",
    rpcs: ["https://telos-testnet.eosphere.io"],
    history: "https://testnet.telos.net",
    historys: ["https://telos-testnet.eosphere.io"],
    chainId: "1eaa0824707c8c16bd25145493bf062aecddfeb56c736f6ba6397f3195f33c9f",
    explorerTx: "https://explorer.telos.net/transaction/",
    explorerTxFallback: "https://telos-test.bloks.io/transaction/",
    coreSymbol: "TLOS", corePrecision: 4,
    features: { atomicAssets: false, atomicMarket: false },
  },
  "telos-mainnet": {
    id: "telos-mainnet", name: "Telos Mainnet", kind: "mainnet",
    rpc: "https://mainnet.telos.net",
    rpcs: ["https://telos.eosphere.io", "https://telos.api.eosnation.io"],
    history: "https://mainnet.telos.net",
    historys: ["https://telos.eosphere.io", "https://telos.api.eosnation.io"],
    chainId: "4667b205c6838ef70ff7988f6e8257e8be0e1284a2f59699054a018f743b1d11",
    explorerTx: "https://explorer.telos.net/transaction/",
    explorerTxFallback: "https://telos.bloks.io/transaction/",
    coreSymbol: "TLOS", corePrecision: 4,
    features: { atomicAssets: false, atomicMarket: false },
  },
  // XPR Network (Proton) — RPC (eosusa) + Hyperion (saltant) on separate hosts.
  "xpr-testnet": {
    id: "xpr-testnet", name: "XPR Network Testnet", kind: "testnet",
    rpc: "https://test.proton.eosusa.io",
    rpcs: ["https://proton-testnet.eosphere.io"],
    history: "https://test.proton.eosusa.io",
    historys: [],
    chainId: "71ee83bcf52142d61019d95f9cc5427ba6a0d7ff8accd9e2088ae2abeaf3d3dd",
    explorerTx: "https://explorer.xprnetwork.org/transaction/",
    explorerTxFallback: "https://proton-test.bloks.io/transaction/",
    coreSymbol: "XPR", corePrecision: 4,
    features: { atomicAssets: false, atomicMarket: false },
  },
  "xpr-mainnet": {
    id: "xpr-mainnet", name: "XPR Network (Proton)", kind: "mainnet",
    rpc: "https://proton.eosusa.io",
    rpcs: ["https://proton.cryptolions.io"],
    history: "https://api-xprnetwork-main.saltant.io",
    historys: [],
    chainId: "384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0",
    explorerTx: "https://explorer.xprnetwork.org/transaction/",
    explorerTxFallback: "https://proton.bloks.io/transaction/",
    coreSymbol: "XPR", corePrecision: 4,
    features: { atomicAssets: false, atomicMarket: false },
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

// Per-chain feature flags for optional subsystems.
function chainFeatures(chain) {
  const aa = !!(chain.atomicAssets && chain.features?.atomicAssets);
  return {
    atomicAssets: aa,
    atomicMarket: aa && !!(chain.atomicAssets?.marketContract && chain.features?.atomicMarket),
  };
}
function assetsContract(chain) { return chain.atomicAssets?.assetsContract || "atomicassets"; }
function marketContract(chain) { return chain.atomicAssets?.marketContract || "atomicmarket"; }
function aaApiPath(chain) { return chain.atomicAssets?.apiPath || "/atomicassets/v1"; }
function marketApiPath(chain) { return chain.atomicAssets?.marketApiPath || "/atomicmarket/v1"; }

// Public, key-safe view of a chain config (sent to the panel).
function publicChain(c) {
  return {
    id: c.id, name: c.name, kind: c.kind, rpc: c.rpc,
    chainId: c.chainId, explorerTx: c.explorerTx, explorerTxFallback: c.explorerTxFallback,
    coreSymbol: c.coreSymbol, corePrecision: c.corePrecision,
    features: chainFeatures(c),
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

// ── RPC endpoint health + automatic fallback rotation ──────────────────
// Each chain has a primary `rpc` plus an `rpcs` failover list. Before every
// call we check the cache (TTL 60 s); on cache miss we health-check every
// candidate with get_info (5 s timeout each). The first healthy one is
// cached and written back to chain.rpc in-place so wharfkit Sessions pick it
// up too. On any rpc() network failure we invalidate the cache + re-run the
// health check so the next call rotates automatically.
// Same pattern for history (Hyperion v2) endpoints with a 120 s TTL.
// — Yamamoto flag, PLATFORM-ARCHITECTURE.md §RPC
const _rpcHealth = new Map();           // netId → { url, ts }
const RPC_HEALTH_TTL_MS = 60_000;       // re-verify every 60 s
const RPC_HEALTH_TIMEOUT_MS = 5_000;    // per-candidate timeout

function _rpcCandidates(chain) {
  const seen = new Set();
  const out = [];
  if (chain.rpc) { seen.add(chain.rpc); out.push(chain.rpc); }
  if (Array.isArray(chain.rpcs)) {
    for (const url of chain.rpcs) {
      if (!seen.has(url)) { seen.add(url); out.push(url); }
    }
  }
  return out;
}

async function _pickHealthyRpc(chain) {
  // Warm cache — return instantly
  const cached = _rpcHealth.get(chain.id);
  if (cached && (Date.now() - cached.ts) < RPC_HEALTH_TTL_MS) {
    chain.rpc = cached.url;
    return cached.url;
  }

  const candidates = _rpcCandidates(chain);
  if (!candidates.length) throw new Error(`no RPC endpoints configured for ${chain.id}`);

  const errors = [];
  for (const url of candidates) {
    try {
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), RPC_HEALTH_TIMEOUT_MS);
      const res = await fetch(`${url}/v1/chain/get_info`, {
        method: "POST",
        headers: { "content-type": "application/json", connection: "close" },
        body: JSON.stringify({}),
        signal: ctl.signal,
      });
      clearTimeout(tm);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.chain_id) throw new Error("no chain_id in response");
      if (json.chain_id !== chain.chainId) {
        throw new Error(`chain_id mismatch (got ${String(json.chain_id).slice(0, 14)}…)`);
      }
      // Healthy — cache and update chain.rpc in-place
      _rpcHealth.set(chain.id, { url, ts: Date.now() });
      chain.rpc = url;
      return url;
    } catch (e) {
      errors.push(`${url}: ${(e && e.message) || e}`);
    }
  }

  _rpcHealth.delete(chain.id);
  throw new Error(`all ${candidates.length} RPC endpoint(s) unreachable for ${chain.id}: ${errors.join("; ")}`);
}

function _invalidateRpc(netId) { _rpcHealth.delete(netId); }

// ── History (Hyperion v2) endpoint health — same pattern, longer TTL ──
const _historyHealth = new Map();
const HISTORY_HEALTH_TTL_MS = 120_000;

function _historyCandidates(chain) {
  const seen = new Set();
  const out = [];
  if (chain.history) { seen.add(chain.history); out.push(chain.history); }
  if (Array.isArray(chain.historys)) {
    for (const url of chain.historys) {
      if (!seen.has(url)) { seen.add(url); out.push(url); }
    }
  }
  return out;
}

async function _pickHealthyHistory(chain) {
  const cached = _historyHealth.get(chain.id);
  if (cached && (Date.now() - cached.ts) < HISTORY_HEALTH_TTL_MS) {
    chain.history = cached.url;
    return cached.url;
  }

  const candidates = _historyCandidates(chain);
  if (!candidates.length) throw new Error(`no history endpoints configured for ${chain.id}`);

  const errors = [];
  for (const url of candidates) {
    try {
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), RPC_HEALTH_TIMEOUT_MS);
      const res = await fetch(`${url}/v2/health`, {
        headers: { connection: "close" },
        signal: ctl.signal,
      });
      clearTimeout(tm);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || typeof json !== "object") throw new Error("invalid health response");
      _historyHealth.set(chain.id, { url, ts: Date.now() });
      chain.history = url;
      return url;
    } catch (e) {
      errors.push(`${url}: ${(e && e.message) || e}`);
    }
  }

  _historyHealth.delete(chain.id);
  throw new Error(`all ${candidates.length} history endpoint(s) unreachable for ${chain.id}: ${errors.join("; ")}`);
}

function _invalidateHistory(netId) { _historyHealth.delete(netId); }

// ── Read-only chain RPC (no key involved); chain-scoped ──────────────
// Uses _pickHealthyRpc to ensure the endpoint is alive before calling. On
// network failure the cache is invalidated and a fresh health check picks
// the next candidate, so a dead node only costs one retry.
async function rpc(chain, endpoint, body, _retried) {
  let rpcUrl;
  try {
    rpcUrl = await _pickHealthyRpc(chain);
  } catch (e) {
    throw new Error(`RPC unreachable (${chain.id}): ${e.message}`);
  }

  const url = `${rpcUrl}/v1/chain/${endpoint}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify(body || {}),
    });
  } catch (e) {
    if (!_retried) {
      // Rotate: clear the cached healthy endpoint + re-run health check
      _invalidateRpc(chain.id);
      return rpc(chain, endpoint, body, true);
    }
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

// ── AtomicAssets NFT deserialization ─────────────────────────────────
// The AtomicAssets contract stores immutable/mutable data as a packed byte
// vector. The schema's `format` array is the ABI: each present field is
// prefixed with a varint identifier = format_line_index + RESERVED (4).
// Decoding mirrors the C++ code in atomicdata.hpp exactly.
const AA_RESERVED = 4;
const AA_CACHE_TTL_MS = 30 * 1000;

function aaReadVarint(bytes, posRef) {
  let number = 0;
  let multiplier = 1;
  while (true) {
    if (posRef.pos >= bytes.length) throw new Error("Read past end of AtomicAssets buffer");
    const b = bytes[posRef.pos++];
    if (b >= 128) {
      number += (b - 128) * multiplier;
      multiplier *= 128;
    } else {
      number += b * multiplier;
      return number;
    }
  }
}

function aaReadFixedUint(bytes, n, posRef) {
  let v = 0;
  for (let i = 0; i < n; i++) v += bytes[posRef.pos++] * Math.pow(256, i);
  return v;
}

function aaReadFixedInt(bytes, n, posRef) {
  let v = aaReadFixedUint(bytes, n, posRef);
  const max = Math.pow(256, n);
  if (v >= max / 2) v -= max;
  return v;
}

function aaReadZigzag(bytes, posRef) {
  const raw = aaReadVarint(bytes, posRef);
  return raw % 2 === 0 ? raw / 2 : -Math.floor(raw / 2) - 1;
}

function aaReadString(bytes, posRef) {
  const len = aaReadVarint(bytes, posRef);
  if (posRef.pos + len > bytes.length) throw new Error("AtomicAssets string overruns buffer");
  const slice = bytes.slice(posRef.pos, posRef.pos + len);
  posRef.pos += len;
  return Buffer.from(slice).toString("utf8");
}

// base58btc (Bitcoin alphabet) encoder — zero-dep. Used to turn the RAW
// multihash bytes that AtomicAssets stores for ipfs/image fields back into a
// CID string (a 0x12 0x20-prefixed sha2-256 multihash -> CIDv0 "Qm…").
const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58btcEncode(bytes) {
  if (!bytes || bytes.length === 0) return "";
  const input = Array.from(bytes);
  let zeros = 0;
  while (zeros < input.length && input[zeros] === 0) zeros++;
  const out = [];
  let start = zeros;
  while (start < input.length) {
    let remainder = 0;
    for (let i = start; i < input.length; i++) {
      const acc = remainder * 256 + input[i];
      input[i] = Math.floor(acc / 58);
      remainder = acc % 58;
    }
    out.push(remainder);
    while (start < input.length && input[start] === 0) start++;
  }
  let str = "";
  for (let i = 0; i < zeros; i++) str += B58_ALPHABET[0];
  for (let i = out.length - 1; i >= 0; i--) str += B58_ALPHABET[out[i]];
  return str;
}

// ipfs / image fields: AtomicAssets serializes these as a length-prefixed RAW
// byte vector (the decoded IPFS multihash), NOT a UTF-8 string. Reading them as
// a string yields garbage ("\x12\x20…"). Base58btc-encode the raw bytes to get
// the CID back. A few collections instead store a literal CID/URL string — if
// the bytes are all printable ASCII, keep them verbatim.
function aaReadIpfs(bytes, posRef) {
  const len = aaReadVarint(bytes, posRef);
  if (posRef.pos + len > bytes.length) throw new Error("AtomicAssets ipfs overruns buffer");
  const slice = bytes.slice(posRef.pos, posRef.pos + len);
  posRef.pos += len;
  if (slice.length === 0) return "";
  const printable = Array.from(slice).every((b) => b >= 0x20 && b < 0x7f);
  if (printable) return Buffer.from(slice).toString("utf8");
  return base58btcEncode(slice);
}

function aaReadAttribute(bytes, type, posRef) {
  const base = type.replace(/\[\]$/, "");
  const isArray = type.endsWith("[]");
  const readScalar = () => {
    switch (base) {
      case "int8": return aaReadZigzag(bytes, posRef);
      case "int16": return aaReadZigzag(bytes, posRef);
      case "int32": return aaReadZigzag(bytes, posRef);
      case "int64": return aaReadZigzag(bytes, posRef);
      case "uint8": return aaReadVarint(bytes, posRef);
      case "uint16": return aaReadVarint(bytes, posRef);
      case "uint32": return aaReadVarint(bytes, posRef);
      case "uint64": return aaReadVarint(bytes, posRef);
      case "fixed8": case "byte": return aaReadFixedInt(bytes, 1, posRef);
      case "fixed16": return aaReadFixedInt(bytes, 2, posRef);
      case "fixed32": return aaReadFixedInt(bytes, 4, posRef);
      case "fixed64": return aaReadFixedInt(bytes, 8, posRef);
      case "float": {
        const arr = new Uint8Array(4);
        for (let i = 0; i < 4; i++) arr[i] = bytes[posRef.pos++];
        return new DataView(arr.buffer).getFloat32(0, true);
      }
      case "double": {
        const arr = new Uint8Array(8);
        for (let i = 0; i < 8; i++) arr[i] = bytes[posRef.pos++];
        return new DataView(arr.buffer).getFloat64(0, true);
      }
      case "string": return aaReadString(bytes, posRef);
      case "image": case "ipfs": return aaReadIpfs(bytes, posRef);
      case "bool": return bytes[posRef.pos++] !== 0;
      default: throw new Error(`unsupported AtomicAssets type "${base}"`);
    }
  };
  if (isArray) {
    const count = aaReadVarint(bytes, posRef);
    const out = [];
    for (let i = 0; i < count; i++) out.push(readScalar());
    return out;
  }
  return readScalar();
}

function aaBytes(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === "string" && input.length > 0) {
    const hex = input.startsWith("0x") ? input.slice(2) : input;
    if (/^[0-9a-fA-F]*$/.test(hex)) {
      const out = [];
      for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
      return out;
    }
  }
  return [];
}

function deserializeAtomicData(input, format) {
  const bytes = aaBytes(input);
  if (bytes.length === 0) return {};
  const posRef = { pos: 0 };
  const result = {};
  while (posRef.pos < bytes.length) {
    const identifier = aaReadVarint(bytes, posRef);
    const idx = identifier - AA_RESERVED;
    if (idx < 0 || idx >= format.length) throw new Error(`AtomicAssets identifier ${identifier} out of range`);
    const line = format[idx];
    result[line.name] = aaReadAttribute(bytes, line.type, posRef);
  }
  return result;
}

// In-memory cache for AtomicAssets metadata. TTL = 30s, never disk (privacy decision).
// Covers schemas, templates, collections. Cleared on plugin reload; never written to disk.
const _aaCache = new Map();
function aaCacheGet(key) {
  const entry = _aaCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > AA_CACHE_TTL_MS) { _aaCache.delete(key); return null; }
  return entry.data;
}
function aaCacheSet(key, data) { _aaCache.set(key, { data, ts: Date.now() }); }
function aaCacheClear() { _aaCache.clear(); }
function aaCacheKeys(pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const out = [];
  for (const k of _aaCache.keys()) if (re.test(k)) out.push(k);
  return out;
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
async function history(chain, name, limit, _retried) {
  if (!name) throw new Error("account name required");
  const n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  let historyUrl;
  try {
    historyUrl = await _pickHealthyHistory(chain);
  } catch (e) {
    throw new Error(`history endpoint unreachable (${chain.id}): ${e.message}`);
  }
  const url = `${historyUrl}/v2/history/get_actions?account=${encodeURIComponent(name)}&limit=${n}&simple=true&sort=desc`;
  let res;
  try { res = await fetch(url, { headers: { connection: "close" } }); }
  catch (e) {
    if (!_retried) { _invalidateHistory(chain.id); return history(chain, name, limit, true); }
    throw new Error(`history endpoint unreachable: ${e?.cause?.code || e.message}`);
  }
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
async function hyperionGet(chain, endpoint, params, _retried) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  let historyUrl;
  try {
    historyUrl = await _pickHealthyHistory(chain);
  } catch (e) {
    throw new Error(`Hyperion unreachable (${chain.id}): ${e.message}`);
  }
  const url = `${historyUrl}/v2/state/${endpoint}?${qs}`;
  let res;
  try { res = await fetch(url, { headers: { connection: "close" } }); }
  catch (e) {
    if (!_retried) { _invalidateHistory(chain.id); return hyperionGet(chain, endpoint, params, true); }
    throw new Error(`Hyperion unreachable (${chain.id}): ${e?.cause?.code || e.message}`);
  }
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

// ── AtomicAssets media + IPFS helpers (Phase B/C) ─────────────────────
// Sahara verified gateway order (Research Board, 2026-06-26):
//   1) resizer.atomichub.io — thumbnail/fast preview (adds ?size=N)
//   2) ipfs.io — public full-res gateway
//   3) dweb.link — public full-res fallback
// DEAD (do not use): cloudflare-ipfs.com, ipfs.atomichub.io, atomichub-ipfs.com
const IPFS_GATEWAYS = {
  thumbnail: "https://resizer.atomichub.io/images/v1/preview?ipfs=",
  full: ["https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"],
};

// AtomicAssets media field convention (verified live):
//   img / image / backimg / video / audio / glb  (type often = "image" or "ipfs")
// Values are usually bare IPFS CIDs, sometimes CID/path/file.ext, sometimes full http(s) URLs.
const AA_MEDIA_FIELDS = ["img", "image", "backimg", "video", "audio", "glb"];
const AA_MEDIA_TYPES = new Map([
  ["video", ["mp4", "webm", "mov"]],
  ["audio", ["mp3", "wav", "ogg", "flac"]],
  ["glb", ["glb", "gltf"]],
  ["image", ["png", "jpg", "jpeg", "gif", "webp", "svg"]],
]);

function extOf(url) {
  try {
    const u = new URL(String(url).replace(/^ipfs:\/\//, "https://x/"));
    const pathname = u.pathname || "";
    const match = pathname.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
    return match ? match[1].toLowerCase() : null;
  } catch { return null; }
}

function detectMediaType(url) {
  const ext = extOf(url);
  if (!ext) return "image";
  for (const [type, exts] of AA_MEDIA_TYPES) if (exts.includes(ext)) return type;
  return "image";
}

function stripIpfsPrefix(s) {
  const v = String(s).trim();
  if (v.startsWith("ipfs://")) return v.slice(7);
  return v;
}

function ipfsUrl(cid, opts = {}) {
  if (!cid) return null;
  const v = stripIpfsPrefix(cid);
  if (/^https?:\/\//i.test(v)) return v;
  if (opts.thumbnail) {
    const size = opts.size || 370;
    return `${IPFS_GATEWAYS.thumbnail}${encodeURIComponent(v)}&size=${size}`;
  }
  const gateway = IPFS_GATEWAYS.full[opts.gatewayIndex || 0] || IPFS_GATEWAYS.full[0];
  return gateway + v;
}

// Build a full-res fallback chain for <img srcset> / JS retry.
function ipfsUrlSet(cid, opts = {}) {
  const url = ipfsUrl(cid, opts);
  if (!url) return [];
  const v = stripIpfsPrefix(cid);
  if (/^https?:\/\//i.test(v)) return [url];
  return IPFS_GATEWAYS.full.map((g) => g + v);
}

function resolveMediaUrl(value, opts = {}) {
  if (!value) return null;
  const v = stripIpfsPrefix(value);
  if (/^https?:\/\//i.test(v)) return v;
  return ipfsUrl(v, opts);
}

function extractMedia(immutable, templateImmutable) {
  const merged = { ...(templateImmutable || {}), ...(immutable || {}) };
  for (const field of AA_MEDIA_FIELDS) {
    const v = merged[field];
    if (v != null && String(v).trim()) {
      const raw = String(v).trim();
      return { field, type: detectMediaType(raw), url: resolveMediaUrl(raw, { thumbnail: field === "backimg" }) };
    }
  }
  return null;
}

// Backwards-compatible image helper used by older callers.
function primaryImageUrl(immutable, templateImmutable) {
  const m = extractMedia(immutable, templateImmutable);
  return m && (m.type === "image" || m.type === "video" || m.type === "glb") ? m.url : null;
}

// ── Light Marketplace (AtomicMarket) — WAX only, testnet default ─────
// The read side (browse/listing/price) goes through the AtomicMarket HTTP
// indexer (layer b): it does the filter/sort/pagination the on-chain table
// can't. The write side (list/buy) builds sign-intents grounded in the LIVE
// atomicmarket/atomicassets ABI (verified 2026-06-26, not guessed) and shares
// the same confirm gate — nothing broadcasts here. Media CIDs from the indexer
// are already decoded CIDv0 (Qm…), so they flow straight through ipfsUrl() like
// inventory media. AtomicMarket runs on WAX only, so the commands hard-refuse on
// other chains rather than hit a 404.
//
// AA/AM endpoints and contract names now live in each chain's `atomicAssets`
// block so chains without AtomicAssets (EOS/Telos/XPR today) simply return
// features.atomicAssets/atomicMarket=false instead of throwing.

function aaReadOf(chain) {
  const cfg = chain.atomicAssets;
  if (!cfg || !Array.isArray(cfg.endpoints) || !cfg.endpoints.length) {
    throw new Error(`AtomicAssets read API not available on ${chain.name} — switch to a wax-* network`);
  }
  return cfg;
}

// Helper: fetch with a timeout without depending on AbortSignal.timeout availability.
function fetchWithTimeout(url, ms = 10000, init = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(t));
}

// Quick health probe: returns true only if the host is reachable, returns valid JSON,
// data.chain.status is "OK", and head_block is within maxLag of the provided tip.
async function aaHealthOk(base, tip, maxLag = 120) {
  let res;
  try { res = await fetchWithTimeout(`${base}/health`, 8000, { headers: { connection: "close" } }); }
  catch { return false; }
  if (!res.ok) return false;
  let json;
  try { json = await res.json(); } catch { return false; }
  if (!json || json.success !== true) return false;
  const head = json.data?.chain?.head_block;
  if (!head || json.data?.chain?.status !== "OK") return false;
  if (tip != null && Math.abs(Number(tip) - Number(head)) > maxLag) return false;
  return true;
}

// Fetch a path from the AtomicAssets/AtomicMarket HTTP API, walking the endpoint chain
// until one succeeds. If no endpoint is healthy, falls back to trying them without a
// health probe (best-effort) so transient health failures don't hard-block reads.
async function atomicApiGet(chain, namespacePath, { requireHealth = false } = {}) {
  const cfg = aaReadOf(chain);
  const errors = [];
  for (const base of cfg.endpoints) {
    const url = `${base}${namespacePath}`;
    try {
      const res = await fetchWithTimeout(url, 15000, { headers: { connection: "close" } });
      if (!res.ok) { errors.push(`${base}: HTTP ${res.status}`); continue; }
      const json = await res.json();
      if (json && json.success === false) { errors.push(`${base}: API error ${json.message || "unknown"}`); continue; }
      if (json && json.success === true) return json;
      errors.push(`${base}: unexpected response`);
    } catch (e) {
      errors.push(`${base}: ${e?.cause?.code || e.message}`);
    }
  }
  throw new Error(`AtomicAssets API unreachable (${chain.id}): ${errors.join("; ")}`);
}

function marketOf(chain) {
  const cfg = aaReadOf(chain);
  return { contract: cfg.marketContract };
}

async function marketApiGet(chain, pathSuffix) {
  const json = await atomicApiGet(chain, `${marketApiPath(chain)}${pathSuffix}`);
  return json;
}

// Indexer price object → human view (decimal amount from raw + precision).
function marketPriceView(price) {
  if (!price) return null;
  const prec = Number(price.token_precision || 0);
  const amount = Number(price.amount || 0) / Math.pow(10, prec);
  return {
    amount,
    display: `${amount.toFixed(prec)} ${price.token_symbol}`,
    token_symbol: price.token_symbol,
    token_precision: prec,
    token_contract: price.token_contract,
    raw: String(price.amount),
  };
}

// One indexer asset → compact card. CID (img/image/backimg) is decoded CIDv0 already.
// Uses extractMedia for template-fallback — when the asset itself has no media,
// the template's immutable_data often carries the canonical image. Collection img
// is the ultimate fallback so junk testnet entries without any image at least show
// the collection logo instead of a blank placeholder.
function marketAssetView(a) {
  const data = a.data || {};
  // Template fallback: when the asset's own data has no media field, the
  // template's immutable_data often carries the canonical image (same pattern
  // as apiAssetView→extractMedia). The API's `data` merge usually already
  // includes template fields, but this is hardening — if the merge is ever
  // incomplete, the template provides a safety net.
  const templateImmutable = (a.template && a.template.immutable_data) ? a.template.immutable_data : {};
  const foundMedia = extractMedia(data, templateImmutable);

  // Recover the raw CID from whichever field extractMedia picked — we need it
  // for the thumbnail gateway (ipfsUrl with thumbnail:true) since
  // extractMedia's url is already the full-size gateway URL.
  let cid = null;
  if (foundMedia) {
    const f = foundMedia.field;
    cid = data[f] || templateImmutable[f] || null;
  }

  // Collection image as ultimate fallback: when neither asset data nor the
  // template carries an image, the collection often has a logo (img /
  // images.logo_512x512) that gives the tile a meaningful visual instead of
  // a blank placeholder.
  if (!cid && a.collection) {
    let colImg = a.collection.img;
    if (!colImg && a.collection.images) {
      try {
        const imgs = typeof a.collection.images === "string"
          ? JSON.parse(a.collection.images)
          : a.collection.images;
        colImg = imgs.logo_512x512 || imgs.banner_1920x500 || null;
      } catch { /* malformed images JSON — stay null */ }
    }
    if (colImg) cid = String(colImg).trim() || null;
  }

  return {
    asset_id: String(a.asset_id),
    name: a.name || data.name || null,
    collection: (a.collection && a.collection.collection_name) || a.collection_name || null,
    schema: (a.schema && a.schema.schema_name) || null,
    template_id: (a.template && a.template.template_id) || null,
    media: cid
      ? { type: detectMediaType(String(cid)), url: resolveMediaUrl(String(cid)), thumb: ipfsUrl(String(cid), { thumbnail: true }) }
      : null,
  };
}

function marketSaleView(s) {
  const assets = Array.isArray(s.assets) ? s.assets : [];
  return {
    sale_id: String(s.sale_id),
    state: s.state,
    seller: s.seller,
    buyer: s.buyer || null,
    price: marketPriceView(s.price),
    collection: (s.collection && s.collection.collection_name) || s.collection_name || null,
    asset_ids: assets.map((x) => String(x.asset_id)),
    assets: assets.map(marketAssetView),
    maker_marketplace: s.maker_marketplace || null,
    created_at_time: s.created_at_time,
    updated_at_time: s.updated_at_time,
  };
}

// market-browse — active sales with filter/sort. state defaults to 1 (LISTED).
async function marketBrowse(chain, opts = {}) {
  const q = new URLSearchParams();
  q.set("state", opts.state != null && opts.state !== "" ? String(opts.state) : "1");
  q.set("limit", String(Math.min(Math.max(parseInt(opts.limit, 10) || 40, 1), 100)));
  q.set("page", String(Math.max(parseInt(opts.page, 10) || 1, 1)));
  const sort = ["price", "created", "updated", "template_mint"].includes(opts.sort) ? opts.sort : "created";
  q.set("sort", sort);
  q.set("order", opts.order === "asc" ? "asc" : opts.order === "desc" ? "desc" : sort === "price" ? "asc" : "desc");
  if (opts.collection) q.set("collection_name", String(opts.collection).trim());
  if (opts.schema) q.set("schema_name", String(opts.schema).trim());
  if (opts.template_id != null && opts.template_id !== "") q.set("template_id", String(opts.template_id));
  if (opts.seller) q.set("seller", String(opts.seller).trim());
  // min/max price are DECIMAL token units and require a symbol — default to core.
  const needSym = (opts.min_price != null && opts.min_price !== "") || (opts.max_price != null && opts.max_price !== "");
  const symbol = opts.symbol ? String(opts.symbol).trim().toUpperCase() : (needSym ? chain.coreSymbol : null);
  if (symbol) q.set("symbol", symbol);
  if (opts.min_price != null && opts.min_price !== "") q.set("min_price", String(opts.min_price));
  if (opts.max_price != null && opts.max_price !== "") q.set("max_price", String(opts.max_price));
  if (opts.search) q.set("match", String(opts.search).trim());
  const json = await marketApiGet(chain, `/sales?${q.toString()}`);
  const sales = (json.data || []).map(marketSaleView);
  return {
    network: chain.id, market: marketOf(chain).contract,
    count: sales.length, page: Number(q.get("page")), sort: q.get("sort"), order: q.get("order"),
    filters: {
      collection: opts.collection || null, schema: opts.schema || null,
      template_id: opts.template_id != null && opts.template_id !== "" ? String(opts.template_id) : null,
      seller: opts.seller || null, symbol: symbol || null,
      min_price: opts.min_price != null && opts.min_price !== "" ? String(opts.min_price) : null,
      max_price: opts.max_price != null && opts.max_price !== "" ? String(opts.max_price) : null,
    },
    sales,
  };
}

// market-listing — one sale with full media + price.
async function marketListing(chain, saleId) {
  if (saleId == null || saleId === "") throw new Error("sale_id required");
  const json = await marketApiGet(chain, `/sales/${encodeURIComponent(String(saleId))}`);
  if (!json.data) throw new Error(`sale ${saleId} not found on ${chain.name}`);
  return { network: chain.id, sale: marketSaleView(json.data) };
}

// market-price — floor / average / median from active listings of a collection
// or template. Samples the cheapest 100 active listings (sorted by price asc),
// grouped per settlement token (floor is only meaningful within one token).
async function marketPrice(chain, opts = {}) {
  if (!opts.collection && (opts.template_id == null || opts.template_id === ""))
    throw new Error("market-price needs a collection or template_id");
  const q = new URLSearchParams();
  q.set("state", "1"); q.set("sort", "price"); q.set("order", "asc"); q.set("limit", "100");
  if (opts.collection) q.set("collection_name", String(opts.collection).trim());
  if (opts.template_id != null && opts.template_id !== "") q.set("template_id", String(opts.template_id));
  if (opts.schema) q.set("schema_name", String(opts.schema).trim());
  if (opts.symbol) q.set("symbol", String(opts.symbol).trim().toUpperCase());
  const json = await marketApiGet(chain, `/sales?${q.toString()}`);
  const rows = (json.data || []).filter((s) => s.price && s.price.amount != null);
  const scope = {
    collection: opts.collection || null,
    template_id: opts.template_id != null && opts.template_id !== "" ? String(opts.template_id) : null,
    schema: opts.schema || null,
  };
  if (!rows.length) return { network: chain.id, scope, symbol: opts.symbol || null, listings: 0, floor: null, average: null, median: null };
  const bySym = {};
  for (const s of rows) {
    const k = s.price.token_symbol;
    (bySym[k] = bySym[k] || []).push({ amt: Number(s.price.amount) / Math.pow(10, Number(s.price.token_precision || 0)), prec: Number(s.price.token_precision || 0) });
  }
  const symKey = opts.symbol && bySym[String(opts.symbol).toUpperCase()]
    ? String(opts.symbol).toUpperCase()
    : Object.keys(bySym).sort((x, y) => bySym[y].length - bySym[x].length)[0];
  const group = bySym[symKey].sort((x, y) => x.amt - y.amt);
  const ps = group.map((g) => g.amt);
  const prec = group[0].prec;
  const sum = ps.reduce((x, y) => x + y, 0);
  const median = ps.length % 2 ? ps[(ps.length - 1) / 2] : (ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2;
  const fmt = (n) => `${Number(n).toFixed(prec)} ${symKey}`;
  return {
    network: chain.id, scope, symbol: symKey,
    listings: ps.length, sampled: rows.length,
    floor: { amount: ps[0], display: fmt(ps[0]) },
    average: { amount: Number((sum / ps.length).toFixed(prec)), display: fmt(sum / ps.length) },
    median: { amount: Number(median.toFixed(prec)), display: fmt(median) },
    note: ps.length >= 100 ? "sampled from the cheapest 100 active listings" : "over all active listings",
  };
}

// Settlement symbol for a listing. Default = chain core (WAX = 8dp). Accepts
// "WAX", "8,WAX", or a precision-qualified non-core token. The listing_price
// asset must carry this precision or announcesale rejects it.
function parseListingSymbol(chain, symbol) {
  if (!symbol) return { precision: chain.corePrecision, code: chain.coreSymbol };
  const s = String(symbol).trim();
  const m = s.match(/^(\d{1,2})\s*,\s*([A-Z]{1,7})$/);
  if (m) return { precision: parseInt(m[1], 10), code: m[2] };
  const up = s.toUpperCase();
  if (/^[A-Z]{1,7}$/.test(up)) {
    if (up === chain.coreSymbol) return { precision: chain.corePrecision, code: up };
    throw new Error(`non-core token "${up}" needs an explicit precision — pass symbol:"<precision>,${up}" (e.g. "4,TLM")`);
  }
  throw new Error(`bad symbol "${symbol}" — use "WAX" or "8,WAX"`);
}

function formatListingPrice(price, symObj) {
  if (price == null || price === "") throw new Error('price is required (e.g. price:"1.0")');
  const head = String(price).trim().split(/\s+/)[0];
  const n = Number(head);
  if (!Number.isFinite(n) || n < 0) throw new Error(`bad price "${price}" — pass a non-negative number`);
  return `${n.toFixed(symObj.precision)} ${symObj.code}`;
}

// Convert an AtomicAssets HTTP API asset object into the same decoded shape produced
// by the on-chain get_table_rows path. The API returns data already merged from
// template + asset immutable/mutable, so we split it back into immutable/mutable for
// backwards compatibility and re-run extractMedia() for consistent gateway handling.
function apiAssetView(a, chain) {
  const asset_id = String(a.asset_id);
  const collection_name = (a.collection && a.collection.collection_name) || a.collection_name || null;
  const schema_name = (a.schema && a.schema.schema_name) || a.schema_name || null;
  const template_id = (a.template && a.template.template_id != null) ? a.template.template_id : (a.template_id != null ? a.template_id : null);
  const template_mint = a.template_mint != null ? String(a.template_mint) : null;
  const owner = a.owner || null;

  // The API merges template immutable_data + asset immutable_data + mutable_data into `data`.
  // For backwards compatibility, expose the merged blob as `immutable` and keep mutable
  // separately if the API provides it; most callers just need `data`/`name`/`media`.
  const merged = a.data || {};
  const immutable = { ...merged };
  const mutable = a.mutable_data || {};
  // Remove mutable-only keys from immutable copy if schema distinguishes them.
  for (const k of Object.keys(mutable)) delete immutable[k];

  const templateImmutable = (a.template && a.template.immutable_data) ? a.template.immutable_data : {};
  const name = merged.name || `${collection_name || "asset"} #${asset_id}`;
  const media = extractMedia(merged, templateImmutable);

  return {
    asset_id,
    template_mint,
    collection: collection_name,
    schema: schema_name,
    template_id,
    owner,
    immutable,
    mutable,
    name,
    image: media && (media.type === "image" || media.type === "video" || media.type === "glb") ? media.url : null,
    image_url: media && (media.type === "image" || media.type === "video" || media.type === "glb") ? media.url : null,
    media,
    video: merged.video || templateImmutable.video || null,
    rarity: merged.rarity || templateImmutable.rarity || null,
    max_supply: (a.template && a.template.max_supply != null) ? String(a.template.max_supply) : null,
    issued_supply: (a.template && a.template.issued_supply != null) ? String(a.template.issued_supply) : null,
    collection_authorized: !!(a.collection && Array.isArray(a.collection.authorized_accounts) && a.collection.authorized_accounts.includes(assetsContract(chain))),
  };
}

// ── AtomicAssets NFT inventory (Phase A + API layer) ─────────────────
// Prefer the AtomicAssets HTTP indexer: it gives decoded data + merged template
// metadata in one call and tolerates chain RPC overload. Falls back to reading
// the atomicassets contract directly via get_table_rows if all API hosts fail.
// Filters are applied client-side (the API supports collection/schema/template_id
// query params, but template_id is passed as a string and we normalise here).
async function getAtomicAssets(chain, account, options = {}) {
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 100, 1), 1000);
  const collectionFilter = options.collection ? String(options.collection).trim() : null;
  const schemaFilter = options.schema ? String(options.schema).trim() : null;
  const templateFilter = options.template_id != null ? String(options.template_id) : null;

  // Try AtomicAssets API first.
  if (chainFeatures(chain).atomicAssets) {
    const qparts = [];
    qparts.push(`owner=${encodeURIComponent(account)}`);
    qparts.push(`limit=${Math.min(limit, 100)}`);
    qparts.push("order=desc");
    qparts.push("sort=asset_id");
    if (collectionFilter) qparts.push(`collection_name=${encodeURIComponent(collectionFilter)}`);
    if (schemaFilter) qparts.push(`schema_name=${encodeURIComponent(schemaFilter)}`);
    if (templateFilter) qparts.push(`template_id=${encodeURIComponent(templateFilter)}`);
    try {
      const json = await atomicApiGet(chain, `${aaApiPath(chain)}/assets?${qparts.join("&")}`);
      const rows = Array.isArray(json.data) ? json.data : [];
      const assets = rows.slice(0, limit).map((row) => apiAssetView(row, chain));
      return { account, network: chain.id, count: assets.length, assets, source: "atomic-api" };
    } catch (e) {
      // Fall through to on-chain read.
    }
  }

  // On-chain fallback via get_table_rows.
  const assets = [];
  let next_key = null;
  do {
    const body = { code: assetsContract(chain), scope: account, table: "assets", json: true, limit: Math.min(limit - assets.length, 100) };
    if (next_key != null) body.lower_bound = next_key;
    const res = await rpc(chain, "get_table_rows", body);
    const rows = Array.isArray(res.rows) ? res.rows : [];
    for (const row of rows) {
      if (collectionFilter && row.collection_name !== collectionFilter) continue;
      if (schemaFilter && row.schema_name !== schemaFilter) continue;
      if (templateFilter && String(row.template_id) !== templateFilter) continue;
      assets.push(row);
      if (assets.length >= limit) break;
    }
    next_key = res.more && res.next_key != null ? res.next_key : null;
  } while (next_key != null && assets.length < limit);

  // Resolve schemas + templates (with TTL 30s in-memory cache)
  const schemaNeeded = new Map();
  const templateNeeded = new Map();
  for (const a of assets) {
    const sKey = `${chain.id}:${a.collection_name}:${a.schema_name}`;
    if (!aaCacheGet(sKey)) schemaNeeded.set(sKey, { collection: a.collection_name, schema_name: a.schema_name });
    if (a.template_id != null && a.template_id !== -1) {
      const tKey = `${chain.id}:${a.collection_name}:${a.template_id}`;
      if (!aaCacheGet(tKey)) templateNeeded.set(tKey, { collection: a.collection_name, template_id: a.template_id });
    }
  }

  // Batch fetch schemas: one call per unique collection+schema
  for (const [key, { collection, schema_name }] of schemaNeeded) {
    try {
      const res = await rpc(chain, "get_table_rows", { code: assetsContract(chain), scope: collection, table: "schemas", lower_bound: schema_name, upper_bound: schema_name, json: true, limit: 1 });
      const row = (res.rows || [])[0];
      if (row && row.schema_name === schema_name) aaCacheSet(key, row.format || []);
    } catch { /* best effort — leave schema empty */ }
  }

  // Batch fetch templates: one call per unique template
  for (const [key, { collection, template_id }] of templateNeeded) {
    try {
      const res = await rpc(chain, "get_table_rows", { code: assetsContract(chain), scope: collection, table: "templates", lower_bound: template_id, upper_bound: template_id, json: true, limit: 1 });
      const row = (res.rows || [])[0];
      if (row && row.template_id === template_id) aaCacheSet(key, row);
    } catch { /* best effort */ }
  }

  // Resolve collections (authorized flag) for every asset collection
  const collectionsNeeded = new Set();
  for (const a of assets) collectionsNeeded.add(a.collection_name);
  const collectionMap = new Map();
  for (const colName of collectionsNeeded) {
    const key = `${chain.id}:collection:${colName}`;
    let col = aaCacheGet(key);
    if (!col) {
      try {
        const res = await rpc(chain, "get_table_rows", { code: assetsContract(chain), scope: assetsContract(chain), table: "collections", lower_bound: colName, upper_bound: colName, json: true, limit: 1 });
        col = (res.rows || [])[0];
        if (col) aaCacheSet(key, col);
      } catch { /* best effort */ }
    }
    if (col) collectionMap.set(colName, col);
  }

  // Decode each asset
  const decoded = assets.map((a) => {
    const sKey = `${chain.id}:${a.collection_name}:${a.schema_name}`;
    const format = aaCacheGet(sKey) || [];
    const tKey = `${chain.id}:${a.collection_name}:${a.template_id}`;
    const template = (a.template_id != null && a.template_id !== -1) ? (aaCacheGet(tKey) || null) : null;

    let immutable = deserializeAtomicData(a.immutable_serialized_data, format);
    const mutable = deserializeAtomicData(a.mutable_serialized_data, format);

    // Template immutable data is the default; asset immutable overrides it
    let templateImmutable = {};
    if (template) {
      templateImmutable = deserializeAtomicData(template.immutable_serialized_data, format);
      immutable = { ...templateImmutable, ...immutable };
    }

    const col = collectionMap.get(a.collection_name);
    const name = immutable.name || templateImmutable.name || `${a.collection_name} #${a.asset_id}`;
    const media = extractMedia(immutable, templateImmutable);

    return {
      asset_id: String(a.asset_id),
      template_mint: a.template_mint != null ? String(a.template_mint) : null,
      collection: a.collection_name,
      schema: a.schema_name,
      template_id: a.template_id,
      immutable,
      mutable,
      name,
      image: media && (media.type === "image" || media.type === "video" || media.type === "glb") ? media.url : null,
      image_url: media && (media.type === "image" || media.type === "video" || media.type === "glb") ? media.url : null,
      media,
      video: immutable.video || templateImmutable.video || null,
      rarity: immutable.rarity || templateImmutable.rarity || null,
      max_supply: template ? (template.max_supply != null ? String(template.max_supply) : null) : null,
      issued_supply: template ? (template.issued_supply != null ? String(template.issued_supply) : null) : null,
      collection_authorized: col ? Array.isArray(col.authorized_accounts) && col.authorized_accounts.includes(assetsContract(chain)) : false,
    };
  });

  return { account, network: chain.id, count: decoded.length, assets: decoded, source: "rpc" };
}

// Fetch a single AtomicAssets asset by asset_id, decoded.
async function getAtomicAsset(chain, assetId, ownerHint, storeFile) {
  if (assetId == null) throw new Error("asset_id required");

  const assetIdStr = String(assetId);

  // Try AtomicAssets API first (does not need owner hint).
  if (chainFeatures(chain).atomicAssets) {
    try {
      const json = await atomicApiGet(chain, `${aaApiPath(chain)}/assets/${assetIdStr}`);
      if (json && json.success === true && json.data) return apiAssetView(json.data, chain);
    } catch { /* fall through to on-chain search */ }
  }

  let row = null;

  async function tryOwner(owner) {
    if (!owner) return null;
    try {
      const res = await rpc(chain, "get_table_rows", {
        code: assetsContract(chain), scope: owner, table: "assets",
        lower_bound: assetId, upper_bound: assetId, json: true, limit: 1,
      });
      const found = (res.rows || [])[0];
      return found && String(found.asset_id) === assetIdStr ? found : null;
    } catch { return null; }
  }

  // 1. explicit owner hint (from CLI --owner or positional arg)
  row = await tryOwner(ownerHint);

  // 2. fall back to stored accounts on this network
  if (!row && storeFile) {
    try {
      const store = loadStore(storeFile);
      const bucket = store.byNet?.[chain.id];
      const candidates = new Set();
      if (bucket?.selected) candidates.add(bucket.selected);
      if (Array.isArray(bucket?.accounts)) {
        for (const a of bucket.accounts) {
          if (a.account) candidates.add(a.account);
        }
      }
      for (const owner of candidates) {
        row = await tryOwner(owner);
        if (row) break;
      }
    } catch { /* ignore store read errors */ }
  }

  if (!row) throw new Error(`asset ${assetId} not found`);

  const sKey = `${chain.id}:${row.collection_name}:${row.schema_name}`;
  let format = aaCacheGet(sKey);
  if (!format) {
    try {
      const sres = await rpc(chain, "get_table_rows", { code: assetsContract(chain), scope: row.collection_name, table: "schemas", lower_bound: row.schema_name, upper_bound: row.schema_name, json: true, limit: 1 });
      const srow = (sres.rows || [])[0];
      format = (srow && srow.schema_name === row.schema_name) ? (srow.format || []) : [];
      aaCacheSet(sKey, format);
    } catch { format = []; }
  }

  const tKey = `${chain.id}:${row.collection_name}:${row.template_id}`;
  let template = null;
  if (row.template_id != null && row.template_id !== -1) {
    template = aaCacheGet(tKey);
    if (!template) {
      try {
        const tres = await rpc(chain, "get_table_rows", { code: assetsContract(chain), scope: row.collection_name, table: "templates", lower_bound: row.template_id, upper_bound: row.template_id, json: true, limit: 1 });
        const trow = (tres.rows || [])[0];
        if (trow && trow.template_id === row.template_id) { template = trow; aaCacheSet(tKey, template); }
      } catch {}
    }
  }

  const cKey = `${chain.id}:collection:${row.collection_name}`;
  let collection = aaCacheGet(cKey);
  if (!collection) {
    try {
      const cres = await rpc(chain, "get_table_rows", { code: assetsContract(chain), scope: assetsContract(chain), table: "collections", lower_bound: row.collection_name, upper_bound: row.collection_name, json: true, limit: 1 });
      collection = (cres.rows || [])[0];
      if (collection) aaCacheSet(cKey, collection);
    } catch {}
  }

  let immutable = deserializeAtomicData(row.immutable_serialized_data, format);
  const mutable = deserializeAtomicData(row.mutable_serialized_data, format);
  let templateImmutable = {};
  if (template) {
    templateImmutable = deserializeAtomicData(template.immutable_serialized_data, format);
    immutable = { ...templateImmutable, ...immutable };
  }

  const name = immutable.name || templateImmutable.name || `${row.collection_name} #${row.asset_id}`;
  const media = extractMedia(immutable, templateImmutable);

  return {
    asset_id: String(row.asset_id),
    template_mint: row.template_mint != null ? String(row.template_mint) : null,
    collection: row.collection_name,
    schema: row.schema_name,
    template_id: row.template_id,
    owner: row.owner,
    immutable,
    mutable,
    name,
    image: media && (media.type === "image" || media.type === "video" || media.type === "glb") ? media.url : null,
    image_url: media && (media.type === "image" || media.type === "video" || media.type === "glb") ? media.url : null,
    media,
    video: immutable.video || templateImmutable.video || null,
    rarity: immutable.rarity || templateImmutable.rarity || null,
    max_supply: template ? (template.max_supply != null ? String(template.max_supply) : null) : null,
    issued_supply: template ? (template.issued_supply != null ? String(template.issued_supply) : null) : null,
    collection_authorized: collection ? Array.isArray(collection.authorized_accounts) && collection.authorized_accounts.includes(assetsContract(chain)) : false,
  };
}

// Fetch AtomicAssets action history for one asset_id via Hyperion v2.
// Returns mint/transfer/setassetdata/burn events with actor + txId.
async function getAtomicAssetHistory(chain, assetId, ownerHint, _retried) {
  if (assetId == null) throw new Error("asset_id required");
  const owner = ownerHint || null;
  let historyUrl;
  try {
    historyUrl = await _pickHealthyHistory(chain);
  } catch (e) {
    throw new Error(`history endpoint unreachable (${chain.id}): ${e.message}`);
  }
  const url = `${historyUrl}/v2/history/get_actions?account=${assetsContract(chain)}&filter=${assetsContract(chain)}:transfer,${assetsContract(chain)}:mintasset,${assetsContract(chain)}:setassetdata,${assetsContract(chain)}:burnasset&limit=200&sort=desc`;
  let res;
  try { res = await fetch(url, { headers: { connection: "close" } }); }
  catch (e) {
    if (!_retried) { _invalidateHistory(chain.id); return getAtomicAssetHistory(chain, assetId, ownerHint, true); }
    throw new Error(`history endpoint unreachable: ${e?.cause?.code || e.message}`);
  }
  if (!res.ok) throw new Error(`history HTTP ${res.status}`);
  const json = await res.json();
  const acts = json.simple_actions || json.actions || [];
  const targetId = String(assetId);

  const events = [];
  for (const x of acts) {
    const data = x.data || x.act?.data || {};
    const ids = Array.isArray(data.asset_ids) ? data.asset_ids.map(String) : [];
    const singleId = data.asset_id != null ? String(data.asset_id) : null;
    if (!ids.includes(targetId) && singleId !== targetId) continue;

    const action = x.action || x.act?.name || "";
    const txId = x.trx_id || x.transaction_id;
    const time = x.timestamp || x["@timestamp"] || x.block_time;
    const actor = data.authorization?.[0]?.actor || data.minter || data.new_owner || data.owner || "";
    let type = "update", title = "Updated", from = null, to = null, detail = "";

    if (action === "mintasset") {
      type = "mint"; title = "Minted"; detail = `by ${actor}`;
    } else if (action === "transfer") {
      type = data.from === data.to ? "update" : "transfer";
      if (data.from && data.to) {
        from = data.from; to = data.to;
        if (owner && data.from === owner) { title = "Sent"; detail = `to ${data.to}`; }
        else if (owner && data.to === owner) { title = "Received"; detail = `from ${data.from}`; }
        else { title = "Transferred"; detail = `${data.from} → ${data.to}`; }
      } else {
        title = "Transferred"; detail = "";
      }
    } else if (action === "setassetdata") {
      type = "update"; title = "Updated";
      const keys = Object.keys(data.mutable_data || {});
      detail = keys.length ? keys.join(", ") : "";
    } else if (action === "burnasset") {
      type = "out"; title = "Burned"; detail = `by ${actor}`;
    }

    events.push({
      type, title, action, actor, from, to, detail,
      txId, time,
      explorer: txId ? explorerTxUrl(chain.id, txId).primary : null,
    });
  }
  return { asset_id: targetId, network: chain.id, count: events.length, events };
}

// ── AtomicAssets collection / schema / template discovery (Phase B) ────
// Decode a collection row. The `serialized_data` field is raw bytes with no
// published ABI format, so we attempt a no-format decode (returns {} when empty)
// and always keep the raw bytes for advanced callers.
function decodeCollectionRow(chain, row) {
  const key = `${chain.id}:collection:${row.collection_name}`;
  let cached = aaCacheGet(key);
  if (!cached) { cached = row; aaCacheSet(key, row); }
  let data = {};
  try { data = deserializeAtomicData(row.serialized_data, []); }
  catch { /* collection serialized_data has no published ABI format; leave as {} */ }
  return {
    collection_name: row.collection_name,
    author: row.author,
    allow_notify: row.allow_notify,
    authorized_accounts: row.authorized_accounts || [],
    notify_accounts: row.notify_accounts || [],
    market_fee: row.market_fee,
    serialized_data: data,
    raw_serialized_data: row.serialized_data,
  };
}

// Fetch all AtomicAssets collections. Prefer AtomicAssets API; fall back to chain.
async function getAtomicCollections(chain, options = {}) {
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 1000, 1), 1000);

  if (chainFeatures(chain).atomicAssets) {
    try {
      const q = new URLSearchParams();
      q.set("limit", String(Math.min(limit, 100)));
      q.set("order", "desc");
      q.set("sort", "created");
      const json = await atomicApiGet(chain, `${aaApiPath(chain)}/collections?${q.toString()}`);
      const rows = Array.isArray(json.data) ? json.data : [];
      return {
        network: chain.id, count: rows.length,
        collections: rows.map((r) => ({
          collection_name: r.collection_name,
          author: r.author,
          allow_notify: r.allow_notify,
          authorized_accounts: r.authorized_accounts || [],
          notify_accounts: r.notify_accounts || [],
          market_fee: r.market_fee,
          serialized_data: r.data || {},
          raw_serialized_data: null,
        })),
        source: "atomic-api",
      };
    } catch { /* fall through to chain */ }
  }

  const rows = [];
  let next_key = null;
  do {
    const body = { code: assetsContract(chain), scope: assetsContract(chain), table: "collections", json: true, limit: Math.min(limit - rows.length, 100) };
    if (next_key != null) body.lower_bound = next_key;
    const res = await rpc(chain, "get_table_rows", body);
    for (const r of res.rows || []) rows.push(r);
    next_key = res.more && res.next_key != null ? res.next_key : null;
  } while (next_key != null && rows.length < limit);

  return { network: chain.id, count: rows.length, collections: rows.map((r) => decodeCollectionRow(chain, r)), source: "rpc" };
}

// Fetch schemas for one collection. Prefer AtomicAssets API; fall back to chain.
async function getAtomicSchemas(chain, collection, options = {}) {
  assertAccountName(collection, "collection");
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 1000, 1), 1000);

  if (chainFeatures(chain).atomicAssets) {
    try {
      const q = new URLSearchParams();
      q.set("collection_name", collection);
      q.set("limit", String(Math.min(limit, 100)));
      const json = await atomicApiGet(chain, `${aaApiPath(chain)}/schemas?${q.toString()}`);
      const rows = Array.isArray(json.data) ? json.data : [];
      return { network: chain.id, collection, count: rows.length, schemas: rows.map((r) => ({ schema_name: r.schema_name, format: r.format || [] })), source: "atomic-api" };
    } catch { /* fall through */ }
  }

  // Keep collection row warm in cache for detail views.
  const cKey = `${chain.id}:collection:${collection}`;
  if (!aaCacheGet(cKey)) {
    try {
      const cres = await rpc(chain, "get_table_rows", { code: assetsContract(chain), scope: assetsContract(chain), table: "collections", lower_bound: collection, upper_bound: collection, json: true, limit: 1 });
      const col = (cres.rows || [])[0];
      if (col) aaCacheSet(cKey, col);
    } catch { /* best effort */ }
  }

  const rows = [];
  let next_key = null;
  do {
    const body = { code: assetsContract(chain), scope: collection, table: "schemas", json: true, limit: Math.min(limit - rows.length, 100) };
    if (next_key != null) body.lower_bound = next_key;
    const res = await rpc(chain, "get_table_rows", body);
    for (const r of res.rows || []) rows.push(r);
    next_key = res.more && res.next_key != null ? res.next_key : null;
  } while (next_key != null && rows.length < limit);

  return { network: chain.id, collection, count: rows.length, schemas: rows.map((r) => ({ schema_name: r.schema_name, format: r.format || [] })), source: "rpc" };
}

// Fetch templates for one collection, decoding each template's immutable data.
async function getAtomicTemplates(chain, collection, options = {}) {
  assertAccountName(collection, "collection");
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 1000, 1), 1000);

  if (chainFeatures(chain).atomicAssets) {
    try {
      const q = new URLSearchParams();
      q.set("collection_name", collection);
      q.set("limit", String(Math.min(limit, 100)));
      const json = await atomicApiGet(chain, `${aaApiPath(chain)}/templates?${q.toString()}`);
      const rows = Array.isArray(json.data) ? json.data : [];
      const templates = rows.map((r) => {
        const immutable = (r.immutable_data) || {};
        return {
          template_id: r.template_id,
          schema_name: (r.schema && r.schema.schema_name) || r.schema_name || null,
          transferable: r.transferable,
          burnable: r.burnable,
          max_supply: r.max_supply != null ? String(r.max_supply) : null,
          issued_supply: r.issued_supply != null ? String(r.issued_supply) : null,
          immutable,
          media: extractMedia(immutable, {}),
        };
      });
      return { network: chain.id, collection, count: templates.length, templates, source: "atomic-api" };
    } catch { /* fall through */ }
  }

  // Resolve schemas first so we can decode template immutable data.
  const schemaRes = await getAtomicSchemas(chain, collection, { limit: 1000 });
  const formatMap = new Map(schemaRes.schemas.map((s) => [s.schema_name, s.format || []]));

  const rows = [];
  let next_key = null;
  do {
    const body = { code: assetsContract(chain), scope: collection, table: "templates", json: true, limit: Math.min(limit - rows.length, 100) };
    if (next_key != null) body.lower_bound = next_key;
    const res = await rpc(chain, "get_table_rows", body);
    for (const r of res.rows || []) rows.push(r);
    next_key = res.more && res.next_key != null ? res.next_key : null;
  } while (next_key != null && rows.length < limit);

  const templates = rows.map((r) => {
    const format = formatMap.get(r.schema_name) || [];
    const immutable = deserializeAtomicData(r.immutable_serialized_data, format);
    return {
      template_id: r.template_id,
      schema_name: r.schema_name,
      transferable: r.transferable,
      burnable: r.burnable,
      max_supply: r.max_supply != null ? String(r.max_supply) : null,
      issued_supply: r.issued_supply != null ? String(r.issued_supply) : null,
      immutable,
      media: extractMedia(immutable, {}),
    };
  });

  return { network: chain.id, collection, count: templates.length, templates, source: "rpc" };
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
  // When the wallet is unlocked, we keep the verified password in memory so
  // the user can add/import keys without re-entering it. Cleared on lock/crash.
  let _vaultPassword = null;

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
    _vaultPassword = null;  // wipe in-memory password — must re-enter to unlock
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
    // When unlocked, the frontend sends no password — use the in-memory one.
    if (!password && _vaultPassword) password = _vaultPassword;
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
    // When unlocked, the frontend sends no password — use the in-memory one.
    if (!password && _vaultPassword) password = _vaultPassword;
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

    // Password verified — keep it in memory so add/import can reuse it without
    // asking the user to re-type. Cleared on lock()/relock()/auto-lock.
    _vaultPassword = password;

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
    //   needsSetup — truly fresh wallet: no password AND no keys at all
    //   locked     — password exists (or keys exist — password is implicit in
    //                encrypted keys from a v2→v4 migration), but not unlocked
    //   unlocked   — keys are decrypted and ready to sign
    //
    // v0.5.1 regression fix: users with a v2 keystore (keys but no per-bucket
    // passwordVerifier) were getting auth="needsSetup" → panel showed the
    // "Create vault password" screen instead of the unlock screen. The unlock()
    // handler already knows how to migrate (decrypt the first key → create the
    // verifier), so we route these wallets to "locked" so the unlock gate shows.
    const hasAccounts = hasAnyAccounts(store);
    let auth;
    if (!store.passwordVerifier && !hasAccounts) {
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
      hasPassword: !!(store.passwordVerifier || hasAccounts),
      passwordInMemory: !!_vaultPassword,
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

  // Build a sign-intent for transferring one or more AtomicAssets NFTs.
  // This shares the same confirm gate as token transfers — the amber seal only
  // appears when the user taps Sign on the intent sheet.
  async function transferNFT(params) {
    const p = typeof params === "object" ? params : {};
    const chain = resolveNet(p.network);
    if (p.to == null || p.to === "") throw new Error("to (recipient) is required");
    const toName = assertAccountName(p.to, "recipient");
    let assetIds = p.asset_ids || p.assetIds || p.assets || p.asset_id;
    if (!Array.isArray(assetIds)) assetIds = [assetIds];
    assetIds = assetIds.map(String).filter(Boolean);
    if (!assetIds.length) throw new Error("at least one asset_id is required");

    const store = loadStore(FILE);
    const { rec, actor: fromName, permission } = resolveSigner(store, chain, p.from);
    const action = {
      account: assetsContract(chain), name: "transfer",
      authorization: [{ actor: fromName, permission }],
      data: { from: fromName, to: toName, asset_ids: assetIds, memo: p.memo != null ? String(p.memo) : "" },
    };
    return registerIntent({
      kind: "transfernft", actor: fromName, permission, publicKey: rec.publicKey,
      networkId: chain.id, actions: [action],
      view: { from: fromName, to: toName, asset_ids: assetIds, memo: p.memo || "" },
      result: { kind: "transfernft", from: fromName, to: toName, asset_ids: assetIds, memo: p.memo || "" },
    });
  }

  // ── Light Marketplace writes (AtomicMarket) — sign-intent gated ──────
  // Both build a sign-intent (NO broadcast); the existing confirm/cancel gate
  // handles signing. Action shapes are grounded in the live ABI:
  //   announcesale(seller, asset_ids, listing_price, settlement_symbol, maker_marketplace)
  //   atomicassets::createoffer(sender, recipient, sender_asset_ids, recipient_asset_ids, memo)
  //   purchasesale(buyer, sale_id, intended_delphi_median, taker_marketplace)
  // AtomicMarket settles purchases from a deposited balance, so a buy is a
  // token transfer (memo "deposit") + purchasesale in one intent.

  // market-list — list NFT(s) for sale. Two actions, ONE intent:
  //   1) atomicmarket::announcesale  — declare the sale + price
  //   2) atomicassets::createoffer   — escrow the asset(s) to atomicmarket
  // announcesale must precede createoffer so the sale exists when the offer's
  // lognewoffer notification reaches the market contract.
  async function marketList(params) {
    const p = typeof params === "object" ? params : {};
    const chain = resolveNet(p.network);
    const m = marketOf(chain); // throws on non-WAX
    let assetIds = p.asset_ids || p.assetIds || p.assets || p.asset_id;
    if (!Array.isArray(assetIds)) assetIds = [assetIds];
    assetIds = assetIds.map(String).filter(Boolean);
    if (!assetIds.length) throw new Error("at least one asset_id is required");
    const symObj = parseListingSymbol(chain, p.symbol);
    const priceStr = formatListingPrice(p.price != null ? p.price : p.quantity, symObj);
    const settlement = `${symObj.precision},${symObj.code}`;
    const maker = p.maker_marketplace ? assertAccountName(p.maker_marketplace, "maker_marketplace") : "";

    const store = loadStore(FILE);
    const { rec, actor: seller, permission } = resolveSigner(store, chain, p.from || p.seller);
    const announce = {
      account: m.contract, name: "announcesale",
      authorization: [{ actor: seller, permission }],
      data: { seller, asset_ids: assetIds, listing_price: priceStr, settlement_symbol: settlement, maker_marketplace: maker },
    };
    const offer = {
      account: assetsContract(chain), name: "createoffer",
      authorization: [{ actor: seller, permission }],
      data: { sender: seller, recipient: m.contract, sender_asset_ids: assetIds, recipient_asset_ids: [], memo: "sale" },
    };
    return registerIntent({
      kind: "market-list", actor: seller, permission, publicKey: rec.publicKey,
      networkId: chain.id, actions: [announce, offer],
      view: { seller, asset_ids: assetIds, listing_price: priceStr, settlement_symbol: settlement, marketplace: m.contract, maker_marketplace: maker || null },
      result: { kind: "market-list", seller, asset_ids: assetIds, listing_price: priceStr, settlement_symbol: settlement },
    });
  }

  // market-buy — buy a listed sale. Two actions, ONE intent:
  //   1) <token>::transfer buyer→atomicmarket memo "deposit"  (fund the balance)
  //   2) atomicmarket::purchasesale                            (spend it on the sale)
  // Price + token are read live from the sale so the deposit matches exactly.
  // intended_delphi_median = 0 for a direct token-settled sale (no Delphi/USD).
  async function marketBuy(params) {
    const p = typeof params === "object" ? params : {};
    const chain = resolveNet(p.network);
    const m = marketOf(chain);
    const saleId = p.sale_id || p.saleId || p.id;
    if (saleId == null || saleId === "") throw new Error("sale_id required");
    const { sale } = await marketListing(chain, saleId);
    if (sale.state !== 1) throw new Error(`sale ${saleId} is not listed (state=${sale.state}) — cannot buy`);
    if (!sale.price) throw new Error(`sale ${saleId} has no readable price`);

    const store = loadStore(FILE);
    const { rec, actor: buyer, permission } = resolveSigner(store, chain, p.from || p.buyer);
    if (buyer === sale.seller) throw new Error("you are the seller of this sale — cannot buy your own listing");
    const taker = p.taker_marketplace ? assertAccountName(p.taker_marketplace, "taker_marketplace") : "";
    const tokenContract = sale.price.token_contract || "eosio.token";
    const quantity = `${Number(sale.price.amount).toFixed(sale.price.token_precision)} ${sale.price.token_symbol}`;
    const deposit = {
      account: tokenContract, name: "transfer",
      authorization: [{ actor: buyer, permission }],
      data: { from: buyer, to: m.contract, quantity, memo: "deposit" },
    };
    const purchase = {
      account: m.contract, name: "purchasesale",
      authorization: [{ actor: buyer, permission }],
      data: { buyer, sale_id: String(saleId), intended_delphi_median: 0, taker_marketplace: taker },
    };
    return registerIntent({
      kind: "market-buy", actor: buyer, permission, publicKey: rec.publicKey,
      networkId: chain.id, actions: [deposit, purchase],
      view: { buyer, sale_id: String(saleId), price: quantity, seller: sale.seller, asset_ids: sale.asset_ids, assets: sale.assets, marketplace: m.contract },
      result: { kind: "market-buy", buyer, sale_id: String(saleId), price: quantity, seller: sale.seller, asset_ids: sale.asset_ids },
    });
  }

  // market-cancel — cancel a sale you listed. ONE action, ONE intent:
  //   atomicmarket::cancelsale(sale_id)  — pulls the listing + releases the
  // escrowed asset(s) back to the seller. Only the sale's seller can cancel, so
  // the signer is resolved + asserted against the live sale.seller (same guard
  // shape as market-buy's seller check). Closes the list→buy→cancel lifecycle.
  async function marketCancel(params) {
    const p = typeof params === "object" ? params : {};
    const chain = resolveNet(p.network);
    const m = marketOf(chain);
    const saleId = p.sale_id || p.saleId || p.id;
    if (saleId == null || saleId === "") throw new Error("sale_id required");
    const { sale } = await marketListing(chain, saleId);
    if (sale.state !== 1) throw new Error(`sale ${saleId} is not listed (state=${sale.state}) — nothing to cancel`);

    const store = loadStore(FILE);
    const { rec, actor: seller, permission } = resolveSigner(store, chain, p.from || p.seller);
    if (sale.seller && seller !== sale.seller)
      throw new Error(`only the seller (${sale.seller}) can cancel sale ${saleId} — you are ${seller}`);
    const cancel = {
      account: m.contract, name: "cancelsale",
      authorization: [{ actor: seller, permission }],
      data: { sale_id: String(saleId) },
    };
    return registerIntent({
      kind: "market-cancel", actor: seller, permission, publicKey: rec.publicKey,
      networkId: chain.id, actions: [cancel],
      view: { seller, sale_id: String(saleId), asset_ids: sale.asset_ids, assets: sale.assets, marketplace: m.contract },
      result: { kind: "market-cancel", seller, sale_id: String(saleId), asset_ids: sale.asset_ids },
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
    // dryRun: resolve + serialize against the live on-chain ABIs (catches a bad
    // action shape) but do NOT broadcast and do NOT consume the intent — used by
    // tests/simulation. A normal confirm broadcasts and is single-use.
    const dry = p.dryRun === true || p.dry === true;
    const result = await session.transact(tx, { broadcast: !dry });
    if (dry) {
      armAutoLock();
      return {
        dryRun: true, broadcast: false, serialized: true,
        actions: actions.map((x) => ({ account: x.account, name: x.name, data: x.data })),
        ...it.result, network: chain.name, networkId: chain.id,
      };
    }
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
      // When unlocked, the frontend may send no password — use the in-memory one.
      if (!p.password && _vaultPassword) p.password = _vaultPassword;
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
    // Parse a CLI-ish string: `--flag value` / `--flag=value` / bare `--flag`
    // (boolean) become keys on the object, matching what every plugin.json
    // command advertises; bare tokens stay positional in _parts (back-compat).
    const tokens = s.split(/\s+/);
    const out = { _raw: s, _parts: [] };
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.startsWith("--") && t.length > 2) {
        const eq = t.indexOf("=");
        if (eq !== -1) { out[t.slice(2, eq)] = t.slice(eq + 1); continue; }
        const key = t.slice(2);
        const next = tokens[i + 1];
        if (next != null && !next.startsWith("--")) { out[key] = next; i++; }
        else { out[key] = true; }
      } else {
        out._parts.push(t);
      }
    }
    return out;
  }

  async function onCommand(cmd, args, reply) {
    try {
      const a = parseArgs(args);
      const parts = a._parts || [];
      const gateAtomicAssets = (net) => {
        if (!chainFeatures(net).atomicAssets) return reply({ ok: false, msg: `AtomicAssets/NFT inventory is not available on ${net.name}` });
      };
      const gateAtomicMarket = (net) => {
        if (!chainFeatures(net).atomicMarket) return reply({ ok: false, msg: `Marketplace is not available on ${net.name}` });
      };
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

        // ── NFT Inventory (Phase A + B + C) ───────────────────────────
        case "nftassets": {
          const net = resolveNet(a.network);
          const gated = gateAtomicAssets(net);
          if (gated) return gated;
          const account = a.account || parts[0];
          if (!account) return reply({ ok: false, msg: "account name required" });
          assertAccountName(account, "account");
          const result = await getAtomicAssets(net, account, {
            collection: a.collection, schema: a.schema, template_id: a.template_id != null ? a.template_id : a.template,
            limit: a.limit,
          });
          return reply({ ok: true, ...result });
        }

        case "nftasset": {
          const net = resolveNet(a.network);
          const gated = gateAtomicAssets(net);
          if (gated) return gated;
          const assetId = a.asset_id || a.assetId || parts[0];
          const owner = a.owner || parts[1] || null;
          if (assetId == null) return reply({ ok: false, msg: "asset_id required" });
          const asset = await getAtomicAsset(net, assetId, owner, FILE);
          return reply({ ok: true, network: net.id, asset });
        }

        case "nfthistory": {
          const net = resolveNet(a.network);
          const gated = gateAtomicAssets(net);
          if (gated) return gated;
          const assetId = a.asset_id || a.assetId || parts[0];
          const owner = a.owner || parts[1] || null;
          if (assetId == null) return reply({ ok: false, msg: "asset_id required" });
          const result = await getAtomicAssetHistory(net, assetId, owner);
          return reply({ ok: true, ...result });
        }

        case "nftcollections": {
          const net = resolveNet(a.network);
          const gated = gateAtomicAssets(net);
          if (gated) return gated;
          const result = await getAtomicCollections(net, { limit: a.limit });
          return reply({ ok: true, ...result });
        }

        case "nftschemas": {
          const net = resolveNet(a.network);
          const gated = gateAtomicAssets(net);
          if (gated) return gated;
          const collection = a.collection || parts[0];
          if (!collection) return reply({ ok: false, msg: "collection name required" });
          const result = await getAtomicSchemas(net, collection, { limit: a.limit });
          return reply({ ok: true, ...result });
        }

        case "nfttemplates": {
          const net = resolveNet(a.network);
          const gated = gateAtomicAssets(net);
          if (gated) return gated;
          const collection = a.collection || parts[0];
          if (!collection) return reply({ ok: false, msg: "collection name required" });
          const result = await getAtomicTemplates(net, collection, { limit: a.limit });
          return reply({ ok: true, ...result });
        }

        case "nftcacheclear": {
          aaCacheClear();
          return reply({ ok: true, cleared: true });
        }

        case "transfernft": {
          const net = resolveNet(a.network);
          const gated = gateAtomicAssets(net);
          if (gated) return gated;
          return reply({ ok: true, ...(await transferNFT(a)) });
        }

        // ── Light Marketplace (AtomicMarket, WAX only) ───────────────
        case "market-browse": case "marketbrowse": {
          const net = resolveNet(a.network);
          const gated = gateAtomicMarket(net);
          if (gated) return gated;
          const result = await marketBrowse(net, {
            collection: a.collection, schema: a.schema,
            template_id: a.template_id != null ? a.template_id : a.template,
            seller: a.seller, symbol: a.symbol, min_price: a.min_price, max_price: a.max_price,
            sort: a.sort, order: a.order, limit: a.limit, page: a.page, state: a.state,
            search: a.search || a.q,
          });
          return reply({ ok: true, ...result });
        }
        case "market-listing": case "marketlisting": {
          const net = resolveNet(a.network);
          const gated = gateAtomicMarket(net);
          if (gated) return gated;
          const result = await marketListing(net, a.sale_id || a.saleId || a.id || parts[0]);
          return reply({ ok: true, ...result });
        }
        case "market-price": case "marketprice": {
          const net = resolveNet(a.network);
          const gated = gateAtomicMarket(net);
          if (gated) return gated;
          const result = await marketPrice(net, {
            collection: a.collection || parts[0],
            template_id: a.template_id != null ? a.template_id : a.template,
            schema: a.schema, symbol: a.symbol,
          });
          return reply({ ok: true, ...result });
        }
        case "market-list": case "marketlist": {
          const net = resolveNet(a.network);
          const gated = gateAtomicMarket(net);
          if (gated) return gated;
          return reply({ ok: true, ...(await marketList(a)) });
        }
        case "market-buy":  case "marketbuy":  {
          const net = resolveNet(a.network);
          const gated = gateAtomicMarket(net);
          if (gated) return gated;
          return reply({ ok: true, ...(await marketBuy(a)) });
        }
        case "market-cancel": case "marketcancel": {
          const net = resolveNet(a.network);
          const gated = gateAtomicMarket(net);
          if (gated) return gated;
          return reply({ ok: true, ...(await marketCancel(a)) });
        }

        case "newaccount": return reply({ ok: true, result: await newAccount(a) });

        // ── Tools (Anchor-style utilities) ─────────────────────────────
        case "randomkey": {
          const { PrivateKey } = await wharf();
          const priv = PrivateKey.generate("K1");
          const pub = priv.toPublic().toString();
          return reply({ ok: true, publicKey: pub, privateKey: priv.toString(), type: "K1" });
        }

        case "table": {
          const net = resolveNet(a.network);
          const code = a.code || a.contract || parts[0];
          const scope = a.scope || parts[1] || code;
          const table = a.table || parts[2];
          const limit = Math.min(parseInt(a.limit, 10) || 10, 100);
          if (!code || !table) throw new Error("contract and table required (e.g. table:eosio:delband:myaccount)");
          const body = { code, scope, table, json: true, limit, reverse: a.reverse === true || a.reverse === "true" };
          if (a.lowerBound || a.lower) body.lower_bound = a.lowerBound || a.lower;
          if (a.upperBound || a.upper) body.upper_bound = a.upperBound || a.upper;
          if (a.indexPosition != null) body.index_position = parseInt(a.indexPosition, 10) || 1;
          if (a.keyType) body.key_type = a.keyType;
          const rows = await rpc(net, "get_table_rows", body);
          return reply({ ok: true, network: net.id, code, scope, table, rows: rows.rows || [], more: rows.more || false });
        }

        case "pushaction": {
          const net = resolveNet(a.network);
          const store = loadStore(FILE);
          const { rec, actor, permission } = resolveSigner(store, net, a.from || a.actor);
          const contract = a.contract || a.code || parts[0];
          const actionName = a.action || parts[1];
          if (!contract || !actionName) throw new Error("contract and action required (e.g. pushaction:eosio:buyram:data)");
          let data = {};
          if (a.data && typeof a.data === "object") data = a.data;
          else if (a._raw) { try { data = JSON.parse(a._raw); } catch {} }
          const authorization = [{ actor, permission }];
          // If unlocked, broadcast immediately like confirm(); else return intent
          const priv = unlocked.get(rec.publicKey);
          if (!priv) throw new Error("wallet is locked — unlock first");
          const { Session, WalletPluginPrivateKey } = await wharf();
          const session = new Session(
            { chain: { id: net.chainId, url: net.rpc }, actor, permission, walletPlugin: new WalletPluginPrivateKey(priv) },
            { fetch: closeFetch },
          );
          const result = await session.transact({ action: { account: contract, name: actionName, authorization, data } }, { broadcast: true });
          const txId = String(result.response?.transaction_id || "");
          armAutoLock();
          notify();
          return reply({ ok: true, broadcast: true, txId, explorer: (txId ? explorerTxUrl(net.id, txId).primary : null), contract, action: actionName, actor, network: net.name });
        }

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
        // ── Change password (re-encrypt all keys with a new password) ──
        case "changepassword": {
          const oldPw = a.oldPassword || a.current || parts[0];
          const newPw = a.newPassword || a.password || parts[1];
          if (!oldPw) throw new Error("current password required");
          if (!newPw) throw new Error("new password required");
          if (newPw.length < 8) throw new Error("new password must be at least 8 characters");
          if (oldPw === newPw) throw new Error("new password must be different from current");
          const store = loadStore(FILE);
          // Verify old password against wallet verifier (or decrypt check)
          if (store.passwordVerifier) {
            if (!ks.verifyPassword(oldPw, store.passwordVerifier)) {
              throw new Error("current password is incorrect");
            }
          } else if (hasAnyAccounts(store)) {
            let first;
            for (const [, b] of Object.entries(store.byNet || {})) {
              if (b && b.accounts && b.accounts.length > 0) { first = b.accounts[0]; break; }
            }
            try { ks.decrypt(first, oldPw); }
            catch (e) { throw new Error("current password is incorrect"); }
          } else {
            throw new Error("wallet is empty — nothing to re-encrypt");
          }
          // Re-encrypt all keys with the new password
          let changed = 0;
          for (const [, b] of Object.entries(store.byNet || {})) {
            if (!b || !b.accounts) continue;
            for (const a of b.accounts) {
              const priv = ks.decrypt(a, oldPw);
              const rec = ks.encrypt(priv, newPw);
              a.kdf = rec.kdf; a.cipher = rec.cipher;
              changed++;
            }
          }
          // Update the wallet password verifier
          store.passwordVerifier = ks.createVerifier(newPw);
          saveStore(FILE, store);
          // Update in-memory unlocked keys too
          for (const [pub, priv] of unlocked) {
            const rec = ks.encrypt(priv, newPw);
            unlocked.set(pub, ks.decrypt(rec, newPw));
          }
          // Update in-memory password so subsequent add/import uses the new password
          _vaultPassword = newPw;
          notify();
          return reply({ ok: true, changed, passwordChanged: true });
        }

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
          // Clear in-memory password — the restored wallet may use a different password
          _vaultPassword = null;
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

  // ── Media proxy: fetch external image/video and pipe it through localhost ──
  // The shell webview may block external URLs (ipfs.io, atomichub, etc.), so the
  // panel routes every media src through /plugin/wax-wallet/media?url=... instead.
  // Caches responses for 1 hour; only allows http/https URLs.
  // Tries IPFS gateway fallback chain when the primary URL is an ipfs.io URL.
  async function mediaProxy(req, res) {
    const u = new URL(req.url, "http://x");
    const target = u.searchParams.get("url");
    if (!target) { res.writeHead(400); return res.end("missing url"); }
    if (!/^https?:\/\//i.test(target)) { res.writeHead(400); return res.end("invalid url"); }

    // Build a fallback chain. For ipfs.io URLs, also try dweb.link + atomichub.
    const urls = [target];
    if (target.includes("ipfs.io/ipfs/")) {
      const cid = target.replace(/^https?:\/\/ipfs\.io\/ipfs\//, "").split(/[?#]/)[0];
      if (cid) {
        urls.push("https://dweb.link/ipfs/" + cid);
        urls.push("https://resizer.atomichub.io/images/v1/preview?ipfs=" + encodeURIComponent(cid) + "&size=740");
      }
    }

    let lastErr = null;
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: { connection: "close" } });
        if (r.ok) {
          const ct = r.headers.get("content-type") || "image/png";
          const buf = Buffer.from(await r.arrayBuffer());
          res.writeHead(200, { "content-type": ct, "cache-control": "public, max-age=3600" });
          return res.end(buf);
        }
        lastErr = `HTTP ${r.status}`;
      } catch (e) {
        lastErr = e.message || "fetch error";
      }
    }
    res.writeHead(502);
    res.end(String(lastErr || "all gateways failed"));
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
      media(req, res) { mediaProxy(req, res); },
    },
  };
};

// Pure helpers for standalone testing (require() this file directly).
module.exports._test = { rpc, chainInfo, accountInfo, tokenBalance, history, hyperionGet, keyAccounts, tokenBalances, parseAssetAmount, getRAMMarket, ramBancorBuy, ramBancorSell, computeRates, CHAINS, DEFAULT_NET, BRAND, wharf, publicChain, loadStore, saveStore, bucketOf, publicView, assertAccountName, NAME_RE, emptyBucket, hasAnyAccounts };
