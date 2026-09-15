# Sotuvchilar medallari — pagon, ball va daraja

**Sana:** 2026-09-15
**Ekran:** `/sellers` — Sotuvchilar reytingi
**Holat:** dizayn tasdiqlangan, reja yozilmagan

---

## Nega

Mijozning so'zi (2026-09-15): «har bir sotuvchimizga motivatsiya bo'lishi uchun
reyting tuzishimiz kerak… medal ko'rinishida bo'ladi… medallar to'planadi,
ballar yoziladi, ballar yozilgani sari level oshadi… huddi Duolingo dagi app
da ko'rgan edim».

Podium allaqachon bor. Yetishmayotgani — **takrorlanadigan sabab**. Bugungi
taxta faqat shu davrning pulini ko'rsatadi, ya'ni uch kishidan boshqa hech kim
uchun unda o'zgaradigan narsa yo'q. Medal va daraja o'tgan mehnatni ekranda
qoldiradi, shuning uchun 4-o'rindagi ham, 87-o'rindagi ham o'zining
to'plangan narsasini ko'radi.

Ikkinchi sabab — mijoz ko'rsatgan aniq nuqson. Seat kartasining pastida bitta
fakt uch marta chizilgan: `Liderga +100 000` chipi, progress chizig'i va `97%`.
Uchalasi «liderdan qancha orqada» degan bitta savolga javob. Ustiga
`0 / 2 buyurtma` yonida turgan `97%` ziddiyatli o'qiladi. Mijozning o'z
ta'rifi: «noaniq keraksiz xolat».

## Chegara

`/sellers` — mijoz 2026-09-11 da «teginilmasin» degan ikki ekrandan biri.
Bu ish o'sha chegarani **mijozning o'z iltimosi bilan** kesib o'tadi, shuning
uchun diff aynan so'ralgan narsa bilan cheklanadi:

**Tegiladi:** seat kartasining pastki bloki, jadval qatoridagi ism katakchasi,
yangi medal so'rovi va uning motori.

**Tegilmaydi:** `RecordWall`, `useAutoScroll`, FAKT 1 / FAKT 2 tugmalari,
komandalar ustuni, jadval ustunlari, `confirmationSellerRecords` va uning
SQL'i, `/confirmation` ning hech qayeri.

---

## 1. Ma'lumot

### Manba

`insightsRepository.ts:recordsSql` allaqachon har sotuvchining har oylik
FAKT 1 / FAKT 2 summasini, buyurtma sonini va o'sha oydagi o'rnini
(`row_number() OVER (PARTITION BY month …)`) hisoblab, oxirida
`WHERE m.place = 1` bilan faqat chempionni qoldiradi. Medal uchun kerak
bo'lgan hamma narsa o'sha hisoblashda bor.

**O'sha so'rov o'zgartirilmaydi.** Yangi metod yoziladi:

```
InsightsRepository.sellerMedalFacts(period, filters)
  → { months: SellerMonthFactRow[], days: SellerDayFactRow[] }
```

Bitta `$queryRawUnsafe`, `queueSql('window', '$3')` kogortasi bir marta
quriladi va undan ikki kesim olinadi: **oy bo'yicha** (`date_trunc('month', …)`)
va **kun bo'yicha** (`date_trunc('day', …)`). Predikatlar `recordsSql` bilan
so'zma-so'z bir xil — `FAKT1_OUTCOMES`, `faktDeliveredSql(ds."logisticsRole")`,
`COALESCE(d."operatorEmployeeId", d."employeeId")` — shuning uchun medal
taxtaning o'zi bilan hech qachon ziddiyatga tushmaydi.

**Nega nusxa emas, alohida metod:** `confirmationRecordsSql.test.ts` o'sha SQL
satrini mixlab qo'ygan, va RecordWall — televizorda ishlab turgan obyekt.
Ikkinchi kogorta qurilishi 10 daqiqalik kesh ostida yiliga bir necha marta
ishlaydi; ishlayotgan taxtani sindirish xavfi undan qimmatroq.

### Oyna

`RECORDS_FROM = '2026-08'` — o'sha oygacha Bitrix bitimga sotuvchini emas,
**joriy mas'ulni** yozgan, va bu portal bitimni ishlov vaqtida back office'ga
ko'chiradi. 2026-07 da «chempion» — Операцион rahbari, 830 660 000 so'm bilan.
Medal ham xuddi RecordWall kabi o'sha chegaradan boshlanadi.

**Buning to'g'ridan-to'g'ri oqibati:** 3 oylik seriya medallari (🔥, ⭐) bugun
hech kimga tushmaydi. Avgust to'liq, sentyabr davom etmoqda — birinchi egasi
**2026-noyabr**da paydo bo'ladi. Ular baribir bugun joriy qilinadi va
qulflangan holda, «2 / 3 oy» progressi bilan ko'rinadi. Yolg'on medal
tarqatilmaydi.

### Davr filtri

**Medal va ball ekranning davr filtriga bo'ysunmaydi.** Ular butun tarixning
fakti. Aks holda «Bugun» tanlanganda hammaning medali yo'qolib, daraja 1 ga
tushib qolardi — ya'ni filtr motivatsiyani o'chirib qo'yadigan tugmaga
aylanardi. RecordWall ham aynan shu sababdan o'z so'rovida yashaydi.

Shundan kelib chiqadigan va **ekranga yozib qo'yiladigan** farq:

> **Daraja — o'rin emas.** O'rin — bu davrdagi pul. Daraja — 2026-avgustdan
> buyon to'plangan mehnat. 8-o'rindagi odam 12-darajada bo'lishi mumkin.

Bu jumla dizaynning bir qismi, izoh emas: aytilmasa, floor uni xato o'qiydi va
taxtaning ishonchi shunga ketadi.

### Uzatish

`GET /api/v1/analytics/sellers?include=medals` — RecordWall'ning
`?include=records` naqshi. Board'ning o'z payload'iga bitta ham maydon
qo'shilmaydi, ya'ni har 60 soniyalik yangilanish og'irlashmaydi. Kesh 10
daqiqa (`staleTime` va `refetchInterval` — ikkalasi ham, chunki
`refetchInterval` staleness'ni hech qachon so'ramaydi).

```ts
interface SellerMedalsDto {
  readonly sellers: readonly SellerMedalRowDto[]
  readonly from: string          // RECORDS_FROM ning birinchi instanti
}

interface SellerMedalRowDto {
  readonly employeeId: string
  readonly points: number        // jami ball
  readonly level: number         // 1 dan boshlab
  readonly rankTitle: string     // «Usta»
  readonly nextLevelAt: number   // keyingi darajaning ball chegarasi
  readonly levelFloor: number    // shu darajaning ball chegarasi
  readonly nextTitle: string | null  // keyingi daraja unvonni almashtirsa
  readonly medals: readonly SellerMedalDto[]   // qiymati bo'yicha kamayib
}

interface SellerMedalDto {
  readonly code: MedalCode       // 'month-gold' | 'streak-fire' | …
  readonly count: number         // takrorlanadiganlar uchun
  readonly points: number        // shu medal(lar) bergan ball
  readonly reason: string        // «Avgust 2026 · 82% · 41 buyurtma»
}
```

Qulflangan medallar (🔥 seriya kabi) **uzatilmaydi** — pagon faqat
erishilganini ko'rsatadi. Qulflangan medalning progressi keyingi bosqichga
qoldiriladi; bugun u ekranni shovqinga to'ldiradi, chunki noyabrgacha hamma
uchun bo'sh.

---

## 2. Motor

`src/server/domain/analytics/sellerMedals.ts` — **sof funksiya**, bazasiz.
Kirish: oylik va kunlik fakt qatorlari. Chiqish: `SellerMedalRowDto[]`.
Bazasiz test qilinadi, `sellerBonus.ts` va `sellerClose.ts` yonida turadi.

### Medallar

| Kod | Belgi | Nom | Qoida | Takror | Ball |
|---|---|---|---|---|---|
| `month-gold` | 🥇 | Oy chempioni | Oyda 1-o'rin | ha | 500 |
| `month-silver` | 🥈 | Kumush oy | Oyda 2-o'rin | ha | 300 |
| `month-bronze` | 🥉 | Bronza oy | Oyda 3-o'rin | ha | 200 |
| `year-champion` | 🏆 | Yil chempioni | Yopilgan kalendar yilda eng ko'p | ha | 2000 |
| `streak-fire` | 🔥 | Olov seriyasi | 3 oy ketma-ket top-3 | ha | 750 |
| `streak-steady` | ⭐ | Barqaror | 3 oy ketma-ket top-10 | ha | 400 |
| `work-month` | 📅 | Ishchan oy | Floor ishlagan kunlarning ≥ 60% ida ≥ 1 tasdiq | ha | 250 |
| `conversion-master` | 🎯 | Konversiya ustasi | Oyda eng yuqori konv., ≥ 20 buyurtma | ha | 400 |
| `clean-month` | 💯 | Toza oy | Oyda konv. ≥ 80%, ≥ 20 buyurtma | ha | 300 |
| `jump` | 📈 | Sakrash | O'tgan oydan FAKT 2 ≥ +50% | ha | 300 |
| `rookie` | 🚀 | Yangi yulduz | Birinchi to'liq oyidayoq top-10 (2026-08 dan keyin boshlaganlar) | yo'q | 300 |
| `day-record` | ⚡ | Kun rekordi | Butun tarixdagi eng katta bir kunlik FAKT 2 | yo'q | 1000 |
| `day-winner` | 🌅 | Kun g'olibi | Bir kunda 1-o'rin | ha | 50 |
| `first-sale` | 🌱 | Birinchi savdo | Birinchi yetkazilgan buyurtma | yo'q | 100 |
| `club` | 💎 | Klub | Jami FAKT 2 — 7 bosqich, pastda | bosqich | pastda |

**O'rin qoidasi hamma joyda bitta:** FAKT 2 birinchi, FAKT 1 esa hech kim
yetkazmagan oyni hal qiladi — podiumning va `recordsSql` ning o'z qoidasi.
Ikkinchisi teng bo'lsa, `employee.id` — ism 'uz' va 'ru' da boshqacha
saralanadi (`branches.ts`), va ikki so'rov orasida o'rin almashadigan taxta
buzuq ko'rinadi.

**Klub — bitta medal, yetti bosqich.** Raqobat emas, chegara: har bosqich
o'tilgan sari medal ko'tariladi va **pagonda faqat eng yuqorisi ko'rinadi** —
to'rtta klub belgisi bir qatorda turmaydi. Ball esa o'tilgan bosqichlar
yig'indisi, ya'ni yuqori bosqich pastdagisini bekor qilmaydi.

| Bosqich | Jami FAKT 2 | Ball | Bugun qamrovi |
|---|---|---|---|
| I | 10 mln | +100 | 85 kishi (67%) |
| II | 25 mln | +150 | 64 (51%) |
| III | 50 mln | +250 | 41 (33%) |
| IV | 100 mln | +400 | 13 (10%) |
| V | 250 mln | +800 | 0 |
| VI | 500 mln | +1200 | 0 |
| VII | 1 mlrd | +2000 | 0 |

Mediana sotuvchi oyiga ~25 mln qiladi, ya'ni keyingi bosqich har bir necha
oyda keladi — narvon o'zini bir yilga yetkazadi.

«Faqat uch kishi yutadi» — bu tizimni o'ldiradigan narsa. 🌱 va klub unga
qarshi turadi: o'lchov bo'yicha ular medalsizlar sonini **83 dan 5 ga**
tushiradi.

**📅 «Ishchan oy» 100% davomat emas, va bo'lishi ham mumkin emas.** Avgustda
floor 31 kun ishlagan; dam olish kuni bor sotuvchi hech qachon 100% ga
chiqmaydi. O'lchov: eng yuqori davomat 96,8%, p90 — 77,4%, p50 — 35,5%.
100% qoidasi **nol** kishiga medal berardi. 60% chegarasi 29 kishini qamraydi
va «bu oy muntazam ishladi» degan haqiqiy fakt bo'lib qoladi.

**Joriy oy seriyaga kirmaydi.** Yopilmagan oy o'rni har kuni o'zgaradi;
seriyani unga bog'lash medalning kelib-ketib turishiga olib keladi. Seriya
faqat yopilgan oylar ustidan sanaladi. `📅 To'liq oy` ham shu sababdan
yopilgan oyda beriladi.

**🚀 devor ochilgan oyda berilmaydi.** `RECORDS_FROM` chegarasi tufayli
2026-08 da HAMMA sotuvchi «birinchi oyida» ko'rinadi — bu portalning
atributsiya nuqsoni, sotuvchining fakti emas. Medal faqat birinchi to'liq oyi
2026-09 yoki undan keyin boshlanganlarga beriladi.

**Ish kuni** — `📅` uchun — o'sha oyda butun floor kamida bitta buyurtma olgan
kun. Kalendar emas: bayram va yakshanbani sotuvchining aybiga yozib
bo'lmaydi, va portalning o'z ma'lumoti bu savolga allaqachon javob beradi.

### Ball

| Nima | Ball |
|---|---|
| Har tasdiqlangan buyurtma (FAKT 1 natijasi) | +10 |
| Har yetkazilgan buyurtma (FAKT 2) | +25 |
| Har to'liq 1 000 000 so'm FAKT 2 | +5 |
| Medallar | yuqoridagi jadval |

### Daraja

**N-darajaga chegara: `50·N² − 50·N` ball.**

| Daraja | Ball | Daraja | Ball |
|---|---|---|---|
| 1 | 0 | 10 | 4 500 |
| 2 | 100 | 12 | 6 600 |
| 3 | 300 | 15 | 10 500 |
| 5 | 1 000 | 20 | 19 000 |

**Unvonlar:** 1–3 Yangi · 4–7 Sotuvchi · 8–11 Katta sotuvchi · 12–15 Usta ·
16–20 Master · 21+ Legenda.

Progress chizig'i **keyingi darajani** ko'rsatadi — yaqin, erishsa bo'ladigan
maqsad. Keyingi daraja unvonni almashtirsa, sarlavhada unvon nomi yoziladi
(«Master'ga 1 000 ball»). 15-daraja 10 500 ballda, 16-daraja — ya'ni Master
— 12 000 da: yuqoridagi maketning raqamlari shu narvondan olingan.

### Kalibrlash — O'LCHANGAN, 2026-09-15

Koeffitsiyentlar taxmin emas: production bazasida, 2026-08-01 dan bugungacha,
**126 sotuvchi** ustida to'liq hisoblab ko'rildi (`probe-medals.mts`,
`probe-medals2.mts`, `probe-medals3.mts`).

| | Birinchi taxmin | Kalibrlangan |
|---|---|---|
| Medalsiz | 83 / 126 (66%) | **5 / 126 (4%)** |
| 1-darajada | 23 (18%) | **5 (4%)** |
| Mediana | 4-daraja, 0 medal | **5-daraja, 1 130 ball, 2 medal** |
| Eng yuqori | 12-daraja, 6 650 ball | 12-daraja, 7 700 ball (2 kishi) |

Daraja taqsimoti kalibrlangandan keyin: 1-dj 5 · 2-dj 29 · 3-dj 13 · 4-dj 14 ·
5-dj 15 · 6-dj 11 · 7-dj 13 · 8-dj 11 · 9-dj 5 · 10-dj 5 · 11-dj 3 · 12-dj 2.
Cho'qqi 2-darajada (🌱 birinchi savdo o'sha yerga olib chiqadi), quyruq
o'ngga cho'zilgan — narvon ishlayapti.

**Qolgan 5 medalsiz — halol nol:** ular yetkazilgan savdosi umuman yo'q
sotuvchilar. Shu sababdan **1-daraja endi aniq ma'no tashiydi** — «hali
yetkazilgan savdosi yo'q», va undan chiqish uchun bitta savdo yetadi.

Medal qamrovi (bugun): 🌱 121 · 💎 klub 85 · 📅 29 · 🌅 27 kishi / 44 dona ·
💯 26 · 🥇🥈🥉 1 tadan · ⚡ 1 · 🎯 1. Nol: 🏆 (2027-yanvar), 🔥 ⭐ (noyabr),
📈 🚀 (ikkinchi yopilgan oy — oktyabr).

**So'rov narxi o'lchandi:** oy kesimi 848 ms, kun kesimi 1 224 ms — birgalikda
~2 s, 10 daqiqalik kesh ostida, ya'ni sutkasiga ~140 marta.

Sabab bularni oldindan o'lchashda: bir marta ishga tushgan darajani keyin
pasaytirish mumkin emas — floor uni jazo deb o'qiydi. **Raqamlar shu yerda
qotirildi.**

---

## 3. Ekran

### Seat kartasi

Bugungi uch karrali blok (`SellersPage.tsx:917–963` va chempionning
`lead` chipi) **butunlay olib tashlanadi** — chip ham, chiziq ham, foiz ham.
O'rniga:

```
   128 550 000 soʻm
   FAKT 2 · 74 / 96 buyurtma · 77%
   ───────────────────────────────
   ▌▌▌   15-daraja · USTA · 11 000 ball
   ━━━━━━━━━━━╸──────  Master'ga 1 000 ball
   🥇×3  🥈  🎯  💯  💎IV   +4

   ╭─────────────────────────────╮
   │ 🎯  Konversiya ustasi       │
   │ Avgust 2026 · 82% · 41 buy. │
   ╰─────────────────────────────╯
```

Medal qatorida eng qimmatli **5 tasi**, qolgani `+N`.

**Medali yo'q sotuvchida — faqat daraja chizig'i.** Liderga bo'lgan masofa
seat kartasida qoldirilmaydi (mijozning qarori, 2026-09-15). Karta qisqaradi.
Jadval qatoridagi `Chase` esa **qoladi** — u boshqa komponent va mijoz unga
e'tiroz bildirmagan.

### Gapiruvchi medal

Medalning ma'nosi hover ostida yashira olmaydi: **televizorda sichqoncha yo'q**
(`SellersPage.tsx` ning o'z sarlavha izohi). Shuning uchun har medal uch narsa
olib yuradi — belgi, qisqa nom, va **sababi fakt bilan**.

Ustunda **bitta umumiy soat**: har ~6 soniyada bitta medal ochiladi, uch
seatning medallari bo'ylab aylanib yuradi, va bir vaqtda faqat bittasi
gapiradi. Uch kartada bir vaqtda o'zgarish televizorda ko'zni charchatadi.

Bu pastdagi 139 qatorning ham savolini yopadi: o'sha `🎯` belgisi qatorda
izohsiz turadi, lekin podiumda aylanib o'zini tanishtiradi. Bir necha
daqiqada taxta butun medal alifbosini o'rgatadi, sichqonchasiz.

`prefers-reduced-motion` da aylanish to'xtaydi va birinchi medal ochiq qoladi
— RecordWall'ning o'z qoidasi.

Stolda o'tirgan uchun `title` atributi ham beriladi, bepul.

### Jadval qatorlari

**Yangi ustun qo'shilmaydi.** Mijoz 2026-09-07 da 390px'da yon skrolldan
shikoyat qilgan («scroll qilish qiyinlashgan»); 7-ustun buni yomonlashtiradi.
Pagon ism katakchasining ichiga, chiziq ostiga, `Chase` yoniga tushadi:

```
 47 │ Marjona Xayrullayeva   [Xonzoda]
    │ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁
    │ ▌▌ 8-dj  🥉 💎III 🌱 +2   ↑ 2 100 000
```

Daraja chipi + eng qimmatli 3 medal + `+N`. Aylanish yo'q — 139 qator bir
vaqtda o'zgarsa ekran o'qib bo'lmaydigan bo'ladi.

### Komandalar ustuni

Tegilmaydi. Medal shaxsiy; ROP komandasiga medal berish alohida savol va bu
ishning doirasida emas.

### Rang shartnomasi

`globals.css:128` dagi shartnoma: metall ranglar **faqat bezak** — ramka,
halqa, yuvindi, pedestal raqami; hech qachon o'qilishi kerak bo'lgan matn
emas, hech qachon qiymat kodlaydigan belgi emas. Oltin tabiatan
`--series-4` va `--status-warning` ga yaqin, va u faqat shu shartnoma tufayli
kechiriladi.

Demak:

- Pagon **ramkasi** — `--metal` (seat o'z metalini meros oladi).
- Ball **chizig'i** — `--seq-550`, jadvaldagi FAKT 2 chizig'i bilan bir xil.
- Daraja raqami va unvon — `--ink-primary`.
- Medal belgilari — emoji, ya'ni palitradan tashqarida; ularning **foni**
  `--surface-sunken`, `--border`, `TeamBadge` kabi.

`globals.css` da PODIUM bo'limi yonida yangi PAGON bo'limi.

### Buzilmaslik

Pagon alohida so'rovda keladi:

- Sekin kelsa — seat medalsiz chiziladi, keyin pagon qo'shiladi.
- Xato bersa — pagon umuman ko'rinmaydi, **reyting hech nima sezmaydi**.
- Bo'sh kelsa — daraja 1, medal yo'q; bu xato emas, yangi sotuvchining holati.

Televizordagi ishlayotgan taxta yangi funksiya tufayli o'chib qolmasligi kerak.

---

## 4. Test

| Test | Nima pinlanadi |
|---|---|
| `tests/domain/sellerMedals.test.ts` | Har 15 medalning qoidasi va klubning 7 bosqichi, jadval bilan. Chegara holatlari: 2 oylik seriya medal bermaydi; uzilgan seriya qaytadan sanaladi; 19 buyurtmali 100% konversiya 💯 bermaydi; klub faqat eng yuqori bosqichni CHIZADI, lekin BALLNI yig'indi beradi; 100% davomat talab qilinmaydi |
| `tests/domain/sellerMedals.level.test.ts` | Daraja chegaralari va unvon bandlari; 0 ball → 1-daraja; chegaraning aynan ustidagi ball |
| `tests/repositories/sellerMedalFactsSql.test.ts` | SQL satri `recordsSql` bilan bir xil predikatlarni ishlatishi — `confirmationRecordsSql.test.ts` naqshi |
| `tests/features/sellersPagon.test.tsx` | Medalli va medalsiz seat; `+N` toshishi; reduced-motion da aylanish yo'qligi |

Gate: `npm run verify` + `npm run build` + `npm run db:check` — uchalasi.

## 5. Ishga tushirish

1. Kalibrlash — production ma'lumotidan taqsimot jadvali, mijozga ko'rsatiladi.
2. Motor + testlar (bazasiz, tez).
3. Repozitoriy metodi + SQL testi.
4. Servis, marshrut, DTO nusxasi.
5. `Pagon.tsx`, `useMedalRotation.ts`, `globals.css`.
6. `SellersPage.tsx` — eski blok olib tashlanadi, pagon o'rnatiladi.
7. Lokal commit. `main` ga push faqat mijoz «deploy qil» deganda.

## 6. Ochiq xavflar

- **Seriya medallari noyabrgacha bo'sh.** Bilamiz, qasddan. Mijozga aytilgan.
- **Daraja va o'rin farqi** — ekranda yozilmasa, xato o'qiladi. Yozilgan
  matn dizaynning bir qismi, keyinga qoldirilmaydi.
- **Ikkinchi kogorta qurilishi** — 10 daqiqalik kesh ostida. Agar o'lchov
  buni qimmat ko'rsatsa, `recordsSql` bilan birlashtirish keyingi bosqich;
  bugun xavfsizlik tezlikdan ustun.
- **Ball koeffitsiyentlari bir marta qotiriladi.** Kalibrlashdan keyin
  pasaytirish yo'q.
- **Qulflangan medal progressi** bu bosqichda yo'q. Kerak bo'lsa alohida ish.
