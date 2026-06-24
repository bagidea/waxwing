// 🪙 WAX Wallet — encrypted keystore (self-custody, TESTNET only).
//
// Private keys are encrypted at rest with AES-256-GCM. The encryption key is
// derived from the user's password with scrypt (Node built-in, no native deps).
// Plaintext keys exist ONLY transiently in memory while signing; they are never
// written to disk, never logged, and never sent over the network.
//
// File on disk (ctx.dataDir/keystore.json) only ever holds ciphertext + KDF
// params — never any plaintext. Losing the password = losing the key (by design).

const crypto = require("crypto");

// scrypt cost params. N=2^17 matches the documented KDF fallback in
// MEMO-wallet-risk-clearance.md (Argon2id is the ideal but needs a native build
// on Windows; scrypt N=2^17 is the sanctioned dependency-free fallback).
// These are the CURRENT defaults — every encrypt() records them in the kdf blob,
// and decrypt() reads them back from the record so old keys survive KDF bumps.
const KDF = { algo: "scrypt", N: 1 << 17, r: 8, p: 1, keylen: 32 };
const MAXMEM = 256 * 1024 * 1024; // scrypt needs ~128*N*r bytes; give it headroom

// Derive an AES key from the password + kdf record (or salt hex for backward compat).
// Uses the N/r/p FROM THE RECORD so that keys created under one set of KDF params
// survive a later bump to stronger params.
//
// ⚠ UNICODE NORMALIZATION: String(password) does NOT apply NFC/NFD normalization.
// On some OS/IME combinations (notably Thai), the same visual password can produce
// different Unicode byte sequences (composed vs decomposed). If you create a key on
// one OS and unlock on another, and the password uses combining characters, the
// derived key may differ silently → auth tag fails → "bad password".
// Mitigation: use ASCII-only passwords, or always unlock on the same device OS you
// created the key on. Adding .normalize('NFC') would be a BREAKING change (existing
// keys were encrypted with raw password bytes).
function deriveKey(password, kdfOrSaltHex) {
  const kdf = (kdfOrSaltHex && typeof kdfOrSaltHex === "object" && kdfOrSaltHex.salt)
    ? kdfOrSaltHex
    : null;
  const saltHex = kdf ? kdf.salt : kdfOrSaltHex;
  const N = kdf ? (kdf.N || KDF.N) : KDF.N;
  const r = kdf ? (kdf.r || KDF.r) : KDF.r;
  const p = kdf ? (kdf.p || KDF.p) : KDF.p;
  // Defense-in-depth: validate hex before Buffer.from (decrypt() already checks
  // this, but deriveKey is a public export and could be called directly).
  if (!/^[0-9a-f]+$/i.test(saltHex) || saltHex.length % 2 !== 0) {
    throw new Error(`corrupt key record — kdf salt is not valid hex`);
  }
  const salt = Buffer.from(saltHex, "hex");
  try {
    return crypto.scryptSync(String(password), salt, KDF.keylen, {
      N, r, p, maxmem: MAXMEM,
    });
  } catch (e) {
    // scrypt can fail for bad params or memory exhaustion — surface the real cause
    throw new Error(`key derivation failed (scrypt N=${N} r=${r} p=${p}): ${e.message}`);
  }
}

// Encrypt a private-key string under a password. Returns the on-disk record
// shape (no plaintext anywhere in it).
function encrypt(privString, password) {
  if (!privString) throw new Error("nothing to encrypt");
  if (!password) throw new Error("password required");
  const saltHex = crypto.randomBytes(16).toString("hex");
  const key = deriveKey(password, { salt: saltHex, N: KDF.N, r: KDF.r, p: KDF.p });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(privString, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0); // wipe derived key
  return {
    kdf: { algo: KDF.algo, N: KDF.N, r: KDF.r, p: KDF.p, salt: saltHex },
    cipher: { algo: "aes-256-gcm", iv: iv.toString("hex"), ct: ct.toString("hex"), tag: tag.toString("hex") },
  };
}

// Decrypt a record with the password.
//
// Error messages now tell you WHAT went wrong — not just "bad password" for everything:
//   "bad password"         → password-derived key failed the GCM auth tag (wrong password)
//   "corrupt key record"   → missing fields, invalid hex in ciphertext/iv/tag/salt
//   "key derivation failed"→ scrypt couldn't run (bad params, out of memory)
function decrypt(record, password) {
  // Validate record structure
  if (!record || !record.cipher || !record.kdf) {
    throw new Error("corrupt key record — missing cipher or kdf fields");
  }
  if (!record.cipher.iv || !record.cipher.ct || !record.cipher.tag) {
    throw new Error("corrupt key record — incomplete cipher (missing iv/ct/tag)");
  }
  if (!record.kdf.salt) {
    throw new Error("corrupt key record — missing kdf salt");
  }
  if (!password) throw new Error("password required");

  // Validate ALL hex fields before any parsing — Buffer.from('hex') silently
  // truncates invalid chars in some Node versions, producing garbage bytes.
  // We check first so the user gets "corrupt key" not a misleading "bad password".
  // This includes salt (which was the missing check — salt corruption produced a
  // wrong derived key → GCM auth tag mismatch → falsely reported as "bad password").
  const HEX = /^[0-9a-f]+$/i;
  if (!HEX.test(record.kdf.salt) || record.kdf.salt.length % 2 !== 0) {
    throw new Error("corrupt key record — kdf salt is not valid hex");
  }
  if (!HEX.test(record.cipher.iv) || record.cipher.iv.length % 2 !== 0) {
    throw new Error("corrupt key record — iv is not valid hex");
  }
  if (!HEX.test(record.cipher.ct) || record.cipher.ct.length % 2 !== 0) {
    throw new Error("corrupt key record — ciphertext is not valid hex");
  }
  if (!HEX.test(record.cipher.tag) || record.cipher.tag.length % 2 !== 0) {
    throw new Error("corrupt key record — auth tag is not valid hex");
  }

  // Derive key using the RECORD's own KDF params (not the global defaults)
  let key;
  try {
    key = deriveKey(password, record.kdf);
  } catch (e) {
    // Re-throw deriveKey errors directly — they're already descriptive
    throw e;
  }

  const ivBuf = Buffer.from(record.cipher.iv, "hex");
  const ctBuf = Buffer.from(record.cipher.ct, "hex");
  const tagBuf = Buffer.from(record.cipher.tag, "hex");

  // IV must be exactly 12 bytes for GCM
  if (ivBuf.length !== 12) {
    key.fill(0);
    throw new Error("corrupt key record — GCM iv must be 12 bytes");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivBuf);
  try {
    decipher.setAuthTag(tagBuf);
  } catch (e) {
    key.fill(0);
    throw new Error("corrupt key record — invalid auth tag");
  }

  try {
    const pt = Buffer.concat([decipher.update(ctBuf), decipher.final()]);
    const out = pt.toString("utf8");
    pt.fill(0);
    return out;
  } catch (e) {
    // GCM auth tag mismatch — this is the ONLY case that means "wrong password"
    throw new Error("bad password");
  } finally {
    key.fill(0);
  }
}

// ── Password verifier (one-password-per-wallet model) ──────────────────
// Before v3, each key was independently encrypted — nothing stopped a user
// from encrypting key #1 with "foo" and key #2 with "bar", producing a
// wallet where unlock() could only open a subset of keys with one password.
//
// The verifier enforces ONE password per network bucket:
//   1. First create/import → set the verifier from the password.
//   2. Subsequent create/import → verify password MATCHES before encrypting.
//   3. unlock → fast-check verifier before expensive per-key GCM decrypt.
//
// Verifier shape (wallet-level since v4): { algo:"scrypt-hmac", salt:"<hex>", check:"<hex>", N, r, p }
//   salt  — random 16 bytes, scrypt-derived with the wallet password
//   check — HMAC-SHA256(derivedKey, "waxwing-keystore-v3") — domain-separated
//   N, r, p — the scrypt cost params used when this verifier was created.
//     Storing them IN the verifier means a future KDF bump (stronger params)
//     won't break existing verifiers: verifyPassword reads N/r/p from the
//     verifier itself, not from the global KDF constant. Backward-compat:
//     old verifiers without N/r/p fall back to the current KDF defaults.
// Only the salt+check+N/r/p are stored; the derived key is wiped. Wrong password
// produces a different check → mismatch → reject BEFORE touching any key.
function createVerifier(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const raw = deriveKey(password, { salt, N: KDF.N, r: KDF.r, p: KDF.p });
  const hmac = crypto.createHmac("sha256", "waxwing-keystore-v3");
  hmac.update(raw);
  const check = hmac.digest("hex");
  raw.fill(0);
  return { algo: "scrypt-hmac", salt, check, N: KDF.N, r: KDF.r, p: KDF.p };
}

// Verify a password against a stored verifier. Returns true iff the password
// derives to the same HMAC check. Constant-time comparison to prevent timing
// leaks on the check length. Returns false for missing/malformed verifiers.
//
// Reads scrypt N/r/p FROM the verifier so that verifiers survive KDF bumps;
// falls back to the global KDF defaults for verifiers created before v0.4.2
// (which stored only {algo,salt,check} without the params).
function verifyPassword(password, verifier) {
  if (!verifier || !verifier.salt || !verifier.check) return false;
  if (!/^[0-9a-f]+$/i.test(verifier.salt) || !/^[0-9a-f]+$/i.test(verifier.check)) return false;
  let raw;
  try {
    const N = typeof verifier.N === "number" ? verifier.N : KDF.N;
    const r = typeof verifier.r === "number" ? verifier.r : KDF.r;
    const p = typeof verifier.p === "number" ? verifier.p : KDF.p;
    raw = deriveKey(password, { salt: verifier.salt, N, r, p });
  } catch {
    return false; // scrypt failure → can't verify → treat as wrong password
  }
  const hmac = crypto.createHmac("sha256", "waxwing-keystore-v3");
  hmac.update(raw);
  const check = Buffer.from(hmac.digest("hex"), "hex");
  raw.fill(0);
  const want = Buffer.from(verifier.check, "hex");
  try {
    return check.length === want.length && crypto.timingSafeEqual(check, want);
  } catch {
    return false;
  }
}

// ── Wallet export/import (encrypted backup) ──────────────────────────
// Export: serialise the full store payload as JSON, then encrypt it with the
// wallet password (or a separate export passphrase). The outer blob carries
// version+salt so the import side can derive the key without guessing params.
//   exportWallet(store, password) → { version, app, exportedAt, kdf, cipher }
//   importWallet(data, password)   → the inner store object (decrypted)
//
// The inner payload is the store's portable fields: version, network,
// passwordVerifier, byNet. Config is deliberately excluded (auto-lock ms etc.
// are local preferences, not wallet data).
function exportWallet(store, password) {
  if (!password) throw new Error("password required for export");
  const inner = JSON.stringify({
    version: store.version,
    network: store.network,
    passwordVerifier: store.passwordVerifier,
    byNet: store.byNet,
  });
  const rec = encrypt(inner, password);
  return {
    version: 1,
    app: "waxwing",
    exportedAt: new Date().toISOString(),
    kdf: rec.kdf,
    cipher: rec.cipher,
  };
}

// Decrypt an export blob back into a store-shaped object. Validates the
// outer envelope (app marker, version) before touching the password.
function importWallet(data, password) {
  if (!data || data.app !== "waxwing") throw new Error("not a waxwing export file");
  if (!data.version || data.version < 1) throw new Error("unsupported export version");
  if (!password) throw new Error("password required to decrypt the export");
  const inner = decrypt(data, password);
  let store;
  try { store = JSON.parse(inner); }
  catch { throw new Error("corrupt export — decrypted but not valid JSON"); }
  if (!store.byNet || typeof store.byNet !== "object") {
    throw new Error("corrupt export — missing byNet");
  }
  return store;
}

module.exports = { encrypt, decrypt, deriveKey, createVerifier, verifyPassword, exportWallet, importWallet, KDF };
