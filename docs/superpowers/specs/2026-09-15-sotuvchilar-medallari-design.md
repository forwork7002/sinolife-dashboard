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
| `full-month` | 📅 | To'liq oy | Oyning har ish kunida ≥ 1 tasdiq | ha | 250 |
| `conversion-master` | 🎯 | Konversiya ustasi | Oyda eng yuqori konv., ≥ 20 buyurtma | ha | 400 |
| `clean-month` | 💯 | Toza oy | Oyda konv. ≥ 80%, ≥ 20 buyurtma | ha | 300 |
| `jump` | 📈 | Sakrash | O'tgan oydan FAKT 2 ≥ +50% | ha | 300 |
| `rookie` | 🚀 | Yangi yulduz | Birinchi to'liq oyidayoq top-10 (2026-08 dan keyin boshlaganlar) | yo'q | 300 |
| `day-record` | ⚡ | Kun rekordi | Butun tarixdagi eng katta bir kunlik FAKT 2 | yo'q | 1000 |
| `day-winner` | 🌅 | Kun g'olibi | Bir kunda 1-o'rin | ha | 50 |
| `club-100m` | 🏅 | 100 mln klubi | Jami FAKT 2 ≥ 100 000 000 | yo'q | 200 |
| `club-500m` | 💎 | 500 mln klubi | Jami FAKT 2 ≥ 500 000 000 | yo'q | 600 |
| `club-1b` | 👑 | 1 mlrd klubi | Jami FAKT 2 ≥ 1 000 000 000 | yo'q | 1500 |

**O'rin qoidasi hamma joyda bitta:** FAKT 2 birinchi, FAKT 1 esa hech kim
yetkazmagan oyni hal qiladi — podiumning va `recordsSql` ning o'z qoidasi.
Ikkinchisi teng bo'lsa, `employee.id` — ism 'uz' va 'ru' da boshqacha
saralanadi (`branches.ts`), va ikki so'rov orasida o'rin almashadigan taxta
buzuq ko'rinadi.

**Klub medallari ataylab chegara, raqobat emas.** 142 sotuvchining ko'pchiligi
kamida bittasini taqib yuradi, ya'ni pagon hech qachon bo'sh qolmaydi. «Faqat
uch kishi yutadi» — bu tizimni o'ldiradigan narsa, va klublar unga qarshi
turadi.

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

### Kalibrlash — qurishdan OLDIN

Koeffitsiyentlar taxmin: o'rtacha sotuvchi oyiga ~800 ball (~30 tasdiq,
~15 yetkazish, ~30 mln), chempion ~2 500–3 000. Kod yozilishidan oldin
production bazasidan o'qib, 142 sotuvchining **haqiqiy taqsimoti** jadval
qilib ko'rsatiladi: kim qaysi darajada, kimda nechta medal, nechta sotuvchi
1-darajada qotib qolgan.

Sabab: bir marta ishga tushgan darajani keyin pasaytirish mumkin emas — floor
uni jazo deb o'qiydi. Raqamlar bir marta, ishga tushishdan oldin qotiriladi.

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
   🥇×3  🥈  🎯  🏅  💎    +4

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
    │ ▌▌ 8-dj  🥉 🏅 +2      ↑ 2 100 000
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
| `tests/domain/sellerMedals.test.ts` | Har 16 medalning qoidasi, jadval bilan. Chegara holatlari: 2 oylik seriya medal bermaydi; uzilgan seriya qaytadan sanaladi; 19 buyurtmali 100% konversiya 💯 bermaydi |
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
