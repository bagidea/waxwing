# MEMO — Self-Custody Wallet: 2 Risk Clearances

**To:** CEO  **From:** Sahara (Research)  **Date:** 2026-06-24
**Status:** Researched + cross-referenced + logged to Research Board · **risk #1 corrected after review (2026-06-24)**

---

## 1. LEGAL — `@wharfkit/antelope` "No-Military" clause

**Verdict: there is NO maintained + license-clean Antelope JS signing lib. The honest choice is wharfkit-with-scanner-friction vs. owning an unmaintained fork. For a security-critical wallet, recommend `@wharfkit/antelope` despite the rider.**

> ⚠️ **Correction:** an earlier draft recommended `enf-eosjs` as a "clean MIT, maintained" escape hatch. **That was wrong** — `enf-eosjs` is **archived (read-only) 2024-01-18**, last release 2023-06-07, and its own README says *"⚠ enf-eosjs is deprecated please use WharfKit as the latest EOS SDK."* It funnels straight back to the very library we were trying to avoid. (Board entry `rb_6d339f01` flagged; correction `rb_4953abec`.)

**The license facts (unchanged, confirmed):**
- The license is **BSD-3-Clause + a verbatim "No-Military" rider** (SPDX `BSD-3-Clause-No-Military-License`), *not* plain BSD-3. Exact clause:
  > "YOU ACKNOWLEDGE THAT THIS SOFTWARE IS NOT DESIGNED, LICENSED OR INTENDED FOR USE IN... ANY MILITARY FACILITY."
- Framed as an **acknowledgment/disclaimer** (like the old IBM/Sun "no-nuclear" riders), not an explicit use-ban → real-world exposure for a consumer crypto wallet is **minimal**.
- **It is NOT OSI-approved** and a true no-military restriction would violate **Open Source Definition point 6** (no discrimination against fields of endeavor). But it's **permissive/non-copyleft**, so it **won't taint** our MIT/Apache code and we *can* ship. The real cost is **compliance friction**: scanners (FOSSA/Snyk/Black Duck) flag it "restricted/review-required," and it dents an "open source" claim in procurement/distro reviews.

**The real landscape — every clean-license option is dead:**
| Library | License | Status | Verdict |
|---|---|---|---|
| **`@wharfkit/antelope`** | BSD-3 + No-Military (not OSI) | **Active** (v1.2.0, 2026-04-12); the whole ecosystem standardizes on it | Maintained, but scanner friction |
| `@greymass/eosio` | Same No-Military | Deprecated → wharfkit | Avoid (no license gain + dead) |
| `eosjs` (EOSIO) | clean **MIT** | **Archived 2022-08-02**, pre-Antelope | Clean license, but dead + pre-Antelope |
| `enf-eosjs` (mandel-eosjs) | clean **MIT** | **Archived 2024-01-18, deprecated → WharfKit** | Clean license, but dead — NOT an escape hatch |

> **Key finding:** the Antelope/EOS JS tooling has **consolidated entirely onto Greymass/Wharf**, and they apply the No-Military rider across their libs. There is **no actively-maintained, OSI-clean, Antelope-targeting JS signer**. Both MIT options (eosjs, enf-eosjs) are archived and explicitly redirect to wharfkit.

**So the decision is a genuine trade-off, not a clean swap:**
- **(A) Use `@wharfkit/antelope` + accept scanner friction** — the only maintained, feature-complete option; gets security patches; the rider's real legal risk for a wallet is minimal. **← Recommended for a security-critical wallet.** Mitigate the OSS-optics issue by documenting the dependency's license honestly in SBOM/NOTICE and noting the rider is a disclaimer, not a copyleft term.
- **(B) Fork/vendor an archived MIT lib** (eosjs/enf-eosjs) — buys a clean license but you **own the maintenance burden and miss upstream security patches**. For a crypto wallet that's arguably *worse* than the license friction.
- **(C) Re-evaluate the SDK/chain layer** — e.g. a non-JS signer behind an IPC boundary, or vendoring only the crypto/serialization primitives. Heavier; only if (A)'s friction is a hard blocker for our positioning.

> **Recommendation: go with (A) `@wharfkit/antelope`.** The thing the earlier draft got backwards: the binding constraint isn't license cleanliness (no clean option survives), it's **maintenance** — shipping unmaintained crypto code to protect users' keys is the bigger risk. Have counsel confirm the acknowledgment-vs-prohibition reading and clear the OSS-claim wording before launch.
> *(Engineering/licensing analysis, not formal legal advice.)*

## 2. CRYPTO STACK — encrypted-at-rest private key (desktop/Electron)

**Recommended stack — envelope pattern (KEK wraps DEK):**

```
password ──Argon2id(salt≥16B)──▶ KEK (never stored)
random ────────────────────────▶ DEK (256-bit, stored only wrapped)
KEK ──AEAD──▶ wraps DEK          DEK ──AEAD──▶ encrypts seed
On disk (all non-secret): { salt, kdfParams, nonce, ciphertext, authTag }
```

| Layer | Pick | Params |
|---|---|---|
| Password KDF | **Argon2id** | OWASP min `m=19MiB, t=2, p=1`; **desktop should go 64–256 MiB** (no throughput limit → raises offline-crack cost) |
| KDF fallback | scrypt `N=2^17` / PBKDF2 ≥600k (FIPS only) | — |
| Cipher (AEAD) | **XChaCha20-Poly1305-IETF** | 192-bit nonce = no nonce-reuse footgun, constant-time in SW. (AES-256-GCM acceptable but 96-bit nonce is fragile.) |
| Library | **libsodium** (`crypto_pwhash` + `crypto_aead_xchacha20poly1305_ietf`) | never roll your own |

Separate DEK = user can change password without re-encrypting the seed. *(Reference: MetaMask uses PBKDF2-600k + AES-GCM, but that's browser-constrained — our Electron app should use Argon2id.)*

**Must-follow caveats:**
- **Electron `safeStorage` ≠ password protection.** It's bound to the **OS user**, so any code running as that user (incl. malware) can decrypt. Windows DPAPI doesn't isolate from same-user apps; **Linux can silently fall back to `basic_text` = hardcoded plaintext key** — gate on `getSelectedStorageBackend()`. Use it only as an *additive* layer over the password KDF.
- **`keytar` is deprecated/archived** (since Dec 2022) — VS Code/Signal moved to safeStorage. Don't start on keytar.
- **Never handle keys in the renderer** — do KDF/decrypt in the **main process**; `contextIsolation:true, sandbox:true, nodeIntegration:false`; expose only narrow "sign this tx" IPC.
- **JS/V8 cannot reliably zero secrets in memory** — `buf.fill(0)` is best-effort; prefer libsodium secure memory. Minimize key lifetime, drop on lock.
- Rate-limit unlock + idle auto-lock; auto-clear clipboard on copy; beware swap/crash dumps.
- **Hard limit:** desktop software can never match a hardware wallet (key is exposed in memory at signing). Be honest about this; offer hardware-wallet integration for high-value users.

---

### Sources (on Research Board, tag `wax-wallet`)
- wharfkit LICENSE — github.com/wharfkit/antelope/blob/master/LICENSE (`rb_1668c3d2`)
- OSD point 6 / OSI approval — opensource.org/osd (`rb_c40ce9db`)
- Antelope lib license comparison — `rb_6d339f01` ⚠️ FLAGGED (enf-eosjs claim incorrect; see correction)
- CORRECTION — enf-eosjs archived 2024-01-18 / no clean maintained Antelope lib — github.com/eosnetworkfoundation/mandel-eosjs (`rb_4953abec`)
- OWASP Password Storage (Argon2id) — cheatsheetseries.owasp.org (`rb_28bad00a`)
- Electron safeStorage limits — electronjs.org/docs/latest/api/safe-storage (`rb_6acc6b1c`)
- Also relevant on-board: OWASP Crypto Storage, NIST 800-63B, CCSS, npm supply-chain risk, Electron security checklist.

*All URLs accessed 2026-06-24. Confirmed facts separated from analysis throughout.*
