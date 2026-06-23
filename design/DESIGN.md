# waxwing — WAX Wallet · Identity + UI/UX (flagship concept)

> ⚠️ **NAME (2026-06-24):** the locked brand is **waxwing** — see `../brand/BRAND.md`.
> An earlier shortlist favorite was dropped after trademark clearance failed (crowded crypto
> namespace). The UI/UX spec below still stands; only the name + logo concept changed.

Designer: **Monanisa** · 2026-06-24 · for owner review.
Goal: be **better than Anchor** and serve as a **showcase of BagIdea Office**.
Boards: `preview-identity.png`, `preview-screens.png` (source: `mockup-identity.html`, `mockup-screens.html`).

> Architecture truth (from Sahara's MEMO): **non-custodial** — signing is delegated via WharfKit;
> we never hold a private key. The identity below leans into exactly that: *“your seal, your keys.”*

---

## 1) Name — locked: waxwing (shortlist, no “Anchor”)

| # | Name | Why |
|---|------|-----|
| **1 ⭐** | **waxwing** *(locked)* | **A waxwing is a real crested bird named for the wax-red droplets on its wingtips → a built-in tie to WAX.** The wallet's whole job is **signing**; your keys stay on your machine and the tx takes flight. Short, ownable, mascot-ready, and out of Anchor's heavy maritime shadow. |
| 2 | **Helm** | Self-sovereignty made **active** — you steer your own ship. Where an anchor weighs you down, the helm puts you in control. 4 letters, strong; sits next to Anchor but one-ups the metaphor. |
| 3 | **Seal** | Most literal WAX play — you **seal** each transaction in wax. Warm, concrete, easy in all 14 languages. Risk: a common word. |
| 4 | **Cardinal** | Navigation's **cardinal marks** + a “cardinal rule” of trust + a compass direction. Premium, editorial. Longer but confident. |
| 5 | **Quill** | You sign with a **quill**, then press the wax seal. Craft/heritage tone; elegant beside a seal motif if we go artisanal. |

Trademark note: all five avoid the “Anchor”/Greymass marks (MIT gives no TM rights). Quick clearance
recommended before lock — “Keystone”/“Beacon”/“Vault” were dropped (existing wallet/chain collisions or custodial over-promise).

## 2) Logo / color / mood

**Logo — “seal medallion.”** A rounded shield/hexagon (a nod to blocks) in cool blue glass, embossing a
**keyhole** glyph = identity + security. Three locked variants: glass app-icon · solid favicon (legible at 16px) ·
monochrome line/stamp. (See identity board.)

**Color — extends the office dark theme; adds ONE warm note.**

| Token | Hex | Use |
|---|---|---|
| `--bg` canvas | `#070b16` | board / deepest background |
| `--panel` → `--panel2` | `#111b30` → `#0e1729` | cards / surfaces |
| `--line` | `#1f2d49` | hairlines, dividers |
| `--fg` / `--mut` / `--dim` | `#e6eeff` / `#7f93b8` / `#5a6b8c` | text scale |
| `--acc` → `--acc2` | `#5ec8ff` → `#7aa2ff` | **primary** (office signature cyan→indigo) |
| `--seal` → `--seal2` | `#ffb86b` → `#ff9f45` | **the sign/confirm moment ONLY** |
| `--ok` / `--warn` / `--danger` | `#5bd6a0` / `#ffcf6b` / `#ff6b81` | status |

**Mood — “quiet confidence, self-custody calm.”** Cool, glassy, precise everywhere; the **single warm glow
is the act of sealing** a transaction. That one amber moment is both our signature interaction and the visual
differentiator from Anchor's flat, dated, all-blue UI.

## 3) Screens (see `preview-screens.png`)

1. **Balance / Home** — account chip, big WAX balance + fiat + 24h chip, Send/Receive/Stake, **CPU/NET/RAM
   resource gauges** (a WAX-native detail generic wallets miss), token list, bottom nav.
2. **Send** — recipient (account-name validated), big amount + token picker + Max, optional memo, a
   non-custodial reassurance note, and the **amber “Seal & Send”** CTA (the warm moment).
3. **Unlock** — local app lock: seal logo, account chip, password + show toggle, Windows Hello, and the
   footer promise *“your keys never touch our servers.”* (Unlocks the local session/watch-list; signing still delegates.)
4. **NFTs (future)** — AtomicAssets grid, collection filter chips, rarity badges, mint #; the scroll area
   shows the **signature slim blue-glass scrollbar**. Marked FUTURE.

## 4) Dev hand-off notes

- **Spacing**: 4-pt base. Card radius `18px`, frame `26px`, inputs `13–14px`, pills `999px`. Card padding `16px`.
- **Type**: `Segoe UI / system-ui` (Thai: `Noto Sans Thai`). Sizes — balance `34/800`, H `16/800`,
  body `13–14`, label `11 uppercase .12em`, mono for chain ids/mint.
- **Scrollbar (mandatory, office signature)** — apply to every scroll surface:
  ```css
  *{scrollbar-width:thin;scrollbar-color:rgba(110,180,255,.30) transparent;}
  ::-webkit-scrollbar{width:9px;height:9px}
  ::-webkit-scrollbar-thumb{background:rgba(110,180,255,.22);border-radius:6px}
  ::-webkit-scrollbar-thumb:hover{background:rgba(110,180,255,.45)}
  ```
- **Component states to build**: button (default/hover/disabled/loading), input (default/focus `0 0 3px rgba(94,200,255,.12)`/valid/error),
  the seal CTA (idle → pressing-glow → success-stamp), resource bar, token row, NFT card, net pill (online/offline/testnet).
- **A11y**: body text ≥ AA on `#111b30`; accent text used for emphasis, never as sole signal (pair with icon);
  touch targets ≥ 40px; amber seal is for the *confirm* action only — keep destructive `--danger` distinct.
- The existing `panel.html` already uses `#0c1322 / #5ec8ff` — this is a **drop-in evolution**, not a rewrite.

## 5) SYNC seams (for whoever wires the panel — Yamamoto/dev)
- **SYNC#0** route stays `/plugin/wax-wallet/cmd` (`chaininfo`/`account`/`balance`/`sign`-stub) — UI binds to it unchanged.
- **SYNC#1** Send screen → real `session.transact({actions})` after WharfKit login (replaces server `sign` stub).
- **SYNC#2** NFT screen → AtomicAssets API (future); grid + filters are layout-ready.
- **SYNC#3** Unlock = *local* app lock (Electron `safeStorage`), NOT key custody — copy must keep the non-custodial promise honest.
