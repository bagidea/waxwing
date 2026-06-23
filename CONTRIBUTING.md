# Contributing to WAX Wallet

Thanks for your interest! This is a small, focused [BagIdea Office](https://github.com/bagidea/bagidea-office)
plugin. Contributions are welcome — please read the rules below first, because a wallet plugin
has a couple of hard lines we don't cross.

## 🚦 Hard rules (non-negotiable)

1. **Testnet only.** Do not add a mainnet endpoint or any mainnet code path outside of what
   [`ROADMAP.md`](ROADMAP.md) Phase 5 describes (which is gated on a security review). The
   testnet RPC stays hard-coded.
2. **No server ever holds a key; self-custody keys stay encrypted, local-only.** No
   hosted/remote server may hold, read, log, or transmit a private key. A key may only be kept
   for local self-custody signing if it is **encrypted at rest** (AES-256-GCM, key derived via
   scrypt — see `keystore.js`); plaintext may exist **only transiently in memory** while
   signing and must never be written to disk, logged, or sent over the network. Delegating to
   an external wallet (WAX Cloud Wallet / Anchor via WharfKit), so we hold no key at all, is
   also fine. Anything that weakens these guarantees (plaintext at rest, a server-side signing
   path, keys over the wire) doesn't belong here — open an issue first.
3. **No secrets in the repo.** `needsKeys` stays empty unless there's a real reason; read any
   credentials from the office at runtime, never commit them.
4. **Don't touch the office core.** Plugins must not modify `daemon/`, `godot/`, `shell/`, or
   `cli/`. Extend through the plugin API only (routes, panel, commands). See
   [`docs/guide/plugins.md`](https://github.com/bagidea/bagidea-office/blob/main/docs/guide/plugins.md).

## 🧱 Project layout

| File | What it is |
|---|---|
| `plugin.json` | Manifest: id, version, commands, window. **`id` must stay `wax-wallet`.** |
| `index.js` | Server side — read-only RPC proxy + the `sign` stub. Pure helpers are exported on `module.exports._test`. |
| `panel.html` | The UI: watch-only lookup + WharfKit login path. |
| `README.md` / `ROADMAP.md` | Docs. Keep them honest about what's verified vs. stubbed. |

## 🛠️ Development

```bash
# 1. Fork & clone, then point the office at your local copy
#    (🧩 Plugins → paste your GitHub URL, or symlink into plugins/wax-wallet/)

# 2. Reload the plugin after changes (no app restart needed)
curl -s -X POST http://127.0.0.1:8787/plugins/reload -H "x-bagidea-ui: 1"

# 3. Smoke-test the commands
curl -s -X POST http://127.0.0.1:8787/plugin/wax-wallet/cmd \
  -H "content-type: application/json" -d '{"cmd":"chaininfo"}'
```

You can also exercise the pure helpers directly against the live testnet without the office
running, via `require("./index.js")._test` (`rpc`, `chainInfo`, `accountInfo`, `tokenBalance`,
`parseArgs`).

## ✅ Before you open a PR

- [ ] **Verify it live** — run the affected commands against the testnet and paste the output
      in the PR. "Should work" isn't enough; show it working.
- [ ] **Kill every process you started** — no dev servers or test processes left running.
- [ ] Keep the docs truthful: if something is a stub or unverified, label it as such (the
      README's status table is the model).
- [ ] One focused change per PR; explain the *why*, not just the *what*.
- [ ] Confirm you didn't break the testnet-only / key-free guarantees above.

## 💬 Questions

Open an issue on this repo, or in the office repo:
`github.com/bagidea/bagidea-office/issues`.

By contributing you agree your work is licensed under the project's [MIT License](LICENSE).
