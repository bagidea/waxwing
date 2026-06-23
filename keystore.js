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
const KDF = { algo: "scrypt", N: 1 << 17, r: 8, p: 1, keylen: 32 };
const MAXMEM = 256 * 1024 * 1024; // scrypt needs ~128*N*r bytes; give it headroom

function deriveKey(password, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  return crypto.scryptSync(String(password), salt, KDF.keylen, {
    N: KDF.N, r: KDF.r, p: KDF.p, maxmem: MAXMEM,
  });
}

// Encrypt a private-key string under a password. Returns the on-disk record
// shape (no plaintext anywhere in it).
function encrypt(privString, password) {
  if (!privString) throw new Error("nothing to encrypt");
  if (!password) throw new Error("password required");
  const saltHex = crypto.randomBytes(16).toString("hex");
  const key = deriveKey(password, saltHex);
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

// Decrypt a record with the password. A wrong password fails the GCM auth tag
// and throws "bad password" — we never return garbage.
function decrypt(record, password) {
  if (!record || !record.cipher || !record.kdf) throw new Error("corrupt key record");
  if (!password) throw new Error("password required");
  const key = deriveKey(password, record.kdf.salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(record.cipher.iv, "hex"));
  decipher.setAuthTag(Buffer.from(record.cipher.tag, "hex"));
  try {
    const pt = Buffer.concat([decipher.update(Buffer.from(record.cipher.ct, "hex")), decipher.final()]);
    const out = pt.toString("utf8");
    pt.fill(0);
    return out;
  } catch {
    throw new Error("bad password");
  } finally {
    key.fill(0);
  }
}

module.exports = { encrypt, decrypt, deriveKey, KDF };
