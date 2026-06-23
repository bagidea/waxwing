# 🗺️ WAX Wallet — Roadmap

The plugin grows in five phases, ordered so that **the riskiest thing (mainnet, real funds) is
last and gated on a real security review**. Each phase is shippable on its own — we never have
to leave the tree in a half-broken state.

The reasoning behind the architecture (WharfKit, self-custody trade-offs, the license and
supply-chain risks) lives in [`MEMO-anchor-decision.md`](MEMO-anchor-decision.md).

> **Guiding rule:** *no server ever holds a key.* Keys are self-custody and **encrypted,
> local-only** (AES-256-GCM + scrypt), or delegated to an external wallet. Mainnet stays out
> of scope until Phase 5, and only behind a full security review.

---

## ✅ Phase 1 — Proof of concept *(done — v0.1.0)*

Prove the connection is real and the architecture is sound, with zero key risk.

- [x] Read-only RPC proxy to WAX **testnet** (`get_info` / `get_account` / `get_currency_balance`).
- [x] Watch-only account lookup: WAX balance + CPU/NET/RAM resources.
- [x] Token balance for any contract (default `eosio.token` / WAX).
- [x] Agent-drivable over the same `/cmd` path the panel uses.
- [x] `sign` is an honest **stub** — echoes the tx shape, never broadcasts, holds no key.
- [x] Verified live against the testnet (chain id matches; bad input errors cleanly).

## 🔄 Phase 2 — Self-custody signing, encrypted local-only *(in progress — v0.2.0)*

Make a transaction actually go through — signed locally, with the key **encrypted at rest** and
**never** on a server.

- [x] Encrypted keystore (`keystore.js`): AES-256-GCM at rest, key derived via scrypt
      (`N=2^15`); only ciphertext + KDF params touch disk — no plaintext, ever.
- [x] Dependencies pinned (`package.json` v0.2.0): `@wharfkit/session`, `@wharfkit/antelope`,
      `@wharfkit/wallet-plugin-privatekey`.
- [ ] Wire the keystore into signing: decrypt in memory → `session.transact({ actions })` via
      `wallet-plugin-privatekey` → broadcast on **testnet** → zero the plaintext key.
- [ ] Replace the server `sign` stub and update `plugin.json` (version + `needsKeys` /
      password prompt) to match.
- [ ] Confirm end-to-end: a real testnet transfer signs from the local encrypted key, plaintext
      never hits disk/log/network.
- [ ] *Alternative path:* keep external-wallet login (WAX Cloud Wallet / Anchor via WharfKit)
      as an option for users who'd rather not store a key here at all.

## 📦 Phase 3 — Wallet UX

Turn the connectivity demo into something you'd actually use on testnet.

- [ ] Transfer UI (recipient / amount / memo) on top of the Phase-2 signing path.
- [ ] Transaction history view (recent actions for the logged-in account).
- [ ] Multi-token display and selection.
- [ ] Session persistence + clean logout.

## 🛡️ Phase 4 — Hardening & resilience

Remove the runtime dependencies and single points of failure before anyone leans on it.

- [ ] **Bundle WharfKit** instead of importing from `esm.sh` at runtime (works offline / locked-down webviews).
- [ ] **Multi-RPC failover** — health-check + endpoint rotation instead of one hard-coded node.
- [ ] CSP / webview hardening review (no `nodeIntegration`, strict CSP, vetted CDN origins).
- [ ] **Legal sign-off** on the `@wharfkit/antelope` *BSD-3-No-Military* license edge and an
      audit of transitive dependency licenses before any commercial use.
- [ ] Supply-chain hygiene: pin/lock dependencies, review the install footprint.

## 🚦 Phase 5 — Mainnet (gated)

Only after a real security review. **Not** committed — evaluated, not assumed.

- [ ] Full security review (CCSS + OWASP) **before** any mainnet code path is added.
- [ ] Mainnet endpoint behind an explicit, clearly-labelled opt-in (never the default).
- [ ] Harden the keystore for real value: consider Argon2id (vs scrypt) and sealing the secret
      in the OS keystore (Electron `safeStorage`) once a native-build path is acceptable.
- [ ] Re-confirm the legal posture — holding keys for real funds edges toward custodial status
      (KYC/AML, single point of loss). Sign off before shipping.

---

### Out of scope (for now)

- Forking Anchor desktop (heavy Electron/crypto maintenance; the upstream desktop app has been
  stable/quiet since 2023 — see the memo).
- Acting as a *hosted/custodial* service that holds user funds on a server.
- Any non-WAX / non-Antelope chain.
