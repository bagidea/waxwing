# waxwing — Brand Kit

**A multichain self-custody wallet by BagIdea Office.** WAX-first, EOS-ready (testnet + mainnet path), Antelope-native.

Designer: **Monanisa** · 2026-06-24 · for owner review.
> ⚠️ I did **not** touch any code (`index.js` / `panel.html` / `keystore.js`) — Poppy holds the code line. This folder is brand assets only.

---

## 1) Name — LOCKED: **waxwing**

> Pronounced *WAX-wing*. Always lowercase in the wordmark; sentence-case ("Waxwing") in body copy is fine.

**Why it wins**
- **It literally contains WAX.** A waxwing is a real crested songbird named for the **wax-red droplets on its wingtips** — an instant, honest tie to the WAX chain without copying anyone.
- **The whole identity falls out of the name.** The bird's waxy wingtip becomes our **one warm amber note** — and that amber *is* the **seal / sign moment** (signing a tx = pressing a wax seal). Cool & glassy everywhere; one warm glow when you commit.
- **Self-custody story:** you hold the keys → *your keys take flight.* Freedom, not an anchor weighing you down.
- **Ownable & practical:** clear in the crypto market (checked), gives the office a real **mascot**, and the mark still reads at **16px**.

### Tagline
**Sign. Seal. Soar.** — *your keys, your wax seal, your flight.*
- *sign* = the wallet's actual job · *seal* = wax / security · *soar* = the waxwing, the freedom of self-custody.
- Short form for chips/footers: **Sign · Seal · Soar**

### Shortlist & clearance (web-search checked, 2026-06-24)
| Name | Verdict | Note |
|---|---|---|
| **waxwing** ⭐ | **LOCKED** | No crypto wallet/token collision found. Only a Bitcoin-dev pseudonym (a person's handle, not a trademark). WAX tie + mascot. |
| Cera | ✅ clear in crypto | Latin for "wax". Elegant, but SEO/TM space dominated by *CERA* sanitaryware (different class — legal, but weak for search). Strong runner-up. |
| Cachet | ✅ mostly clear | Historically *a wax seal*; also "prestige". Sophisticated. Near-homonym to existing **Cache Wallet**; pronunciation not obvious in all 14 languages. |
| Seal | ⚠️ dropped | Most literal, but a common word — impossible to own / trademark / search. |
| Helm | ⚠️ dropped | No crypto-wallet collision, but collides hard with **Kubernetes Helm** in dev tooling. |

**Cleared & killed (collisions):** **Quill** (DFINITY's ICP self-custody wallet — direct hit) · **Crest** (Crest Protocol + a launching BTC wallet) · **Signet** (Bitcoin *signet* test network + Signature Bank Signet) · **Wick** (Wick Trade / Wick Finance) · **Cardinal** (CARDINAL token + ordinals tooling).
*(This supersedes an earlier shortlist recommendation in `design/DESIGN.md`, which was flagged "clearance needed before lock." That name's clearance failed — it's out.)*

---

## 2) Logo

**Concept — "neon waxwing in flight."** A sleek crested bird ascending right, two swept wings, with **one amber wingtip** = the wax drop = the seal/sign moment. Cool cyan→indigo body + a single warm tip mirrors the whole color system in one glyph.

| File | Use |
|---|---|
| `icon.svg` | Primary app icon — rounded-square glass tile, full color + glow. |
| `icon-mono.svg` | Monochrome stamp / favicon. Uses `currentColor` — set `fill`/`color` when you inline it (when used via `<img>` it falls back to black, so inline it or hard-set a fill). |
| `wordmark.svg` | `waxwing` wordmark; the tittle of the **i** is the amber wax-seal dot. *(Dev: outline text to paths before shipping so it's font-independent.)* |
| `lockup.svg` | Horizontal lockup — icon + wordmark. Default for headers/README. |
| `hero-waxwing.png` | Marketing hero / mascot illustration (raster). |
| `preview-brand.png` | Brand on the product — a **real** `panel.html` capture (Send · real broadcast) + lockup/tagline. Source for the full kit board: `preview-brand.html`. |

**Clear space:** keep ≥ the bird's head-height of padding around the lockup. **Min sizes:** icon 16px, lockup 120px wide. **Don't:** recolor the bird off-palette, drop the amber tip, stretch, or add a second warm color.

---

## 3) Color system — office dark + one warm wax note

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#070B16` | canvas / deepest background |
| `--panel` → `--panel2` | `#111B30` → `#0E1729` | cards / surfaces |
| `--line` | `#1F2D49` | hairlines, dividers |
| `--fg` / `--mut` / `--dim` | `#E6EEFF` / `#7F93B8` / `#5A6B8C` | text scale |
| `--acc` → `--acc2` | `#5EC8FF` → `#7AA2FF` | **primary** — office signature cyan→indigo |
| `--seal` → `--seal2` | `#FFB86B` → `#FF9F45` | **the sign / seal moment ONLY** (CTA, wingtip, success-stamp) |
| `--ok` / `--warn` / `--danger` | `#5BD6A0` / `#FFCF6B` / `#FF6B81` | status |

**Discipline:** amber is the *only* warm color and is reserved for the **confirm/sign** action and the logo wingtip. Everything else stays cool and glassy. Keep `--danger` visually distinct from `--seal` (never use amber to mean "error").

---

## 4) Typography & spec
- **Type:** `Segoe UI` / `system-ui` (Thai: `Noto Sans Thai`). Wordmark weight **800**, letter-spacing ≈ `-0.03em`, lowercase. Mono for chain ids / tx hashes / mint #.
- **Spacing:** 4-pt base. Radius — icon tile `58`, cards `22/18`, inputs `13–14`, pills `999`.
- **A11y:** body text ≥ AA on `#111B30`; never use accent color as the *sole* signal (pair with icon/text); touch targets ≥ 40px.
- **Scrollbar (office signature):** slim blue-glass — `scrollbar-color:rgba(110,180,255,.30) transparent`; webkit thumb `rgba(110,180,255,.22)` → hover `.45`.

---

*Consistent with the office dark theme and the existing `panel.html` palette (`#0c1322 / #5ec8ff`) — a drop-in evolution, not a rewrite.*
