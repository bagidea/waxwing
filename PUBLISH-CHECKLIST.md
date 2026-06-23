# 🚀 Publish Checklist — WAX Wallet → BagIdea Plugins Hub

Ready-to-run steps to list this plugin on the [Plugins Hub](https://github.com/bagidea/bagidea-office),
following [`docs/guide/plugin-hub.md`](https://github.com/bagidea/bagidea-office/blob/main/docs/guide/plugin-hub.md).

> ⛔ **Do NOT execute until the owner says go.** Everything below is staged and verified; the
> actual `git push` of a public repo and the catalog PR are the only irreversible/outward steps.

---

## Stage 0 — Pre-flight (do now, safe)

- [x] `LICENSE` present (MIT).
- [x] `README.md` — wallet explainer, install, **testnet-only** warning, **security model**.
- [x] `ROADMAP.md` — the 5-phase plan.
- [x] `CONTRIBUTING.md` — hard rules (testnet-only, key-free, don't touch core).
- [x] `plugin.json` has a stable `id` (`wax-wallet`), clear `name`, `version`, `description`.
- [ ] **Reconcile the version mismatch:** `plugin.json` is `0.1.0` (key-free PoC, `sign` stub)
      while `package.json` is `0.2.0` (self-custody keystore). Pick the real shipped version and
      align both before publishing — don't list a half-wired feature as done.
- [ ] Confirm **no secrets** committed; update `needsKeys` to match reality (a password prompt
      is needed once keystore signing is wired — `[]` is only correct while it's still the stub).

## Stage 1 — Build & publish your repo *(needs owner go)*

1. [ ] Create a **public** GitHub repo, e.g. `github.com/bagidea/bagidea-office-wax-wallet-plugin`.
2. [ ] Push these files to the repo **root** (the office expects `plugin.json` at root):
   ```
   plugin.json   index.js   panel.html   keystore.js   package.json   package-lock.json
   README.md   ROADMAP.md   CONTRIBUTING.md   LICENSE   .gitignore
   MEMO-anchor-decision.md   (optional — design context)
   ```
   - [ ] Confirm `.gitignore` is committed and **`node_modules/` is NOT pushed**.
   - [ ] Confirm **no `keystore.json` / `*.key` / `.env`** got staged (the `.gitignore` guards these).
3. [ ] Tag a release matching `plugin.json` `version` (e.g. `v0.1.0`) so users can see changes.
4. [ ] **Install it once in your own office to confirm it clones & loads cleanly:**
       **🧩 Plugins → paste the GitHub URL** → check the panel opens and `chaininfo` works.

## Stage 2 — Open the catalog PR *(needs owner go)*

Fork `bagidea/bagidea-office`, add **one** entry to [`web/plugins.json`](https://github.com/bagidea/bagidea-office/blob/main/web/plugins.json)
inside the `"plugins"` array, then open a PR. **Paste-ready entry** (replace `repo` with the
real URL from Stage 1; leave `official` off unless the BagIdea team will maintain it):

```json
{
  "id": "wax-wallet",
  "name": "🪙 WAX Wallet",
  "author": "bagidea",
  "repo": "https://github.com/bagidea/bagidea-office-wax-wallet-plugin",
  "tags": ["tools", "blockchain"],
  "th": { "desc": "กระเป๋า WAX (เทสต์เน็ตเท่านั้น) — ดูยอด WAX/โทเคนของบัญชีใดก็ได้ และล็อกอินด้วยวอลเล็ตจริงเพื่อเซ็นธุรกรรม โดยเซิร์ฟเวอร์ไม่ถือ private key เลย" },
  "en": { "desc": "A WAX wallet (testnet only) — look up any account's WAX/token balance and log in with a real wallet to sign, while the server never holds a private key." }
}
```

Checklist for the PR:

- [ ] `id` in the entry **exactly matches** `plugin.json` `id` (`wax-wallet`).
- [ ] `repo` points at the public repo from Stage 1 and clones without auth.
- [ ] Both `th` and `en` `desc` present (EN required; TH provided).
- [ ] JSON is valid (no trailing comma; entry sits inside the `plugins` array).
- [ ] `official` **omitted** unless the BagIdea team commits to maintaining it.
- [ ] PR description: one line on what it does + that it's **testnet-only / key-free**.

## Stage 3 — Review & merge

- [ ] A maintainer reviews the repo (loads, nothing unsafe) and the entry (well-formed).
- [ ] Once merged, it appears in the in-office Hub live — **no app update needed**.

---

### Quick validation commands (run before pushing)

```bash
# plugin.json id must equal the catalog entry id
node -e "console.log(require('./plugin.json').id)"   # → wax-wallet

# the catalog entry above must be valid JSON
node -e "JSON.parse(require('fs').readFileSync('catalog-entry.json','utf8')); console.log('ok')"
```

### Good-citizenship reminders (from the hub guide)

- Be honest in the description — say what it touches (testnet RPC; no keys).
- Don't modify the office core (`daemon/`/`godot/`/`shell/`/`cli/`).
- Keep secrets out; read any keys from the office at runtime.
- Version every release so users can tell what changed.
