# Klassik taxta + medallar — `/sellers` eski ko'rinishiga qaytadi, daraja olib tashlanadi

**Holat:** amalga oshirildi — klassik branch'i, deploy kutmoqda (2026-09-17).
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

## 4. Chetlanishlar

Ataylab qilingan, o'lchangan. Har biri eski taxta (`:3011`) bilan yonma-yon, production fixture'larida,
dpr 1 da tekshirilgan.

1. **§1.6 «≤ 10–12 %» — o'rindiq ichki bo'shliqlari undan ko'proq siqilgan.** Podium `padding` 22/14 → 18/10,
   karta pastki bo'shlig'i 14 → 10 (chempionda 18 → 10), yon o'rindiqlar ustki bo'shlig'i 22 → 18, halqa
   ostidagi oraliqlar bir Tailwind pog'ona tor, halqalar 60/46/40 → 56/43/37. Sabab — §1.5: tokcha 46 px
   oladi va podium o'smasligi shart; §1.5 bu joyni aynan shu bo'shliqlardan olishni buyuradi va son
   bermaydi. **Pog'ona esa chegarada:** eski ifoda minus 1.2 px (televizorda 28.6 px, eski 29.8 — 96 %).
   Bir kun u 22 px edi (−29 %, beshinchi butun qator evaziga) — review buni qaytardi: bloklar chiziqdek
   ko'rinardi, bronza kartasi kumushdan baland turardi.
2. **Beshinchi BUTUN qator yo'q.** 1920×1080 «Shu oy»: sotuvchilar 4 butun + 0.82 (eski 4 + 0.50),
   komandalar 6 butun (eski 5). Qatorlar 65.4 → 61.5 px (−6 %). «Kamaymagan» sharti bajarilgan; beshinchi
   butun qator faqat zinani buzish evaziga kelardi.
3. **Komandalar podiumi eskisidan 46 px PAST** (443 → 397): siqilgan bo'shliqlar umumiy, tokcha esa yo'q.
   Komandalar ro'yxati shundan bir qator yutadi.
4. **1280–1599 da o'rindiq medallari 36/32 px** (§1.5 «36–40 px» deydi). 1366 noutbukda summa ~17 px,
   ustidagi 40 px medal pulni bosib ketardi. Televizor (≥ 1600) 40/36 da. To'rtta medal sig'maganda ular
   baribir birga kichrayadi (dumaloq qoladi).
5. **Qatorda «3 tagacha» — kenglikka qarab 3, 1–2 yoki 0.** Televizorda 3; 1280–1799 da 2 tagacha;
   1280–1319 va 1600–1659 da umuman chizilmaydi (ism katagi ~190 px, chase ~160 px — joy yo'q, shuning
   uchun chiziq ham qisqarmaydi). Sig'magan medal BUTUNLIGICHA tushadi, kesilmaydi.
6. **Telefonda medalli qator 26–30 px o'sadi** — medallar chase ostida o'z satrida. §1.5 ning «qator
   o'smaydi» va'dasi televizor/noutbukniki; telefonda sahifa skroll bo'ladi, ism katagi 126 px.
7. **Qorong'i mavzuda po'lat medal tokenlari tasdiqlangan ZARB maketidagidan yorug'roq** (beshta token,
   faqat ikki qorong'i blokda; chizma va yorug' mavzu o'zgarmagan). 26 px da tana/qator kontrasti
   1.6–2.4:1 edi, qatorlardagi medallarning ~95 % i po'lat.
8. **Chempion pilyulasi 1280–1345 px oralig'ida uchinchi satrga o'tadi** (toshib chiqish o'rniga) — u yerda
   sotuvchilar podiumi eskisidan 7 px baland (464 vs 457, 1280 da). Matritsadan tashqari kenglik;
   1366 va 1920 da podium eskisidan past yoki teng (436 vs 444; 488.9 vs 489.0).
9. **Yolg'iz `first-sale` o'rindiqda QOLADI.** Review uni yashirishni taklif qildi (kichik po'lat kvadrat,
   127 sotuvchidan 121 tasida bor); rad etildi — §1.3/§1.5 o'rindiqdan hech bir medalni chiqarmaydi va
   sotuvchining yagona medalini yashirish mahsulot qarori. `seatMedals` uni faqat nodir yoki gilt medal
   yonida tushiradi.

**Ochiq qolgani (eski taxtadan meros, bu partiyada tuzatilmagan):** 1366×768 da ro'yxat 69 px (eski 61),
birorta butun qator yo'q; telefondagi `.tv-seat-card` 8 px yon bo'shlig'i o'lik qoida (ikkala taxtada).
