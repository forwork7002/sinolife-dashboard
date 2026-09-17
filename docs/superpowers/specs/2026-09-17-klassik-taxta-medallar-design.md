# Klassik taxta + medallar — `/sellers` eski ko'rinishiga qaytadi, daraja olib tashlanadi

**Holat:** qurilmoqda — `klassik` branch'i (2026-09-17).
**O'rnini bosadi:** `2026-09-16-daraja-va-medallar-design.md`, `2026-09-16-efir-taxta-design.md`,
`2026-09-17-efir-premium-design.md` — uchalasi ham BEKOR (tarix sifatida qoladi).

## 0. Mijoz so'zi (2026-09-17, EFIR Premium chiqqandan keyin)

> «sotuvchilar reytingi bo'limi menga yoqmadi, avvalgi eski holatiga qayt va o'sha eski holatini
> yaxshilashing kerak … avvalgisi yaxshi edi … uroven bo'limini ol, uroven kerak emas, medallar qolsin»

To'rtta qayta dizayn (pagon lentasi, lavha-pagon, EFIR, EFIR Premium) rad etildi. Mijozga yoqqan
yagona taxta — medal ishidan OLDINGI taxta (`912fc63`): pog'onali podium (2–1–3), progress chiziqli
qatorlar, pushti «Sotuvchilar» va yashil «Komandalar» paneli, sarlavhada rekord lentasi.
**Bu safar ijod emas, intizom:** eski taxta TIKLANADI, unga medallar tabiiy qo'shiladi, o'lchanadigan
nuqsonlar tuzatiladi. Yangi vizual til ixtiro qilinmaydi.

Eski taxtaning jonli nusxasi taqqoslash uchun: `http://localhost:3011/sellers` (worktree
`/home/smack/Work/ISH-old`, `912fc63`). Skrinshotlari: `/home/smack/Work/.playwright-mcp/old-board-1920-*.png`.

## 1. Qarorlar

1. **Taxta = `912fc63` dagi taxta.** `SellersPage.tsx`, `RecordWall.tsx`, `useAutoScroll.ts` va
   `globals.css` ning uch bo'limi (PODIUM · TV BOARD · THE RECORD WALL) o'sha commit'dan tiklanadi.
   Tuzilma, ranglar, podium, pog'onalar, emoji belgilar, chase chiplari, progress chiziqlari, ustunlar,
   pul formati («82,100,000 so'm», vergul bilan), rekord lentasi (marquee) — HAMMASI eski holicha.
2. **Daraja (uroven) butunlay yo'q.** UI'da ham, payload'da ham, motorda ham:
   `level`, `legendaTier`, `rankTitle`, `delivered`, `levelFloor`, `nextLevelAt`, `nextTitle`,
   `promotedOn`, `today`, `LEVEL_*`, `levelOf…`, `MEDAL_UNLOCK_LEVEL` — o'chadi.
   Gerb (`Crest`), legenda (`TierLegend`), ko'tarilish e'loni (`PromotionBanner`, `usePromotions`),
   `--tier-*` va `--efir-*` tokenlari, EFIR CSS bo'limi — o'chadi.
3. **Medallar qoladi va ESHIKSIZ uzatiladi.** Daraja yo'q ekan, ko'rinmas daraja medalni yashira
   olmaydi: motor topgan har bir medal payload'da. 14 medal, `MEDAL_ORDER` (haqiqiy metall avval)
   o'zgarmaydi. Payload: `{ sellers: [{ employeeId, medals }], from }`.
4. **Medal ko'rinishi = ZARB** (zarb qilingan tanga to'plami, mijoz 2026-09-17 da tasdiqlagan):
   `MedalMark`, `MedalDefs`, `medalDefs.ts`, `medalCatalog.ts`, `RowMedals`. `medalDefs.ts`
   generatsiya qilinadi (`scripts/genMedalDefs.mjs`) — qo'lda tahrirlanmaydi; gerb/halqa/tanga-rank
   belgilari generatordan chiqarib tashlanadi, faqat `m-*` medallar va ular ishlatadigan gradient/filtrlar qoladi.
5. **Medal joylashuvi.**
   - *Podium kartasi (faqat sotuvchilar):* komanda chipi ostida bitta tokcha — 1-o'rinda 4 tagacha,
     2/3-o'rinda 3 tagacha, 36–40 px, takror medalda SVG ichidagi «×N» plaketi. «+N» yo'q, matnli izoh yo'q.
     Podiumning 1920×1080 dagi umumiy balandligi eski taxtadagidan OSHMAYDI — joy karta ichki
     bo'shliqlari va pog'ona balandligini siqish hisobiga topiladi.
   - *Qator:* 3 tagacha medal, 26–28 px, «+N» yo'q, `first-sale` qatorda chizilmaydi. Joyi — ism
     katagining o'ng chetida, progress chizig'i/chase satri balandligida (chiziq qisqaradi). Qator
     balandligi o'smaydi, ism kesilmaydi, raqam ustunlari joyidan qo'zg'almaydi.
   - *Yangi medal:* ikki payload orasida paydo bo'lgan medal bir marta `isNew` animatsiyasi bilan
     chiqadi (`useNewMedals` — alohida faylga ko'chadi). Reload'da animatsiya yo'q.
   - Komandalar panelida medal yo'q.
6. **Yaxshilash = o'lchanadigan nuqsonlar, yangi uslub emas.** Ruxsat etilgan ishlar:
   - haqiqiy 1920×1080, 1366×768 va telefon (390) da kesilish/ustma-ust tushish/toshib ketishni yo'qotish;
   - ikkala mavzuda matn kontrasti ≥ 4.5:1 (bezak matnidan tashqari);
   - raqam ustunlari `tabular-nums` va o'ngga tekis;
   - ko'proq qator ko'rinsin: podium va qator ichki bo'shliqlarini ≤ 10–12 % siqish mumkin, ko'rinish o'zgarmasdan;
   - «Bugun» ertalabki holat: pulsiz qatorlarda qalin «0» o'rniga so'nik «—» (ma'no o'zgarmaydi, tartib o'zgarmaydi);
   - medal va raqamlar ma'lumoti API bilan so'mgacha mos (2026-09-17 auditi: raqamlar to'g'ri — hisob-kitobga tegilmaydi).
7. **Tegilmaydi:** reyting hisobi, FAKT 1/FAKT 2 mantig'i, `'auto'` tanlovi, avto-skroll, davr tugmalari,
   `/confirmation`, umumiy primitivlar (`AnimatedNumber` hozirgi bir tugunli holida qoladi).

## 2. Fayl egaligi (parallel ish uchun)

| Ishchi | Fayllar |
|---|---|
| **R — tiklash** | `src/features/sellers/**` (`medalCatalog.ts` DAN TASHQARI), `src/app/globals.css`, `tests/features/**` (`medalCatalogMirror.test.ts` DAN TASHQARI), `scripts/genMedalDefs.mjs`, eski spec'larning holat satri |
| **S — server** | `src/server/**`, `src/lib/api.ts`, `src/features/sellers/medalCatalog.ts`, `tests/domain/**`, `tests/services/**`, `tests/http/**`, `tests/features/medalCatalogMirror.test.ts`, `docs/API.md`, `CLAUDE.md` dagi daraja eslatmalari |

## 3. Tekshiruv

- Gate: `npm run verify`, `npm run build`, `npm run db:check` (10/11 — ma'lum 21 qator).
- `grep -rniE "legendaTier|promotedOn|nextLevelAt|MEDAL_UNLOCK_LEVEL|--tier-|--efir-|crest|TierLegend" src tests` → bo'sh.
- Headless chromium (dpr 1, aniq viewport, production fixture'lari `page.route` orqali):
  1920×1080 / 1366×768 / 390 × qorong'i / yorug' × «Shu oy» / «Bugun» (to'la, ertalabki, bo'sh).
  Har ko'rinishda: kesilgan matn 0, ustma-ust 0, gorizontal skroll 0, konsol xatosi 0.
- Eski taxta (`:3011`) bilan yonma-yon: podium balandligi o'smagan, ko'rinadigan qatorlar soni kamaymagan.
- Deploy faqat foydalanuvchi «deploy qil» deganda; keyin televizor tabi bir marta yangilanadi
  (eski bundle darajasiz payload'ni o'qiy olmaydi).
