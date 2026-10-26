# «Bezkval lidlar» — har bir raqam qayerdan olinadi

Asos: egasining spec'i v2 (`bezkval-lid-spec (1).md`, 2026-10-26, muallif Bitrix24'ning o'zida REST bilan tekshirgan).
Ekran: **Lidlar → «Bezkval lidlar»** kartasi (oy jadvali ostida). Kod: `src/server/domain/registration/bezkval.ts`
(qoidalar), `src/server/repositories/registrationRepository.ts` (`bezkvalLeadsSql`, `bezkvalHistorySql`,
`bezkvalPersonRopSql`), `src/server/integrations/crm/sync/bezkvalRefresh.ts` (qachon hisoblanadi).

Dashboard Bitrix24'dan to'g'ridan-to'g'ri so'ramaydi: sinx worker Bitrix ma'lumotining nusxasini PostgreSQL'ga yozadi,
kunni o'zi hisoblab `bezkval_client` / `kval_client` / `bezkval_day` jadvallariga saqlaydi, ekran faqat shularni o'qiydi.
Bugun va kecha — har 10 daqiqada, oldingi 7 kun — har 3 soatda, eski kunlar — bir marta (qoida o'zgarsa — hammasi qaytadan).

## Bitrix'dan nima olinadi

| Nima | Bitrix | Bizdagi joyi |
|---|---|---|
| Bitim yaratilgan voronka va vaqt | `crm.stagehistory.list` TYPE_ID 1 (`CATEGORY_ID`, `CREATED_TIME`) | `crm_deal_birth` (har 5 daq) |
| Bitim voronka almashgani | `crm.stagehistory.list` TYPE_ID 5 | `crm_deal_move` (har 5 daq) |
| Bitim maydonlari | `crm.deal.list`: `CONTACT_ID`, `ASSIGNED_BY_ID`, `SOURCE_ID`, `UF_CRM_ROP_KVAL_LID`, `UF_CRM_1789454012` (РОП Первичка), `UF_CRM_LG_VIA`, `UF_CRM_DEAL_1750679541518` (Телефон ракам), `DATE_CREATE` | `deal` |
| Kontakt raqamlari | `crm.contact.list` `PHONE[]` | `customer.phones` (+ `phone_nines` GIN indeksi) |
| Bo'limlar, boshliqlar | `department.get`, `user.get` `UF_DEPARTMENT` | `department`, `employee`, `department_member` |
| Manba nomlari | `crm.status.list` ENTITY_ID=SOURCE | `sales_source` |

`UF_CRM_1789453947` («Лид тушган сана») **ishlatilmaydi**: forma lidlarida `DATE_CREATE`dan aniq 2 soat oldin turadi.

## Kartalar

| Karta | Qanday sanaladi |
|---|---|
| **Kirim (sdelka)** | Kun ichida (Asia/Tashkent) Регистрация'ga (#0) kirgan bitimlar: (a) shu yerda **yaratilgan** (TYPE_ID 1, kategoriya 0), yoki (b) **«ИИ обработка» (#20) dan o'tkazilgan** (TYPE_ID 5 → 0, bitimning oldingi yozuvi #20 da). Первичка'dan qaytgani (12→0) kirim emas. Bir kunda ikki marta kirgan bitim — 1 marta |
| **Bezkval lid** | Kirimlarning noyob mijozlari. Mijoz = telefon raqami (pastdagi normallashtirish); kontaktning hamma raqamlari, **bitimdagi «Телефон ракам»** va bitta kontaktli bitimlar union-find bilan bitta mijoz. Raqam umuman yo'q → kontakt → bitim. Bitim raqami doim bog'lanadi (spec matni uni faqat zaxira deydi, lekin etalon shunday sanalgan: 23.10 Bitrix'ning o'zidan zaxira usulida 1 250, doim bog'lab 1 232, etalon 1 228) |
| **Yangi** | Mijozning biror raqamini saqlagan **hamma** kontaktlarda kun boshigacha (00:00) HR (#8) dan boshqa voronkada yaratilgan bitim yo'q |
| **Takror 30 kun** | O'sha bitimlarning eng yangisi kun boshidan oldingi 30 kun ichida |
| **Takror eski** | Bitim bor, lekin 30 kundan oldin |
| **Taqsimlanmagan** | Asosiy bitimda ROP yo'q va «Ответственный» = 10 (Рустамов Дониер) yoki 1 (Админ) |
| **Kval (Первичка)** | Kun ichida Первичный отдел (#12) da yaratilgan bitimlar (soni) va ularning noyob mijozlari. Bezkvalga **kirmaydi** |

Tenglik: **Bezkval = Yangi + Takror 30 + Takror eski**; **ROP'lar + Регистрация bo'limida + Taqsimlanmagan = Bezkval**;
**Bezkval ≤ Kirim**; har bitim bitta mijozda. Biror tenglik buzilsa, karta qizil «Tekshiruv buzildi» deb yozadi.

### Telefon normallashtirish (spec 4.4)

`998` + 9 raqam (12 ta) → oxirgi 9 raqam; 9 raqam → o'zi; 10+ raqam va `998` bilan boshlanmasa → `x` + hamma raqamlar
(xorijiy: `+7 916 123 45 67` ≠ `+998 16 123 45 67`); qolgani va bitta raqam takrorlangani (`999999999`) — raqam emas.

## ROP jadvali (spec 5.5)

Mijozning **asosiy (eng erta kirgan) bitimi** bo'yicha, tartib bilan:

1. «ROP KVAL LID» odami «(ROP)» bo'limini boshqarsa → o'sha jamoa; oddiy xodim bo'lsa → u o'tirgan «(ROP)» bo'lim (avval asosiy bo'limi, keyin boshqa a'zoliklari);
2. «РОП (Первичка)» — xuddi shunday;
3. «Ответственный» «(ROP)» bo'limda bo'lsa → o'sha jamoa;
4. «Ответственный» 10 yoki 1 → **Taqsimlanmagan**;
5. qolgani → **Регистрация bo'limida**.

Jamoa nomi — bo'lim nomidan «(ROP)» olib tashlangan («RNP jadvali» bilan bir xil kanonik nom: `Malika` → `Charos`);
yonida hozirgi boshlig'ining ismi. «Ulush %» = qator ÷ Bezkval.

## Qo'shimcha jadvallar

- **Manba** — asosiy bitimning `SOURCE_ID` nomi; `UF_CRM_LG_VIA` «Lead Guard» bo'lsa → «Ген лид (Lead Guard)».
- **Kirim turi** — Регистрация'da yaratilgan / ИИ обработка'dan o'tgan / Lead Guard: bitimlar soni va asosiy bitimi shu turdagi mijozlar.
- **Soat bo'yicha** — asosiy bitim kirgan soat. **30 kunlik trend** — kirim va bezkval.

## Har bir raqamni ochish

Istalgan raqam bosilsa — o'sha mijozlar ro'yxati: telefon (oxirgi 4 raqam), kirim vaqti, manba, ROP, holat
(Yangi / Takror 30 / Takror eski), shu kundagi bitimlar soni va har biriga Bitrix havolasi
(`https://obey.bitrix24.kz/crm/deal/details/<ID>/`), takror bo'lsa — oldingi bitim havolasi va sanasi. «Excel» tugmasi
xuddi shu qatorlarni CSV (`;`, Excel ochadi) qilib yuklab beradi.

## Bitrix ekrani bilan solishtirish

CRM → Сделки → Воронка = Регистрация, «Дата создания» = kun → pastdagi «Всего» = shu kun yaratilib hozir Регистрация'da
turgan bitimlar. Bu «Kirim»dan ozgina farq qiladi: keyin boshqa voronkaga o'tganlar u yerda yo'q, ИИ'dan o'tganlar esa
o'tgan kuni hisoblanadi.
