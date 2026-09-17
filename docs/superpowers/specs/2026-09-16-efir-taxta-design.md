# EFIR — «Sotuvchilar reytingi» televizor taxtasining qayta dizayni

**Sana:** 2026-09-16 (kechqurun). **Holat:** BEKOR — 2026-09-17-klassik-taxta-medallar-design.md bilan almashtirildi.
**Oldingi spec:** `2026-09-16-daraja-va-medallar-design.md` — MOTOR, DTO va API qismi (§1 Daraja, §2 Medallar ro‘yxati va ochilish, §4 Uzatish, §5 Motor) o‘z kuchida qoladi; uning VIZUAL qismi (§2 ko‘rinish, §3 Ekran, §6 fayl xaritasi) shu hujjat bilan ALMASHTIRILADI.
**Aktivlar:** `docs/superpowers/specs/assets/2026-09-16-efir/efir.html` (qorong‘i, asosiy) va `efir-light.html` (yorug‘) — haqiqiy 16-sentabr ma’lumoti bilan 1920×1080 to‘liq sahifa mocki; `gen_efir.py` generatori. Mock — o‘lchamlar, kompozitsiya va SVG belgilar uchun BIRLAMCHI manba; matn ziddiyatlarida shu hujjat ustun.

## Nega

Ikki dizayn ketma-ket rad etildi: ertalabki «pagon» strip (emoji + ball) — arzon; kunduzgi «lavha-pagon + lentali medal» — «umuman yoqmadi, juda yomon ko‘rinayapti». Ikkinchisi production'da 2026-09-16 17:16 dan beri jonli. Beshta mustaqil tanqid (TV o‘qilishi, premium did, motivatsiya, axborot arxitekturasi, rang/material) bir xulosaga keldi:

- O‘rindiq — yettita bir-biriga bo‘ysunmaydigan blok; eng kontrastli obyekt (qora lavha) eng kam ma’lumot tashiydi.
- Ro‘yxatda 100 ta bir xil qora to‘rtburchak — «daraja» soni bilan (1–3 yulduz) kodlangan, bu 3 metrdan farqlanmaydi.
- Bir sahifada beshta vizual til (podium xromi, qora/oq/ko‘k lavhalar, olti rangli medal disklari, ko‘k shtamplar, shtrixli sharpa, pushti/yashil ustun bo‘yoqlari).
- Qator matni televizor bo‘sag‘asidan past (ism 15 px, ikkinchi qator 11 px); ro‘yxatning 4-qatori sticky sarlavha ostida yashirin.
- Sahifada bitta «qahramon» g‘oya yo‘q.

Uchta to‘liq sahifa konsepsiyasi (EFIR / SHARAF DEVORI / ARENA) mock qilinib, mijozning vakili **EFIR** ni tanladi.

## G‘oya (thesis)

Sahifa — qorong‘i sahnadagi jonli efir «timing tower»i. Har sotuvchi BITTA qator: rank · daraja rangidagi chekka tasma + olti chevronli **pagon-gerb** (›››) · 24 px ism · 24 px pul. Top-3 — o‘sha qatorning 3× kattasi, rank raqami atrofida metall halqa. Bitta aksent (daraja = muz-ko‘k yorug‘lik shkalasi), bitta metall (oltin: halqalar, medallar, rekord yorliqlari), bitta shrift (Inter) uch o‘lchamda. Boshqa hech narsaga rang berilmaydi.

## Chegara

**Qoladi (o‘zgarmaydi):** `sellerMedals.ts` motori, `SellerMedalRowDto`/`SellerMedalsDto`, `?include=medals`, 10 daqiqalik kesh, `usePromotions` (ikki tetik), `useAutoScroll`, FAKT 1/FAKT 2 kaliti va `rankedBy` oynasi, davr boshqaruvi, rekordlar ma’lumoti, telefon uchun `.tv-switch`, `PageShell`.
**Ketadi:** `Lavha.tsx`, `Medal.tsx` (lentali disk), `LevelBlock.tsx` (shtamplar, sharpa), `MedalRail.tsx`, `SpeakingMedal.tsx` + `useMedalRotation.ts` (gapiruvchi karta), `Narvon.tsx` (strip), podium kartalarining pedestal/bevel/chrome bezaklari, komandalar podiumi, qatordagi `Chase` («Oldingiga +…» satri), ustunlarning pushti/yashil bo‘yog‘i (`--tv-tone`), `.pagon-note`/`lavha`/`medal` CSS bo‘limlari, `medalDefs.ts` (yangi aktivdan qayta generatsiya).
**Bu spec'da yo‘q:** motorni, ostonalarni, medal ro‘yxatini o‘zgartirish; yangi endpoint; jadval ustuni qo‘shish.

## §1 Sahna — tokenlar va shkala

- **Sirtlar** mavjud tokenlarga: sahna = `--page`, ustun = `--surface`, o‘rindiq = `--surface-raised`, chiziqlar = `--border` / `--border-strong`, siyoh = `--ink-primary` / `--ink-secondary` / `--ink-muted`, bo‘sh yo‘l = `--track`, oltin/kumush/bronza = mavjud `--medal-*`. Pushti/yashil ustun bo‘yog‘i (`--tv-tone`) va ustun ramkalari bu sahifada o‘chadi.
- **Yangi ORDINAL oila `--tier-1` … `--tier-6`** (faqat daraja; hech qachon seriya/holat rangi emas; `--medal-*` bilan aralashmaydi), ikkala mavzuda bir xil YORUG‘LIK TARTIBI (Usta har doim Katta sotuvchidan yorug‘roq, qutblanish hech qachon ag‘darilmaydi):
  - qorong‘i: `#3f4a5c · #506480 · #3e8fc4 · #7fd0ff · #bde8ff · #f2fbff`
  - yorug‘: `#3a4557 · #4a6085 · #2b86c2 · #2bb1ee · #8ed3f5 · #c9ecff`
  - komponentlar faqat `--tier` ni o‘qiydi; `[data-tier="4"] { --tier: var(--tier-4) }` (0…6). 0-daraja: `--tier` = `--border-strong` (faqat kontur).
  - `globals.css` ning uchala token blokida (yorug‘, `prefers-color-scheme: dark`, `[data-theme="dark"]`) e’lon qilinadi; hujjatlashtirish `--seq` uslubida.
- **Shrift shkalasi** (1920 da): `--tv-xl` 44 · `--tv-l` 24 · `--tv-m` 16 · `--tv-s` 13; 1366 da 36 / 20 / 14 / 12; `font-feature-settings: "tnum"` raqamlarda. Mavjud `--tv-name/--tv-money/--tv-small/--tv-seat-*` clamplari shu to‘rttasi bilan almashtiriladi (boshqa sahifalar ularni o‘qimaydi — tekshiriladi).
- **Pul grammatikasi:** butun sahifada bitta formatlovchi — to‘liq so‘m, guruhlar orasida U+202F (`79 600 000`), birlik raqam yonida yozilmaydi (faqat ustun yorlig‘ida «FAKT 2, yetkazilgan»); foiz — vergul va U+202F % (`91,3 %`). «mln»/«MLN»/«so‘m» aralashmalari sahifadan ketadi; o‘rindiq jumlasi ham to‘liq so‘m: «Ustozga 127 010 000 qoldi». **YAGONA ISTISNO — LEGENDA KALITI** (§2): u o‘lchov emas, izoh, va bir qatorga sig‘ishi kerak — to‘liq so‘m bilan kalit ~1154 px so‘rardi, ilovaning ustunida esa (nav reyki va qobiq to‘ldirmasidan keyin, 1920 da) 1053 px bor, ya’ni narvon cho‘qqisi ikkinchi qatorga tushardi. Shuning uchun kalitda — va faqat kalitda — qisqa yorliq: «10 mln» … «1 mlrd». Hech bir MA’LUMOT raqami (o‘rindiq, qator, jumla, e’lon, rekord devori) qisqartirilmaydi.

## §2 Daraja belgilari — tasma va gerb

- **Tasma:** har qator va har o‘rindiqning chap chetida 10 px to‘liq balandlikdagi `--tier` rangli tasma. 3 metrdan ro‘yxat rang bo‘yicha saralangan umurtqa bo‘lib o‘qiladi. 0-daraja — 1 px kontur.
- **Gerb («pagon»):** `viewBox 0 -1 66 22`, olti o‘ngga qaragan chevron (`<path id="ch" d="M0 0H7L12 10L7 20H0L5 10Z"/>` ×6, x = 0/11/22/33/44/55); `0…level−1` katakchalar `--tier`, qolganlari `--track`. O‘lchamlar: qator 60×20, o‘rindiq 78×26, legenda 42×14 (1366: 48×16 / 62×21). Legenda oltinchi katakcha ustida kichik oltin toj. Soni qat’iy monoton 1…6, yorug‘lik u bilan o‘sadi.
- **So‘z bir marta:** daraja so‘zi («Usta») faqat O‘RINDIQDA, gerb yonida, `--tier` rangida 16 px semibold. Qatorlarda so‘z yo‘q (tasma + gerb). Aria: gerb `aria-label="4-daraja · Usta"`.
- **Legenda:** sotuvchilar ustunining pastida 28 px qator — olti gerb + so‘z + qisqa ostona 13 px, BIR QATORDA. Sarlavha YO‘Q («DARAJA» so‘zi ~80 px yer olardi va gerblarning o‘zi kalit ekanini aytadi — mock ham sarlavhasiz chizadi). Yangi pog‘onasi YORLIQSIZ: uning ostonasi «birinchi so‘m», ya’ni yoziladigan son yo‘q. Qolgan beshtasi qisqa: «10 mln», «30 mln», «100 mln», «300 mln», «1 mlrd» — §1 dagi to‘liq-so‘m qoidasidan yagona istisno, sababi o‘sha yerda. Yagona kalit; hamma ma’lumot elementidan kichik va yengil; podium bilan ro‘yxat ORASIDA hech qachon emas. Tor ustunda (yon panel ochiq 1366) `flex-wrap` bilan o‘raladi — kesilgan bir qatordan ikki o‘qiladigan qator yaxshiroq.

## §3 Medallar — bitta metall, gravyura

- 14 kod, faqat-fill SVG, 24 birlik quti; belgilar mock `<defs>` dagi `#m-*` (oy oilasi = lenta + disk + o‘yma 1/2/3 raqami; year-champion = toj; streak-fire = alanga; streak-steady = uch o‘sayotgan ustun; day-record = chaqmoq; day-winner = ufqdagi yarim quyosh; conversion-master = nishon; clean-month = belgili qalqon; jump = yuqoriga strelka; rookie = yulduz; first-sale = nihol; work-month = taqvim). Kesib olishlar (`class="cut"`) sirt rangida — gravyura, ikkinchi rang emas.
- **Metall:** Oy oilasi diski O‘Z metallida — `--medal-gold` / `--medal-silver` / `--medal-bronze` (mijoz «eng chiroyli medallar» dedi — kumush kumushdek ko‘rinsin); qolgan 11 kod `--medal-gold`. Boshqa hech qanday rang emas; `--series-*` medallarda taqiqlangan.
- **Qator:** eng ko‘pi 3 ta, `MEDAL_ORDER` bo‘yicha (eng nodir avval), 24 px, ×N yo‘q, ortiqchasi «+N» 13 px. `first-sale` qatorda hech qachon chizilmaydi (100 dan 92 tasida bor — hammada bor nishon nishon emas). Qatorda SOYA YO‘Q — nodir yettilik ham tekis chiziladi: 100 qator × 3 medal har biriga alohida `filter` qatlamini ochardi, 3 metrdan ko‘rinmaydigan soya uchun.
- **O‘rindiq:** to‘liq to‘plam 24 px, ×N (16 px semibold). Nodir yettilik (oy oilasi, year-champion, day-record, conversion-master, streak-fire) faqat qorong‘ida yumshoq oltin soya bilan — va faqat O‘RINDIQDA (CSS: `.seat .medal.rare`).
- Belgilar sahifaga bir marta `MedalDefs` orqali (`#ch` ham shu yerda).

## §4 O‘rindiq (podium karta)

2-1-3 tartibida uchta ko‘tarilgan karta, pastlari tekislangan; o‘rindiq 1 — 456×259, o‘rindiq 2/3 — 308×255 (1366: 0.8×); radius 10; pedestal, bevel, xrom, sharpa, shtamp, hikoya kartasi YO‘Q. Chap chetida 10 px `--tier` tasma. Yuqoridan pastga:

1. **Halqa qatori:** rank raqami podium metallidagi halqada (o‘rindiq 1: 80 px halqa, 44 px raqam; 2/3: 64 px, 32 px; 3 px halqa + 8 px xira tashqi halqa). Yonida ism ikki qatorda (24 px / 22 px semibold): `tokens[0]` / qolgani, birinchi token raqam bo‘lsa `tokens[0..1]` / qolgani («268 Ozoda Yuldosheva» → «268 Ozoda» / «Yuldosheva»). Ostida: komanda (16 px muted) · gerb 78×26 · daraja so‘zi (`--tier`, 16 px semibold).
2. **Raqam:** FAKT 2 (ranglangan fakt) 44 px bold tabular; ostida bir qator: chapda «FAKT 2» 13 px muted, o‘ngda «FAKT 1 103 200 000» 16 px. (FAKT 1 rejimida aksincha.)
3. **Progress:** 10 px yo‘l, to‘liq ichki kenglik, `clamp((delivered − levelFloor)/(nextAt − levelFloor), 0.03, 1)` `--tier` bilan; ostida yagona jumla «Ustozga 127 010 000 qoldi» 16 px. 0-daraja: bo‘sh gerb, kontur tasma, bo‘sh yo‘l, «Birinchi savdo kutilmoqda». Legenda: `nextTitle` «Legenda II».
4. **Medal qatori** (§3).

Buyurtma soni va konversiya o‘rindiqda YO‘Q (qatorda bor). Medal xaritasida bo‘lmagan sotuvchi (yuklanish holati) 1–4 ni chizmaydi, faqat halqa/ism/raqam.

## §5 Qator (ro‘yxat)

- Balandlik 50 px (1366: 44); grid `10 | 52 | 70 | 1fr | 84 | 160 | 146 | 60 | 68` + 16 px o‘ng padding; bitta baseline: tasma · rank 24 px semibold · gerb 60×20 · ism 24 px semibold (ellipsis) + komanda 16 px muted 12 px keyin · medallar (≤3 × 24 px, 6 px oraliq, «+N») · FAKT 2 24 px bold tabular · FAKT 1 16 px secondary · buyurtma 16 px muted · konv. 16 px muted.
- 1 px chiziqlar. Ustun yorliqlari («#  Daraja  Sotuvchi  Medallar  FAKT 2, yetkazilgan  FAKT 1, tasdiqlangan  Buyurtma  Konv.») 24 px statik qatorda, siljiydigan quti TASHQARISIDA — 4-rank hech qachon yashirinmaydi. 1080 da podium ostida 12 to‘liq qator (4–15) ko‘rinadi.
- Qatorda «Oldingiga +…» va «Ustozga … mln» satrlari YO‘Q (bitta qator, bitta baseline). Ism 26 belgidan uzun bo‘lsa ellipsis; avval komanda kesiladi.
- Rank 4 dan boshlanadi (1–3 podiumda), 100 gacha; `useAutoScroll` faqat ro‘yxat qutisida.

## §6 Komandalar ustuni

Podium YO‘Q. 40 px sarlavha («Komandalar  14 komanda» + FAKT kaliti), 24 px statik yorliq qatori, 14 komanda bir qatorli 62 px qatorlar: rank (1–3 oltin/kumush/bronza 24 px bold, qolgani muted) · nom 24 px semibold · sotuvchi soni 16 px muted · FAKT 2 24 px bold · ulush «15,2 %» 16 px muted · FAKT 1 16 px · buyurtma · konv.; har qator pastida 2 px ulush chizig‘i (ulush ÷ yetakchi ulushi, 40 % siyoh). Pastda «7 sotuvchi komandasiz, ulushlar ularsiz» 13 px. Sotuvchilar ro‘yxati bilan bir xil lug‘at; plastina, chip, qizil delta yo‘q.

## §7 Sarlavha va rekordlar

62 px sahifa sarlavhasi: «Sotuvchilar reytingi» 24 px semibold + «1–16 sen 2026» 16 px muted; markazda rekord devori IKKI STATIK band (chiziq bilan ajratilgan): «Sentabr yetakchisi» (oltin 13 px) + ism + raqam + «57 ta yetkazilgan» · «Avgust 2026 rekordi» + …; o‘ngda Bugun / Kecha / Shu oy / Sana segmentli boshqaruv (faol — siyoh). Sarlavha ~1500 px dan tor bo‘lsa — bitta rekord, 10 s da KESIB almashadi (marquee yo‘q). Ustun sarlavhalarida FAKT 1 | FAKT 2 kaliti — faol segment sahnada siyoh (xromga rang sarflanmaydi). Ustunlar 60 % / 40 % (1112 / 696 @1920).

## §8 Harakat

- **Tinchlikda hech narsa qimirlamaydi:** rekordlar sudralmaydi, o‘rindiqlar/tasma/gerb/medallar statik. Yagona uzluksiz harakat — ro‘yxat drifti (`useAutoScroll`), yorliq qatori uning tashqarisida.
- **Voqea harakati:** ko‘tarilishda (`usePromotions` tetiklari o‘zgarmaydi) yangi olingan chevron 400 ms da bir marta to‘ladi, tasma yangi darajaga 380 ms da o‘tadi (`--ease-out`), o‘rindiqda gerb ham; ustun sarlavhasi USTIDA 8 s `role="status"` e’lon (mavjud overlay mexanizmi) EFIR tilida: tasma + gerb + «Ism — endi USTA · 100 000 000»; yangi medal 0.6 → 1 bir marta; FAKT kaliti mavjud 380 ms qayta saralash. `prefers-reduced-motion` hammasini o‘chiradi. Yaltirash, marquee, pulsatsiya yo‘q.

## §9 Moslashuv

- 1366: shrift 36/20/14/12, qator 44, gerb 48×16 (o‘rindiq 62×21), halqa 56/48, o‘rindiq 0.8×; ikki ustun saqlanadi.
- Telefon (mavjud `.tv-switch`): ustunlar bittadan; qator tasma · rank · gerb · ism · FAKT 2; FAKT 1 / buyurtma / konv. yashirin.
- Ikkala mavzu tokenlardan; televizorda mavzu bir marta qorong‘iga qo‘yiladi (ilova kaliti), sahifa mavzuni majburlamaydi.

## §10 Fayl xaritasi

- **Yangi:** `src/features/sellers/Crest.tsx` (gerb; `level, legendaTier, size: 'row'|'seat'|'legend', animate?`), `Halo.tsx` (rank halqasi; `rank, size`), `MedalMark.tsx` (bitta medal; `code, count?, rare?`), `SeatCard.tsx` (o‘rindiq §4; podium kartasi + eski LevelBlock/MedalRail o‘rniga), `TierLegend.tsx` (§2 legenda), `RowMedals.tsx` (qayta: filtr first-sale, slice 3, +N), `medalDefs.ts` (yangi aktivdan generatsiya: `#ch` + 14 `#m-*`).
- **O‘zgaradi:** `SellersPage.tsx` (o‘rindiq, qator gridi, statik yorliq qatori, komandalar bir qatorli, `Chase` chiqariladi, `rankedBy`/FAKT kaliti qoladi), `RecordWall.tsx` (statik ikki band + tor ekranda kesish), `PromotionBanner.tsx` (EFIR tili), `medalCatalog.ts` (`RARE_MEDALS`, `hiddenInRows: ['first-sale']`, nomlar), `src/lib/format.ts` (`formatSomFull` U+202F, `formatPercentUz`), `globals.css` (LAVHA/MEDAL/DARAJA BLOKI/PAGON qoldiqlari o‘rniga EFIR bo‘limi; podium bezaklari qisqaradi; `--tier-*`; `--tv-*` shkala), testlar.
- **O‘chadi:** `Lavha.tsx`, `Medal.tsx`, `LevelBlock.tsx` (yordamchilari `isNearNextLevel`/`nextLevelSentence` `SeatCard` yoki katalogga ko‘chadi), `MedalRail.tsx`, `SpeakingMedal.tsx`, `Narvon.tsx`, `useMedalRotation.ts` + testi, eski aktivlar papkasi `assets/2026-09-16-daraja/` (spec tarixda qoladi).

## §11 Test

- `lavhaCss` → `efirCss.test.ts`: `--tier-1..6` uchala token blokida; `.tv-row/.seat/.crest/.medal` qoidalarida `--series-*` yo‘q; `--medal-*` faqat `.medal[data-medal="month-*"]` va `.halo` da; `.tv-promo` overlay saqlanadi; `prefers-reduced-motion` bloki.
- `sellersLavha` → `sellersEfir.test.tsx`: gerbning `on` katakchalari soni = daraja; Legenda toji; o‘rindiq ism bo‘linishi (3 shakl); progress clamp; 0-daraja; medal qatori (first-sale yashirin, 3 + «+N», ×N faqat o‘rindiqda); legenda 6 ta.
- `sellersTvBoard`: 4-rank to‘liq ko‘rinadi (yorliq qatori ro‘yxat qutisidan tashqarida), daraja so‘zi o‘rindiqda bir marta va qatorda yo‘q, `Chase` qatorda yo‘q, komandalar podiumsiz va 1–3 metall raqamli, rekord devori statik, FAKT kaliti qayta saralashi (mavjud), 6 ustun sarlavhasi (mavjud), medal so‘rovi mustaqil (mavjud), ko‘tarilish e’loni (mavjud, matn EFIR).
- Jonli: 1920 qorong‘i/yorug‘, 1366, telefon; mock skrinshoti bilan yonma-yon (ko‘z bilan), majburiy ko‘tarilish overlay.

## §12 Ishga tushirish

Gate (verify + build + db:check) → «deploy qil» → push → ~5 daqiqa → **televizor tabini yangilash** → `?include=medals` o‘zgarmagan (motor tegilmagan).

## §13 Xavflar va qarorlar

- Qatorlar so‘zsiz — mijoz «Usta» so‘zini qatorda ham xohlasa, bitta 16 px so‘z ism uyasiga sig‘adi (bir qatorlik o‘zgarish).
- Yangi vs Sotuvchi shkalaning eng xira juftligi — gerb soni (1 vs 2) farqni tashiydi; Ustoz/Legenda yorug‘ mavzuda oqish — 1 px `--tier` kontur qo‘shish mumkin.
- Qatorda `first-sale` yo‘q va ×N yo‘q — faqat «Birinchi savdo»si bor sotuvchining medal uyasi bo‘sh (ataylab).
- «Oldingiga +…» (F1 farqi) va ikkinchi o‘rin farqi qatordan ketdi — mijoz sog‘insa, 1366 kengaytma satri yoki o‘rindiq jumlasining qo‘shnisi sifatida qaytadi.
- Komandalar podiumi ketdi — rank 1–3 metall raqam bilan; mijoz podiumni xohlasa, sotuvchilar o‘rindig‘ining kichik nusxasi.
- `--tier-4` (`#7fd0ff`) qorong‘ida `--seq-550` ga yaqin — oila ORDINAL deb hujjatlashtiriladi.
- Ism bo‘linishi «Familiya Raqam Ism» / «Raqam Ism Familiya» shakllariga mo‘ljallangan; boshqa shakllar `tokens[0]` / qolgani.
- Deploy'da har sotuvchi ko‘rgan taxta butunlay boshqacha bo‘ladi — kunning uchinchi ko‘rinishi; mijozga «bu yakuniy dizayn» deb bir marta aytiladi.
