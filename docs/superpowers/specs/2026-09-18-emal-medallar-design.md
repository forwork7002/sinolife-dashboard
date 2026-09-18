# EMAL medallar + sayqal — `/sellers` klassik taxtasida premium medallar

**Holat:** qurilmoqda — `emal` branch'i (2026-09-18).
**Asos:** `2026-09-17-klassik-taxta-medallar-design.md` (taxta) — o'zgarmaydi. Bu spec faqat medal
ko'rinishi va emoji o'rnidagi ikonkalar haqida.
**Majburiy hujjat:** `assets/2026-09-18-emal-medallar/IMPLEMENT.md` — muhandis uchun to'liq yo'riqnoma
(defs asset, 42 token × 3 mavzu bloki, `CountChip`, CSS, emoji → ikonka jadvali, toj xatosi, testlar,
o'lchangan chegaralar). Ziddiyat bo'lsa IMPLEMENT.md g'olib.

## 0. Mijoz so'zi (2026-09-17 kech, klassik taxta deploy'idan keyin)

> «dizaynni premiumroq qilish kerak, medallarni chiroyliroq — o'yinchoqdek emas, dizaynga
> uyg'unlashgan bo'lishi kerak … medallarni har tomondan yaxshilash kerak»

2026-09-18 ertalab mijoz taqqoslash sahifasida (haqiqiy sahifaning muzlatilgan nusxasi ustida,
production ma'lumoti bilan) **«Yangi medallar + sayqal»** variantini tanladi.

## 1. Qarorlar

1. **Medal ko'rinishi = EMAL** (uch hakam ham tanlagan, SHISHA/ZARGAR grafti bilan): podium rank
   diskining kichik ukasi — emal maydon, ingichka metall halqa, metall belgi. Tishli chet, bo'rtma,
   filtr, yaltiroq YO'Q. Uch daraja: oy/yil sovrinlari TO'LIQ metall disk (oltin/kumush/bronza, o'yma
   belgi), nodir medallar oltin halqa, kundalik medallar po'lat halqa. 14 medal ham doira.
2. **Belgilar:** toj · yarim oy ×3 (raqamsiz — o'rinni metall aytadi) · olov · % · chaqmoq · uch ustun ·
   belgi · o'suvchi strelka · yulduz · quyosh chiqishi · kalendar · nihol. Dafna YO'Q.
3. **×N** — taxtaning o'z chipi (`CountChip`, SVG ichida, faqat podiumda; qatorda sanoq yo'q).
4. **Sayqal (item 1 + 2b + 2c + 2d + 3a + 3c + 4a lozenge + 4b):** 114 emoji → shu uslubdagi chiziqli
   SVG ikonkalar (`BoardIcon`), toj markazlash xatosi (`.rise` inline transform'ni o'chirardi),
   sarlavha diski, karta hairline'lari, chempion bezeli, pog'ona sirti, bitta raqam kesimi, ◆ o'rniga
   chizilgan lozenge, FAKT tugmasi. TASHLANGAN: tone-bar, ro'yxat pastidagi xiralashtirish,
   «so'm» masshtabi, marquee tracking.
5. **O'lchangan chegaralar (mockda, saqlanishi SHART):** medallar taxta geometriyasini 0,00 px
   o'zgartiradi; sayqal bilan podium 1920 da −1 px, 1366 da −2 px (emoji satr bo'shlig'i yo'qoldi),
   raqam ustunlari Δ 0, qator balandligi Δ 0, ism kesilishi 0, qator medali ≤ 28 px.
6. **Tegilmaydi:** DTO, motor, reyting, `MEDAL_ORDER`, `seatMedals`/`rowMedalsOf` qoidalari, avto-skroll.

## 2. Tekshiruv

- Gate: `npm run verify`, `npm run build`, `npm run db:check` (10/11 ma'lum).
- `grep -rn "zarb\|ZARB\|--medal-.*-sh\|m-laurel\|plate-rim" src tests` → faqat tarix izohlari.
- Headless chromium, dpr 1, production fixture'lari: jonli sahifa ↔ mock (`assets/…/out/full-*.png`)
  1920 qorong'i/yorug', bugun, 1366 — piksel farqi faqat sana/sonlarda; geometriya §1.5 dagidek.
- Emoji qolmagan: sahifa matnida 🏆🛡️🥇🥈🥉👑🚀🎯🔥 → 0.
- Deploy: foydalanuvchi 2026-09-18 da tanlov bilan birga ruxsat berdi («1-yo'l bilan davom ettir va
  deploy qil») — gate yashil bo'lsa qayta so'ramasdan push. DTO o'zgarmaydi; TV tabi «Yangi versiya»
  tugmasi orqali yoki bir marta yangilash bilan yangi bundle'ni oladi.
