# EMAL medallar + sayqal — `/sellers` klassik taxtasida premium medallar

**Holat:** amalga oshirildi — `emal` branch'i (2026-09-18), commit va deploy kutmoqda.
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

## 3. Qo'shimcha — «Medallar tasnifi» lentasi (mijoz, 2026-09-18, o'sha kuni)

> «medallar tasnifi pastda aylanib turishi kerak … TV da ko'rinadi»

- `MedalTasnif` — taxtaning pastida, kredit bilan BIR satrda (`.tv-foot`): 14 medal, `MEDAL_ORDER`
  tartibida, har biri belgi + nom + qoida; uch guruh bir martadan nomlanadi («Oliy mukofot» — to'liq
  metall disk, «Nodir» — oltin halqa, «Kundalik» — po'lat halqa).
- Mexanizm rekord devoriniki: ikki nusxa, bir nusxa kengligida siljish, tezlik PIKSELDA (38 px/s),
  kursor ostida pauza, `prefers-reduced-motion` da qo'lda suriladigan lenta.
- Qoidalar motordan (`sellerMedals.ts`) qo'lda ko'chirilgan — qatlam qoidasi importni taqiqlaydi;
  `tests/features/medalTasnif.test.tsx` ularni motor konstantalari bilan solishtiradi.
- Narxi: 1920×1080 da ikki ro'yxatdan 24 px (38 px lenta, 14 px kredit o'rnida). Lokal bazada ikki
  sotuvchi bor — to'liq taxtada butun qatorlar soni O'LCHANMAGAN, hisoblangan.
- Mock'da yo'q bitta ikonka qo'shildi: `flag` (🏁 «Podium hali boʻsh» — muzlatilgan sahifada podium
  to'la edi, emoji sahifaga chiqmagan).
- Daraja tizimi QAYTMADI: bu medal kaliti, sotuvchi darajasi emas; `sellersMedals.test.tsx` dagi
  daraja qo'riqchisi o'zgarmagan.

## 4. Chetlanishlar (deploy oldi tekshiruvi, 2026-09-18)

Besh mustaqil ko'rib chiquvchi + har topilmaga skeptik; tasdiqlanganlari tuzatildi:

- **O'lik taxalluslar olib tashlandi:** `--bi-crown`, `--bi-crown-lo` (IMPLEMENT.md §2 da bor, hech narsa
  o'qimaydi). `medalDefs.test.ts` endi `--bi-*` oilasining HAR nomi `var()` bilan o'qilishini talab qiladi.
- **SAYQAL 3c dagi `"case"` tashlandi:** yuborilayotgan Inter subsetida `case` xususiyati yo'q — qoida hech
  narsa chizmasdi (sarlavha skrinshoti u bilan va usiz bayt-bayt bir xil).
- **Bezel qoidasidagi `:has(.podium-name…)` selektorlari tashlandi** — `.podium-name` ni hech narsa chizmaydi.
- **Lenta pauzasi faqat `:hover`** — ichida fokuslanadigan narsa yo'q, `:focus-within` hech qachon ishlamasdi.
- **Lenta `role="group"`** — nomlangan `div` (generic) nomini ARIA 1.2 taqiqlaydi.
- **1366×768 da lenta yashirilmadi** (taklif qilingan edi): TV 720p bo'lishi mumkin, mijoz kalitni TV'da
  so'ragan. Narxi CLAUDE.md da yozilgan.
- **Taxtaning eski o'lik CSS i** (PODIUM bloki, banner podiumdan qolgan) va SAYQAL doim yutadigan asos
  e'lonlari o'chirildi; hisoblangan uslublar 6 holatda bir xil.

