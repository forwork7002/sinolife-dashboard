# Daraja va medallar — lavha-pagon, puldan daraja, kuchli tomon uchun medal

**Sana:** 2026-09-16
**Ekran:** `/sellers` — Sotuvchilar reytingi
**Holat:** BEKOR — 2026-09-17-klassik-taxta-medallar-design.md bilan almashtirildi. (Avval: deploy qilingan 2026-09-16 17:16, `1d38148`, `main`.)
**Ko‘rinishi O‘RNI BOSILDI:** o‘sha kuni kechqurun mijoz lavha-pagonni rad etdi va
`docs/superpowers/specs/2026-09-16-efir-taxta-design.md` (EFIR taxtasi) butun
ko‘rinishni qayta chizdi. Bu hujjatning §2 dagi KO‘RINISH qismi (lavha, lentali
medal, belgilar), butun §3 «Ekran» va §6 «Frontend» endi EFIR speci bilan
almashtirilgan — o‘sha hujjat ustun. KUCHDA QOLGANI: §1 «Daraja» (ostona narvoni
10 mln … 1 mlrd, Legenda bosqichlari), §2 dagi medal QOIDALARI (14 kod, qachon
beriladi), §4 «Uzatish» (DTO), §5 «Motor» va §7 «Test» — EFIR ularning hech
biriga tegmadi, faqat chizilishini o‘zgartirdi.
**O'rnini bosadi:** `2026-09-15-sotuvchilar-medallari-design.md` ning
«Ball», «Daraja» va butun «3. Ekran» bo'limlari. O'sha spec'ning
«1. Ma'lumot» bo'limi (manba, oyna, davr filtri) va medal QOIDALARI
o'z kuchida qoladi.
**Tasdiqlangan chizma:** `assets/2026-09-16-daraja/canvas.html` — production
raqamlari bilan to'liq maket; SVG belgilar to'plami o'sha papkada
(`lavha-defs.html`, `lavha.css`, `medal-defs.html`, `medal.css`).

---

## Nega

Birinchi dizayn 2026-09-16 ertalab production'ga chiqdi (`586ec40`) va o'sha
kuni mijoz uni rad etdi: «umuman medallar korinishi joylashuvi umuman
yoqmadi… har bir sotuvchi o'z level ni bilib tushunib yetsin eng keraklisi
shu… menga eng chiroyli medallar kerak… pagon dek medallar bo'lsin bir biriga
mos». Emoji chip va ingichka ball chizig'i arzon ko'rindi, daraja esa ballardan
hisoblanib, uzoqdan o'qilmas edi.

Mijozning yangi qoidalari:

1. **Daraja puldan beriladi** — «sotuvchilar ishlab topgan puliga qarab level
   beriladi». 2026-avgustdan beri yetkazilgan jami FAKT 2. Faqat ko'tariladi.
2. **Medallar kuchli tomonlar uchun** — «3 oy ketma-ket eng zo'r natija
   ko'rsatganga bir chiroyli medal… o'z qatori, profilida ko'rinib turadi».
3. **«Men qaysi leveldaman» degan savolga javob** — televizordan, sichqonchasiz.
4. **Daraja oshgani sari medal olish osonlashadi** — har daraja yangi medal
   turlarini ochadi (mijoz shu o'qishni «davom et» bilan tasdiqladi).

Uch mustaqil dizayner uch konsept chizdi (pagon / liga / sharaf taxtasi), uch
hakam bir xil mezonda baholadi; g'olib — sharaf taxtasi lavhasi, unga pagon
uchi (Parad'dan) va lentali metall medallar, keyingi lavha sharpasi, e'lon
(Peshtoq'dan) payvand qilindi. Aktivlar ikki raundda yasaldi va qayta
baholandi. Mijoz maketni ko'rib tasdiqladi.

## Chegara

**Tegiladi:** `sellerMedals.ts` (daraja formulasi, ball olib tashlanadi, klub
olib tashlanadi, ochilish filtri, `promotedOn`), `sellerBoardService.ts`
(DTO), `src/lib/api.ts` (DTO nusxasi), `docs/API.md`, `Pagon.tsx` (butunlay
almashadi), `SellersPage.tsx` (seat kartasi bloki, jadval ism katakchasi,
podium ostida narvon, ustun sarlavhasidagi e'lon), `globals.css` (PAGON
bo'limi o'rniga LAVHA va MEDAL bo'limlari, rang shartnomasiga bitta istisno).

**Tegilmaydi:** `insightsRepository.ts` (`sellerMedalFacts` va SQL aynan
qoladi), `RecordWall`, `useAutoScroll`, `useMedalRotation` (imzosi qoladi),
FAKT 1 / FAKT 2 tugmalari, davr filtri, komandalar ustuni, jadval ustunlari
soni, `/confirmation`.

**Ishlab turgan taxta:** eski pagon production'da. Bu ish uni **almashtiradi**
— bitta deploy'da: eski ball-darajasi va yangi pul-darajasi bir ekranda hech
qachon birga ko'rinmaydi.

---

## 1. Daraja

### Narvon

Ostona — 2026-avgustdan beri yetkazilgan jami FAKT 2 (`deliveredMinor`
yig'indisi, joriy oy ham kiradi). Raqamlar aytib yuriladigan: «yuz million —
Usta», «bir milliard — Legenda».

| Daraja | Unvon | Ostona | Lavha | Yulduz | Bugun (2026-09-16) |
|---|---|---|---|---|---|
| 0 | — (hali savdosiz) | 0 so'm | shtrix kontur | — | 5 |
| 1 | Yangi | birinchi so'm (> 0) | oddiy | 1 | 35 |
| 2 | Sotuvchi | 10 mln | oddiy | 2 | 25 |
| 3 | Katta sotuvchi | 30 mln | oddiy | 3 | 47 |
| 4 | Usta | 100 mln | faxriy (ag'darilgan) | 1 | 14 |
| 5 | Ustoz | 300 mln | faxriy | 2 | 0 |
| 6 | Legenda | 1 000 mln | ko'k (apex) | 1 katta | 0 |

Legenda har keyingi 1 000 mln da **Legenda II, III …** — unvonga rim raqami
qo'shiladi, lavha o'zgarmaydi; narvon hech qachon tugamaydi. 5 va 6
bugun bo'sh — ataylab: intilish uchun. Eng yaxshi sotuvchi (173 mln) Ustoz'ga
~2 oyda, Legenda'ga ~2027 bahorida chiqadi.

**Daraja faqat ko'tariladi** — formula jami puldan bo'lgani uchun o'z-o'zidan;
API hech qanday pasayishni uzatmaydi.

**Daraja — o'rin emas.** O'rin — bu davrdagi pul; daraja — avgustdan beri
to'plangan pul. 8-o'rindagi Usta bo'lishi mumkin. Narvon chizig'i (pastda)
buni ekranga yozadi.

**Kalibrlash:** production'da 126 sotuvchi ustida o'lchangan
(`money-ladder-probe.mts`, 2026-09-16): jami yetkazilgan pul p50 30,8 mln,
p75 61,4 mln, p90 102 mln, max 173 mln; to'liq oyda mediana 18 mln. Ostona
shu taqsimotdan tanlangan va **qotirildi** — ishga tushgandan keyin ko'tarish
yo'q (pasaytirish mumkin).

### Lavha-pagon

Bitta siluet: o'ng uchi o'tkir pagon (uch balandlikning yarmida), chap
burchaklari qirqilgan (balandlikning 16%). Uch sinf, yulduz soni sinf ichida:

- **Oddiy** (1–3): `--surface-sunken` maydon, 2 px `--border-strong` rom,
  `--ink-primary` yulduz va yozuv.
- **Faxriy** (4–5): `--ink-primary` maydon, romsiz, `--surface-raised` yulduz
  va yozuv. Qorong'i mavzuda bu fil suyagi rangli lavha — ataylab; nusxada
  hech qachon «qora karta» deyilmaydi.
- **Apex** (6): `--series-1` maydon (ko'k; `--accent` EMAS — `PageShell` uni
  sahifaga qarab qayta belgilaydi, /sellers da `--series-5`), ichki o'yma rom
  (1,5 px, 60% oq), `--ink-on-series` katta yulduz.
- **0-daraja:** shtrix kontur (`--ink-muted`, 4 3), yulduzsiz — jim, ogohlantirish
  emas.
- **Sharpa** (keyingi lavha): shu sinfning shtrix konturi, yulduzlari
  `--ink-muted`.

Yulduz — sakkiz qirrali xatam (ichki radius 0,58 R, o'tkir uchli). Lavha
**hech qachon** `--medal-*` ishlatmaydi; hech bir medal yulduz ko'tarmaydi —
yulduz faqat darajaniki.

O'lchamlar (piksel, `--tv-*` clamp'laridan MUSTAQIL — 4K DPR 1 da yarimlanib
ketmasin): qator 78×26 (yulduzlar 16 px, yozuvsiz — unvon so'zi yonida HTML),
narvon 102×34, sharpa 120×40, seat 280×88 ikki qavatli (28 px yulduz bandi +
20 px o'yma sarlavha, harf oralig'i 2,4 px, `text-anchor: middle`; Legenda
yulduzi 36 px). Seat lavhasi karta kengligiga qarab `width: 100%; max-width:
280px` bilan kichrayadi.

Geometriya va CSS — `assets/2026-09-16-daraja/lavha-defs.html` va `lavha.css`,
ranglar faqat `var(--…)`.

### promotedOn

Har sotuvchi uchun **joriy darajaga chiqqan kun** (`YYYY-MM-DD`, mintaqaviy):
kunlik faktlar ustidan yig'ma FAKT 2 birinchi marta shu daraja ostonasidan
oshgan kun. 0-darajada `null`. Bu ko'tarilish marosimi va e'lon uchun yagona
manba — brauzer xotirasi emas, hosila fakt.

---

## 2. Medallar

### Ro'yxat va ochilish

Qoidalar 2026-09-15 spec'idagidek (o'sha jadvalning «Qoida» ustuni). **Ball
ustuni yo'q — ball tizimi butunlay olib tashlanadi.** `club` **olib
tashlanadi** — uning ishi endi lavhaniki; bir fakt ikki grammatikada
ko'rsatilmaydi.

| Kod | Nom | Oila | Belgi | Ochiladi |
|---|---|---|---|---|
| `first-sale` | Birinchi savdo | O'sish | nihol | 1 · Yangi |
| `work-month` | Ishchan oy | O'sish | 3×3 kalendar | 1 · Yangi |
| `day-winner` | Kun g'olibi | Kun | quyosh | 1 · Yangi |
| `rookie` | Yangi yulduz | O'sish | raketa | 1 · Yangi |
| `clean-month` | Toza oy | Sifat | galochka | 2 · Sotuvchi |
| `jump` | Sakrash | O'sish | ko'tariluvchi strelka | 2 · Sotuvchi |
| `day-record` | Kun rekordi | Kun | chaqmoq | 2 · Sotuvchi |
| `month-bronze` | Bronza oy | Oy | o'yilgan 3 | 2 · Sotuvchi |
| `month-silver` | Kumush oy | Oy | o'yilgan 2 | 2 · Sotuvchi |
| `month-gold` | Oy chempioni | Oy | o'yilgan 1 | 2 · Sotuvchi |
| `conversion-master` | Konversiya ustasi | Sifat | nishon | 3 · Katta sotuvchi |
| `streak-steady` | Barqaror | Seriya | uch pog'ona | 3 · Katta sotuvchi |
| `streak-fire` | Olov seriyasi | Seriya | olov | 4 · Usta |
| `year-champion` | Yil chempioni | Oy | o'yilgan toj + lavr | 5 · Ustoz |

**Ochilish filtri:** motor medallarni avvalgidek hisoblaydi, so'ng
`unlockLevel <= level` bo'lmaganlarini **uzatmaydi**. Daraja faqat
ko'tarilgani uchun bir marta ko'ringan medal yo'qolmaydi. Eshiklar hikoya,
jazo emas: oy chempioni oy oxirida baribir 10 mln dan oshgan bo'ladi;
eshik faqat yuqori medallarda (Olov seriyasi, Yil chempioni) sezildi.

Ochilmagan medal qatorda va seat'da ko'rinmaydi; katalog (qaysi darajada nima
ochiladi) frontend'da statik lug'at — `MEDALS` nomlari kabi.

**Tartib** (seat'da 5 + N, qatorda 3 + N):
year-champion › month-gold › streak-fire › month-silver › month-bronze ›
streak-steady › conversion-master › day-record › clean-month › jump › rookie ›
day-winner › work-month › first-sale. Oila ichida eng oxirgisi oldin.

### Ko'rinish

Bitta planshet: dumaloq disk (r 13 / 32×40 katak) + qisqa **tishli lenta**
(`M7 0 H25 V12 L16 7 L7 12 Z`), disk bilan lenta orasida 2 px
`--surface-raised` halqa (fimbriatsiya). Oila — rang, medal — belgi
(`--ink-on-series`, 24-katakda ≥ 2,4 birlik qalinlik):

- **Oy** — metall maydon va lenta: `--medal-gold` / `--medal-silver` /
  `--medal-bronze`; raqam/toj `color-mix(in oklab, metall 35%, black)` bilan
  o'yilgan; Yil chempioni atrofida nuqtali lavr (seat va gapiruvchi
  o'lchamda; qatorda oddiy ingichka halqa).
- **Seriya** — `--series-2` (to'q sariq). **Kun** — `--series-7` (binafsha).
  **Sifat** — `--series-3` (ko'k-yashil). **O'sish** — `--series-6` (yashil).
- Hech qachon: `--series-1` (apex lavhaniki), `--series-5` (ustunning o'z rangi),
  `--series-8` (qizil — qatorda ogohlantirish bo'lib o'qiladi).
- Seat va gapiruvchi o'lchamda barcha disklarda bir xil yo'nalishli yaltirash
  (bir marta `<defs>` da e'lon qilingan `linearGradient`, uch `color-mix`
  to'xtashi); qatorda tekis.
- **Qulflangan** (faqat katalogda): shtrix kontur `--ink-muted`.
- **×N** — HTML pill (`--ink-primary` ustida `--surface-raised` raqam), disk
  ustida yuqori-o'ng; **qatorda ko'rsatilmaydi** (o'qilish chegarasida),
  seat va gapiruvchi kartada bor.

O'lchamlar: qator 33 px (23 px disk, lenta bilan), seat 44 px, gapiruvchi
64 px. Geometriya — `assets/2026-09-16-daraja/medal-defs.html` va `medal.css`.

**Qolgan sayqal** (hakamlarning 2-raund izohlari, amalga oshirishda
bajariladi): Kun g'olibi quyoshi tojdan aniq farqlansin (yarim disk gorizontda,
5 nur); Birinchi savdo niholi «Y» bo'lib o'qilmasin (semiz barglar); Sakrash
va Yangi yulduz 3 m dan bir xil diagonal bo'lmasin (raketa tik tursin).

---

## 3. Ekran

### Narvon — podium ostidagi doimiy legenda

Podium bilan jadval orasida, sotuvchilar ustunida: 6 ta narvon-o'lchamli
lavha, ostida unvon (`--ink-primary`, 12 px 700) va ostona (`--ink-secondary`,
«birinchi so'm», «10 mln»…). Statik, hech qachon animatsiya qilinmaydi.
Fon `--surface-sunken` ning 55% aralashmasi, yuqori-pastda `--border`.
1280 px dan pastda 3+3 bo'lib o'raladi. Bu «daraja o'rin emas» jumlasining
o'rnini bosadi — narvon o'zi tushuntiradi; eski `.pagon-note` olib tashlanadi.

### Seat kartasi

Pul raqami va «FAKT 2 · yetkazilgan» satri ostida, yupqa `--border` chiziq
ostida — **daraja bloki**:

```
  ┌ lavha 280×88 (sinf + yulduz + O'YMA UNVON) ┐   [sharpa: keyingi · 300 mln]
  ▰▰▰▰▱▱▱▱▱▱   (10 shtamp: --seq-550 / --track)
  Ustozga 127 mln qoldi          (17–20 px 600, --ink-primary; ≥ 90% da --seq-550)
```

- Sharpa (keyingi lavhaning shtrix konturi + «KEYINGI · 300 MLN») **faqat
  chempion seat'ida** — u kengroq (1,16fr); 2- va 3-o'rinda lavha to'liq
  kenglikda, sharpasiz.
- Shtamp = keyingi ostonagacha yo'lning 10%; uzoqdan sanaladi, foiz emas.
- «… qoldi» matni butun so'm emas, `formatCompactUzs` bilan («139.7 mln», «1.2 mlrd» — ilova o'nlik uchun nuqta ishlatadi).
  Jo'nalish kelishigi: unvon + «ga» («Ustozga», «Legendaga», «Legenda II ga»).
- 0-darajada: shtrix lavha, shtamplar bo'sh, «Birinchi savdo kutilmoqda».

So'ng **medal tokchasi** — `color-mix(--metal 8%, --surface-raised)` fonli
band, 5 tagacha 44 px medal, ×N pill, `+N` toshish. Bo'sh o'rin chizilmaydi;
medalsiz sotuvchida tokcha umuman yo'q — karta qisqaradi.

So'ng **gapiruvchi karta** (bor bo'lsa): `--surface-sunken` fon, 64 px medal,
nom (16 px 700), sabab (12,5 px `--ink-secondary`) — `useMedalRotation`
soati avvalgidek (ustunda bittadan, 6 s). Sabab matni avvalgi
`medalReason` mantig'i: oy/kun, summa, buyurtma, foiz; `work-month` da «24 kun
· davomat 92%».

Eski 3 karrali blok yo'q (allaqachon olib tashlangan); FAKT 1/FAKT 2 kichik
satri qoladi.

### Jadval qatori

Ustun qo'shilmaydi. Ism katakchasi ichida uch qism:

```
 4 │ [lavha 78×26] │ Umidovna 117 Bonu  Usta          │ (m)(m)(m) +1 │ 53 600 000
   │               │ ▁▁▁▁▁▁▁▁ (bar, avvalgidek)        │              │
   │               │ Oldingiga +1.2 mln · Ustozga 173.5 mln │         │
```

- Chapda lavha (yelka), `flex: none`, 12 px oraliq.
- Ism yonida unvon so'zi (`--ink-secondary` 500; 90% dan oshganda
  `--seq-550`); 0-darajada «hali savdosiz».
- `Chase` satri ikkinchi bo'lak oladi: «· Ustozga 173,5 mln» (bir xil tabular
  uslub). Bar va Chase o'z joyida.
- O'ngda 3 ta 33 px medal + `+N` (ko'krak), `flex: none`; 1280 px dan pastda
  (telefon) medallar ism ostiga ikkinchi satrga tushadi, lavha chapda qoladi —
  yon skroll qo'shilmaydi.
- ×N qatorda yo'q.

### Ko'tarilish marosimi

Odatiy holatda **hech narsa qimirlamaydi**. Uch voqea:

1. **Daraja ko'tarilishi** — IKKI TETIK, sahifa sessiyasida bir marta
   (`employeeId:level:legendaTier` in-memory to'plam):
   **(a)** `promotedOn === bugun` bo'lgan sotuvchi — sahifa o'sha kuni
   ochilganda; **(b)** oldingi payload bilan solishtirganda `level`
   (6-darajada `legendaTier`) **oshgan** sotuvchi — `useNewMedals` medal
   kodlarini solishtirgani kabi, sahifa birinchi yuklanganida hech kim
   «ko'tarildi» emas. Ikkinchisi — production'da ishlaydigani: `promotedOn`
   NAVBAT kuni (§5), ya'ni «bugun» bilan deyarli hech qachon teng kelmaydi.
   Taxtada yo'q odamning ko'tarilishi na sarflanadi, na suratga yoziladi —
   u taxtaga chiqqan payloadda e'lon qilinadi.
   Marosim:
   seat'da yulduzlar 80 ms oraliqda tushadi (translateY −14 → 0, 1,15 → 1),
   bitta diagonal yaltirash (0,8 s), so'ng qotadi; jadval qatori animatsiya
   qilinmaydi — e'lon yetarli.
   Ustun sarlavhasi satrida **8 s e'lon**: `[lavha 34 px] {Ism} — endi USTA ·
   100 mln`, so'ng sarlavha qaytadi. E'lon seat'dagi ham, qatordagi ham uchun.
2. **Yangi medal** — oldingi payload bilan farq (ref'da `employeeId:code:count`
   kaliti): yangi medal 400 ms da 0,6 → 1 kattalashib tushadi, bir marta.
   Sahifa birinchi yuklanganida hech narsa «yangi» emas.
3. **Gapiruvchi medal** — avvalgi soat.

`prefers-reduced-motion`: 1 va 2 ning harakati yo'q, e'lon statik chiqadi,
aylanish to'xtaydi (avvalgi qoida).

### Rang shartnomasi

`globals.css:128` shartnomasiga **bitta yozilgan istisno**: `--medal-gold /
silver / bronze` Oy oilasi medallarining maydoni bo'la oladi, chunki ma'nosi
podium o'rindig'i bilan aynan bir xil — «o'sha davrda 1/2/3-o'rin». Boshqa
hech qayerda ma'lumotni kodlamaydi. Lavha metallga tegmaydi; oltin matn yo'q.

Yangi `--lavha-*` va `--m-*` xususiyatlari **komponent ichida** (`.lavha`,
`.medal` bloklarida) e'lon qilinadi, `:root` ga token qo'shilmaydi. Hech qanday
literal hex — mavjud `tests/features/theme.test.ts` naqshi bo'yicha yangi
bloklar tekshiriladi.

`globals.css` da PAGON bo'limi (2570–2749) **butunlay** LAVHA va MEDAL
bo'limlari bilan almashadi, PODIUM va TV BOARD orasida.

### Buzilmaslik

Avvalgidek: medal so'rovi alohida; sekin kelsa seat lavhasiz chiziladi, xato
bersa blok umuman ko'rinmaydi, taxta sezmaydi.

---

## 4. Uzatish

`GET /api/v1/analytics/sellers?include=medals` — o'zgarmaydi. Kesh kaliti
o'zgarmaydi. DTO:

```ts
interface SellerMedalsDto {
  readonly from: string                         // RECORDS_FROM instanti
  readonly sellers: readonly SellerMedalRowDto[]
}

interface SellerMedalRowDto {
  readonly employeeId: string
  readonly level: number            // 0..6
  readonly legendaTier: number      // 0 (6 dan past), 1 = Legenda, 2 = Legenda II …
  readonly rankTitle: string | null // 'Ustoz', 'Legenda II'; 0-darajada null
  readonly delivered: MoneyDto      // avgustdan beri jami FAKT 2
  readonly levelFloor: MoneyDto     // shu darajaning ostonasi (0-da 0)
  readonly nextLevelAt: MoneyDto    // keyingi ostona — HAR DOIM bor
  readonly nextTitle: string        // 'Ustoz', 'Legenda II'
  readonly promotedOn: string | null // 'YYYY-MM-DD'
  readonly medals: readonly SellerMedalDto[]   // faqat ochilganlari, tartibda
}

interface SellerMedalDto {
  readonly code: MedalCode          // 14 ta; 'club' yo'q
  readonly count: number
  readonly at: string | null
  readonly amount: MoneyDto | null
  readonly orders: number | null    // rookie: o'rin; work-month: kunlar
  readonly percent: number | null
}
```

`points`, `tier` yo'q. `docs/API.md` satri yangilanadi.

---

## 5. Motor

`buildSellerMedals(input)` — imzo o'zgarmaydi, chiqish o'zgaradi:

- `levelOf(deliveredMinor: bigint)` — narvon bo'yicha 0..6 va `legendaTier`.
  `LEVEL_THRESHOLDS_MINOR` — 6 ta `bigint` (1 mln = 100 000 000n).
- `titleOf(level, legendaTier)` → 'Legenda II'. `nextTitleOf`, `nextLevelAtOf`.
  Ostonalar `[1n, 10, 30, 100, 300, 1000 mln]` (1-daraja = birinchi so'm, ya'ni
  1 minor birlik); 0-darajada `nextLevelAt` = 1 minor, UI «Birinchi savdo
  kutilmoqda» chizadi. 6-darajada `nextLevelAt` = (legendaTier + 1) × 1000 mln.
- Ball: `POINTS_*`, `MEDAL_POINTS`, `CLUB_RUNGS`, `levelFloorOf(points)` —
  **o'chiriladi**. `SellerMedal.points`, `.tier` — o'chiriladi.
- `MEDAL_CODES` — 14 ta. `MEDAL_UNLOCK_LEVEL: Record<MedalCode, 1..5>`.
- `promotedOn`: kunlik faktlar sotuvchi bo'yicha sanaga saralanib, yig'ma
  FAKT 2 joriy daraja ostonasidan oshgan birinchi kun. Kunlik fakt bo'lmagan
  sotuvchida (oylik bor, kunlik yo'q — nazariy) `null`.

  **`promotedOn` — NAVBAT KUNI, yetkazish kuni emas.** Kunlik faktlarni
  `insightsRepository.sellerMedalFacts` `date_trunc(grain, c.queued_at …)`
  bilan guruhlaydi, ya'ni pul buyurtma NAVBATGA TUSHGAN kunga yoziladi; FAKT 2
  esa bir necha kundan keyin yopiladi. Shuning uchun `promotedOn === bugun`
  production'da deyarli hech qachon rost bo'lmaydi va faqat shu tetikka
  tayangan marosim jim turardi. Sana aniq bo'lishi uchun **yetkazish-kuni
  statement'i** kerak (yetkazilgan pulni bitim yetkazish roliga o'tgan kun —
  `closedAt` — bo'yicha guruhlaydigan ikkinchi kesim) — bu keyingi ish;
  o'shanda «bugun» aynan bugun bo'ladi. Shu paytgacha televizor ko'tarilishni
  §3 ning (b) tetigi bilan, sinx uni ko'rgandan keyin **o'n daqiqa ichida**
  (medal so'rovining o'z soati) aytadi — va hech qachon sahifa qayta
  yuklanganida emas: farq faqat ikki payload orasida ko'rinadi.
- Medal tartibi — yuqoridagi ro'yxat (`MEDAL_ORDER`), ball emas.
- Qolgan hamma qoida, chegaralar (`MEDAL_MIN_ORDERS`, `WORK_MONTH_SHARE`,
  `STREAK_*`, `ROOKIE_*`) va joriy oy/kun istisnolari **aynan qoladi**.

---

## 6. Frontend

`src/features/sellers/`:

- `medalDefs.ts` — `LAVHA_DEFS`, `MEDAL_DEFS` satrlari (aktiv fayllardan
  so'zma-so'z, sharhlarsiz) + `MedalDefs` komponenti: `<svg width=0 height=0
  aria-hidden dangerouslySetInnerHTML>` — statik, ishonchli matn; SellersPage
  bir marta o'rnatadi (126 qatorda takrorlanmaydi — id'lar takrorlansa
  mavzu buziladi).
- `Lavha.tsx` — `<Lavha level legendaTier size={'row'|'narvon'|'ghost'|'seat'}
  ghost? title? animate?>` — `<use>` lar shu spec'dagi koordinatalar bilan.
- `Medal.tsx` — `<Medal code size={'row'|'seat'|'speaking'} count?>`.
- `LevelBlock.tsx` — seat bloki (lavha, sharpa, shtamplar, qoldi).
- `MedalRail.tsx`, `SpeakingMedal.tsx` (sabab matni `medalReason` bilan),
  `Narvon.tsx`, `PromotionBanner.tsx`, `RowMedals.tsx`.
- `medalCatalog.ts` — nomlar, oilalar, ochilish darajasi, tartib (frontend
  nusxasi; `MEDALS` lug'ati shu yerga ko'chadi).
- `Pagon.tsx` **o'chiriladi**; `useMedalRotation.ts` qoladi.

`SellersPage.tsx`: `medalsById` va so'rov avvalgidek; seat'ga `LevelBlock +
MedalRail + SpeakingMedal`; podium ostiga `Narvon`; qator ism katakchasiga
lavha (chap) va `RowMedals` (o'ng), `Chase` ga ikkinchi bo'lak; ustun
sarlavhasiga `PromotionBanner`.

---

## 7. Test

| Test | Nima pinlanadi |
|---|---|
| `tests/domain/sellerMedals.level.test.ts` | Ostonalar aynan (9 999 999 → Sotuvchi emas; 10 mln → Sotuvchi); 0 → 0-daraja; 2 000 mln → Legenda II; `promotedOn` kunlik yig'ma bo'yicha (ikki kunlik seriyada ikkinchi kun); daraja hech qachon `days` bo'lmasa ham 0 dan past emas |
| `tests/domain/sellerMedals.test.ts` | 14 medal qoidasi avvalgidek; `club` yo'q; ochilish filtri (Yangi'da Olov seriyasi uzatilmaydi, Usta'da uzatiladi); tartib `MEDAL_ORDER` bo'yicha |
| `tests/services/sellerMedals.test.ts` | DTO shakli: `delivered/levelFloor/nextLevelAt` MoneyDto, `points` yo'q, `promotedOn` |
| `tests/http/sellersRoute.test.ts` | o'zgarmaydi (include=medals) |
| `tests/features/sellersLavha.test.tsx` (eski `sellersPagon` o'rniga) | seat: lavha + shtamp soni + qoldi matni; sharpa faqat chempionda; 0-daraja; qator: lavha + 3 medal + `+N`; ×N qatorda yo'q; narvon 6 ta; e'lon `promotedOn` bugun bo'lganda va bir marta; reduced-motion |
| `tests/features/theme.test.ts` naqshi | yangi CSS bloklarida literal rang yo'q; `--medal-*` faqat `.medal[data-medal="month-*|year-champion"]` da |
| `tests/features/useMedalRotation.test.ts` | o'zgarmaydi |

Gate: `npm run verify` + `npm run build` + `npm run db:check`.

## 8. Ishga tushirish

1. Motor + domain testlari.
2. Servis DTO + testlar; `api.ts` nusxasi; `docs/API.md`.
3. `medalDefs.ts` + CSS bloklari (aktivlardan) + `Lavha`/`Medal` + DOM testlari.
4. Seat bloki, narvon, qator, e'lon; `Pagon.tsx` o'chirish.
5. Jonli tekshirish: `/sellers` 1920 va 1366 da, yorug' va qorong'i,
   production `?include=medals` bilan taqqoslash.
6. Lokal commit'lar `daraja` branch'ida. `main` ga push faqat «deploy qil».

## 9. Ochiq xavflar

- **Ko'rinadigan daraja o'zgaradi.** Eski ball-narvonida mediana 5-daraja;
  yangi pul-narvonida ko'pchilik 1–3. Bu «tushish» emas, boshqa o'lchov — lekin
  floor buni sezadi. Tez almashtirish va narvon legendasi javob.
- **Usta / Ustoz** so'zi 3 m dan farqlanmaydi — farqni lavha (1 vs 2 yulduz)
  beradi, so'z ikkinchi belgi.
- **`color-mix()`** — Chrome 111+ / Safari 16.2+. Televizor brauzeri
  eskiroq bo'lsa o'yilgan raqam va yaltirash yo'qoladi, medal tekis qoladi
  (buzilmaydi). Deploy'dan keyin televizorda tekshiriladi.
- **Qator kengligi 1280–1599** — 2 + N qoidasi; o'lchab ko'riladi.
- **Belgi sayqali** (quyosh, nihol, raketa) — amalga oshirishda, hakam
  izohlari bo'yicha.
- **`promotedOn` sanasi NAVBAT kunida.** Kunlik faktlar `c.queued_at` bo'yicha
  guruhlanadi, FAKT 2 esa kunlar keyin yopiladi — ya'ni bu sana
  ko'tarilishning haqiqiy kunidan oldinda turadi va `promotedOn === bugun`
  tetigi production'da deyarli hech qachon ishlamaydi. Shuning uchun marosim
  ikkinchi tetikka — payloadlar orasidagi daraja o'sishiga — tayanadi: e'lon
  sinx yetkazishni ko'rgandan keyin o'n daqiqa ichida chiqadi va sahifa qayta
  yuklanganida takrorlanmaydi. «Bugun» ni aniq qiladigan yechim — yetkazilgan
  pulni `closedAt` bo'yicha guruhlaydigan kunlik statement (§5), keyingi ish.
  Shu ishgacha e'londagi «bugun» so'zi ko'tarilish KO'RILGAN kunni bildiradi.
