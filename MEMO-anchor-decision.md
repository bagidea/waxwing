# MEMO — ตัดสินใจเรื่อง Greymass Anchor → WAX Wallet Plugin

จาก: Sahara (Researcher) · ถึง: CEO · วันที่: 2026-06-24
แหล่งอ้างอิงทั้งหมด (16) บันทึกใน Research Board แล้ว (agent: sahara)

---

## TL;DR — คำแนะนำ
**อย่า fork Anchor.** ให้สร้าง WAX Wallet plugin บน **WharfKit (Session Kit)** แล้ว **มอบหน้าที่ "ถือ key + เซ็น" ให้ wallet ภายนอก** (WAX Cloud Wallet ผ่าน `wallet-plugin-cloudwallet` และ/หรือ Anchor ผ่าน `wallet-plugin-anchor`) — plugin ของเรา **ไม่ต้องเห็น private key เลย**. นี่คือเส้นทางที่ Greymass เองออกแบบมาและยังลงทุนต่อ ทั้งความเสี่ยงต่ำสุดและงานน้อยสุด.

---

## 1) สถานะ Anchor — deprecated หรือยัง?
- repo **ยังไม่ถูก archive** และยังมี commit (push ล่าสุด 2025-12) — แต่ **release เดสก์ท็อปตัวเสถียรล่าสุดคือ v1.3.12 (27 มิ.ย. 2023)** = นิ่งมา ~2.5 ปี [CONFIRMED]
- Greymass **เปลี่ยนตำแหน่ง Anchor เป็น "authenticator/บัญชี"** และยกหน้าที่ "wallet" ไปให้ **Unicove (web wallet)** บนหน้า products ทางการ [CONFIRMED]
- **ไม่มีประกาศ EOL อย่างเป็นทางการ** และ Anchor **มือถือ** ยัง active (Android v0.66, พ.ค. 2025) — ส่วนที่นิ่งคือ "เดสก์ท็อป" ไม่ใช่ทั้งโปรดักต์ [CONFIRMED]
- → ทิศทางชัด: Greymass ดันคนไป **Unicove + Anchor(authenticator) + WharfKit(SDK)** ส่วน "fork Anchor desktop" = ไปรับโค้ด Electron/React เก่าที่เจ้าของเองก็ไม่ค่อยลงแรงต่อแล้ว [อนุมานที่หลักฐานหนุนแน่น]

## 2) LICENSE ของ anchor
- **MIT** (permissive) — fork / rebrand / ขายเชิงพาณิชย์ / ปิดซอร์ส derivative **ได้หมด ไม่มี copyleft** [CONFIRMED จากไฟล์ LICENSE จริง]
- ข้อผูกมัดเดียว: ต้องคง notice ลิขสิทธิ์+permission ไว้
- ⚠️ MIT **ไม่ให้สิทธิ์เครื่องหมายการค้า** — ห้ามใช้ชื่อ/โลโก้ "Anchor"/Greymass ต้อง rebrand เป็นชื่อเราเอง

## 3) สถาปัตยกรรม Anchor
- **Electron + React + JavaScript** (~99.6% JS), repo ~24 MB, ~3,500 commits, 261 open issues — โค้ดเบสใหญ่-สุกแต่หนัก [CONFIRMED]
- เดสก์ท็อปข้ามแพลตฟอร์ม (Win/macOS/Linux); มือถือเป็นคนละ repo
- **ผูกกับ Antelope/EOSIO แน่น** (signing-request protocol, account model, Ledger) — เป็น wallet เฉพาะเชน ไม่ chain-agnostic

## 4) ทางเลือกเชื่อม WAX — เทียบ 3 ทาง

| มิติ | **WharfKit (Session Kit)** ⭐ | WAX Cloud Wallet / waxjs | Fork Anchor |
|---|---|---|---|
| คืออะไร | SDK โมดูลาร์ของ Greymass, framework-agnostic npm (browser+Node) | ไลบรารีต่อ WCW (custodial) | ทั้ง wallet app |
| WAX support | ✅ ทางการ (WAX มี tutorial เอง) | ✅ native | ✅ (Antelope) |
| ถือ key ไหม | **ไม่** — route การเซ็นไป wallet ภายนอก | **ไม่** — WCW ถือ+เซ็นฝั่ง server | **ใช่ — เราต้องถือเอง** ⚠️ |
| License | BSD-3 (commercial-OK; core antelope = BSD-3-No-Military) | MIT | MIT |
| Maintenance | ✅ session v1.6.1 (ก.ย. 2025), commit ถึง 2026 | ⚠️ npm ค้างที่ v1.7.1 (ก.พ. 2024) | ⚠️ desktop นิ่งตั้งแต่ 2023 |
| งานฝั่งเรา | น้อย-ปานกลาง: ฝัง SDK + เลือก wallet plugin | น้อยสุด (~3 บรรทัด) แต่ผูก popup/web + บริการ hosted ของ WAX | มหาศาล (ดูแล Electron + crypto เอง) |
| เหมาะเป็น office plugin | **ที่สุด** | ดีถ้าโอเคกับ WCW custodial + web popup | ไม่เหมาะ |

**ทำไม WharfKit ชนะสำหรับ office plugin:**
- เป็น npm lib เบา ฝังใน Electron renderer / web panel ของ plugin เราได้ (ไม่ต้องลง wallet เดสก์ท็อปเต็มตัว)
- ครอบทั้งสองโลก: รองรับ **WCW + Anchor เป็น wallet plugin** ในตัว → ให้ผู้ใช้เลือก wallet ที่มีอยู่แล้ว, เราไม่แตะ key
- ถ้าวันหน้าอยากทำ wallet UI/จัดการ key เอง: ใช้ `@wharfkit/antelope` เป็น crypto primitive + เขียน custom WalletPlugin ครอบ keystore ของเรา (ยัง reuse session/ABI/persistence ได้) — **แต่ค่อยทำ ไม่ใช่ค่าเริ่มต้น**
- *หมายเหตุ:* WharfKit เองเป็น **session layer ต่อ wallet** ไม่ใช่ตัวจัดการ key — ตรงนี้คือจุดแข็งด้าน security ของเรา ไม่ใช่จุดอ่อน

## 5) ข้อควรระวัง security ของการถือ private key
- **Supply-chain คือภัยจริงที่สุด**: ปี 2025 มี npm payload (chalk/debug compromise, Shai-Hulud ที่แพร่ตัวเอง) ที่สแกน+ขโมยไฟล์ key ของ wallet โดยตรง — ทีมเล็ก audit สู้ไม่ไหว [CONFIRMED]
- **Electron**: XSS ใน renderer ที่เปิด nodeIntegration = ดูดไฟล์ key ได้ → ต้อง `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, CSP เข้ม, ตรวจ IPC sender, เลี่ยง `file://`
- ถ้า **ต้องถือ key จริง**: AES-256-GCM at rest + คีย์มาจากรหัสผ่านผ่าน **Argon2id** (m=19456KiB,t=2,p=1) + เก็บคีย์เข้ารหัสแยกใน OS keystore (Electron `safeStorage`) + zero memory หลังเซ็น + ห้าม log/ส่ง net + backup เข้ารหัส; ตามมาตรฐาน **CCSS** + OWASP — ภาระหนักและพลาดง่าย
- **ภาระทางกฎหมาย**: ถือ key = เข้าใกล้สถานะ custodial (KYC/AML, จุดล้มเหลวจุดเดียวที่ผู้ใช้เสียเงินกู้คืนไม่ได้)
- **บรรทัดล่าง: ทีมเล็กไม่ควรถือ key เอง** — มอบการเซ็นให้ wallet ภายนอกผ่าน session protocol คือดีไซน์ที่ปลอดภัยและ liability ต่ำสุด

---

## ความเสี่ยงที่ต้องจับตา (ของแนวทางที่แนะนำ)
1. **WharfKit license edge**: `@wharfkit/antelope` เป็น *BSD-3-No-Military-License* (ข้อ non-standard, ไม่ผ่าน OSI) — ไม่กระทบ wallet ทั่วไป แต่ให้ legal ดูก่อนปล่อยเชิงพาณิชย์; และ audit license ของ transitive deps (org เคยมี repo ที่เป็น AGPL/Apache)
2. **พึ่งบริการ hosted**: ถ้าใช้ WCW path เราผูกกับ login service ของ WAX (จุดล้มเหลวศูนย์กลาง + ต้องมี web/popup context — ใน Electron ต้อง spike จริงว่า popup/redirect ทำงาน)
3. **waxjs ค้าง**: ถ้าเลือกพึ่ง waxjs ตรงๆ ระวัง maintenance (npm ไม่ออกตัวใหม่ตั้งแต่ ก.พ. 2024) — ใช้ผ่าน cloudwallet plugin ของ WharfKit จะปลอดภัยกว่าในแง่ถูกดูแลต่อ
4. **ถ้าฝืนทำ wallet ถือ key เอง**: รับภาระ CCSS+OWASP+Electron hardening เต็ม + ความเสี่ยง supply-chain — ไม่แนะนำสำหรับเฟสแรก

## ขั้นถัดไปที่เสนอ
1. ตั้งสถาปัตยกรรม plugin บน `@wharfkit/session` + `@wharfkit/wallet-plugin-cloudwallet` (+ `-anchor` เป็นทางเลือก)
2. Spike เล็ก: login WCW/Anchor จาก web panel ของ office แล้ว transact บน WAX testnet — ยืนยันว่าไม่มี key ผ่านมือเรา
3. ให้ legal ปิด license edge ของ `@wharfkit/antelope`
4. ค่อยพิจารณา self-custody (custom WalletPlugin + keystore เข้ารหัส) เป็นเฟสหลัง ถ้าจำเป็นจริง
