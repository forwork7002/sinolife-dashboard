<!-- Moved verbatim from CLAUDE.md on 2026-10-20 to keep every session's context small. CLAUDE.md points here; read this file before working on what it covers. -->

## The screens, and what each one dates by

**Three screens were removed.** «Boshqaruv markazi» went entirely on
2026-09-10 («boshqaruv markazi boʻlimini toʻliq olib tashla»). «Joʻnatish
nuqtalari» and the Roistat «Reklama samarasi» were paused the same day
(«hozircha api qilmay tur») and DELETED as dead code on 2026-09-30 at the
client's word («loyihada o'lik kod bo'lmasin») — screen, endpoints
(`/insights/dispatch`, `/marketing/{overview,breakdown,verify}`), section id
`warehouse`, nav entry. «Reklama samarasi» itself came back on 2026-09-23 as a
DIFFERENT screen — the client's own «DM», «Отчёт Т» and lead-quality sheets
(`features/reklama`). The Roistat IMPORT stays: `/target` reads
`marketing_snapshot` for the UZS/USD rate (`marketing_daily` is written and no
longer read).


Every page is a thin shell under `src/app/`, the UI lives in
`src/features/<dir>/<Name>Page.tsx`, and each page calls
`requireSection('<id>')` — a courtesy redirect, not the boundary; the real gate
is the route's `ACCESS`. All of them also inherit `/meta/filters`,
`/meta/alerts` and the ⌘K `/search` from the shell.

**The last column is the one to check before writing a query.** A screen's
reporting window does not mean the same thing on every screen, and picking the
wrong basis is the mistake that produces plausible, wrong numbers.

| Screen | URL | Feature | Endpoint(s) | Service → Repository | Window filters on |
|---|---|---|---|---|---|
| Savdo dinamikasi | `/analytics/sales` | `sales/SalesPage` + `ForecastSection` (with `AdSalesDaysTable` «Kunlar boʻyicha» above the sellers' table, ALL-scope only — Roistat's «Дни» table itself, `RoistatTable` in soʻm, since 2026-10-05 afternoon; since 2026-10-08 its last three columns are the QUEUE cohort's «FAKT 1 · Первичка», «FAKT 1 · База», «FAKT 2 · Первичка» — `RoistatDaysDto.fakt`, `faktDays` over `rnpTeamDays`, БАЗА = `isBaseTeam`, dated by the queue arrival, not the row's lead day) + `ConfirmationOutcomeSection` + `ConfirmationFaktSection` + `DeliveryBoardSection` | `/analytics/sellers` twice (the board, and `?include=faktTrend` for the chart) + `/insights/delivery` + `/analytics/sales-days` (`analytics:read:all`, section `sales`: `RoistatService.days`, the «Дни» cut's rows) | SellerBoard, Pulse, Roistat → SellerBoard, Pulse, Roistat (+ Reklama `campaignDays`) | the arrival in `C4:NEW` (`queued_at`) — «Kunlar boʻyicha» alone is Roistat's LEAD cohort (see Roistat below), so its «Продажи» is not FAKT 1 — **except the Доставка board, which has NO window at all**: a kanban column is where orders are standing now |
| Mijoz qaytishi | `/analytics/cohort` | `cohort/CohortPage` — ONE reading, the MATRIX FIRST. It had two modes («Oddiy» / «Batafsil», `?mode=`) until 2026-09-16; the manager's view and everything only it read are deleted. The matrix has THREE readings of one fetch — «Jami qaytgan» / «Oylik» / «Pul» — and ONE control that is a different question: `?rop=`, the acquiring team, which is its own cache entry and its own request. Under it (2026-10-16) two more matrices, «Kogorta matritsasi · Collagen / · Zextra» (`BrandCohortCard`, `?brand=`, see below) | `/insights/cohorts`, `/insights/customers`, `/insights/concentration` | Insights, Concentration → Insights, Concentration | **nothing — the screen is DATELESS since 2026-09-15** (`period={false}`, like Struktura), and it now carries TWO CLOCKS, each named on screen. `closedAt` on revenue-bearing WON deals is the clock the matrix and the concentration band read; `/insights/customers` reads `createdAtSource` over its OWN trailing 90 days, so its customer totals legitimately differ — never sum across them; the matrix takes no window at all (`months` bounds which cohort ROWS are drawn and never the totals arm) and `/insights/concentration` resolves its OWN trailing 90 days (`trailingDays`). Nothing here reads `createdAtSource` |
| Qoʻngʻiroqlar | `/customers` | `calls/CallsPage` + `CallTable` | `/insights/calls` | Insights → Insights | `call_record."startedAt"` on the dashboard window, clamped below at `CALL_DATA_FLOOR` (2026-09-15 00:00 Tashkent). One clock, one request |
| Reklama samarasi | `/marketing` | `reklama/ReklamaPage` — ONE page since 2026-09-25 (its «Sotuv · ROP» and «Lid kogortasi» tabs moved to «Lidlar»; «Sotuv · ROP» removed 2026-10-01): `FormSection` (its `DmSection` moved to «Target tahlili» alone on 2026-10-13; the DM tiles stay) + `QualitySection` («Lid sifati», the day table, with a «Taqsimot» share bar) + `LeadFormSection` («Formalar · Facebook», its own section under it since 2026-10-14 — a tab of «Lid sifati» for one day: four tiles over listed forms only, then `LeadFormTable`, which says so in words when no form was read yet instead of one «Forma aniqlanmagan» row of dashes; 01–13.10 checked cell by cell against the portal: equal; «Kampaniyalar» / `CampaignSection` was REMOVED the same day — the user: «shuni formalarga oʻzgartirish … facebookdagi formalardan»; the DTO's `campaigns` went with it) — the Meta sheets alone since 2026-10-08: the «Targetologlar · kunlik» strip (here 2026-10-05 → 2026-10-08, with «HR · Kosmetika» as its last card) moved to «Lidlar»'s fourth tab, see below. Since 2026-10-07 an account can send its DM money to a page of its own (`DM_PAGE_OF_ACCOUNT`: Collagen Sobirjon #2 → «collagen.sinolife», read off the ads' creatives), and that page joins this screen's sheets only (`REKLAMA_SOURCE_IDS`). Since 2026-10-10 the sheet's own «sinogummy» and «sinolif_tg» blocks join the same way (`DM_SHEET_PAGES`: leads and kval, no DM money), a page's block carries the targetolog the sheet signs it with (`DM_PAGE_TARGETOLOG`, only the ones read off the client's screenshot), and «Отчёт Т» prints each targetolog's kval — «Lidlar»'s `forms` block met on the owner key in the route (`withFormKval`; only for an account `/reklama/targetologs` would admit — it holds section `leads` and, if narrowed, has that tick wide — anyone else, and a failed scan, leaves the column unread). The Roistat `marketing/MarketingPage` is held, not mounted | `/reklama/overview` (the Roistat `/marketing/*` three still answer, uncalled) | Reklama → Reklama | **two clocks, one Tashkent calendar day.** Meta: `meta_campaign_daily."date"`, the ad account's reporting day, split by `campaignChannel` (OUTCOME_LEADS → «Отчёт Т», OUTCOME_ENGAGEMENT → «DM», hiring campaigns → neither). Bitrix24: the Регистрация lead's `createdAtSource`, bucketed by the stage it sits in NOW (`leadQuality.ts`). Never joined — they meet on the day and the page. ONE EXCEPTION (2026-10-08): «Kampaniyalar»' Kval / Kval % / Kval narxi — a deal names its form, never its campaign, so `importMetaLeads` reads each Meta lead (campaign, ad, phone key) into `meta_lead` hourly and `campaignLeads` meets it with the Регистрация deal of that phone opened nearest to it (−10 min … +2 days); kval = WON now; priced only when ≥ 90 % of Meta's counted leads were read (`LEAD_COVERAGE`) — a form on a page the token cannot open leaves its campaigns unpriced; the same matched leads also fill «Barcha manbalar»'s columns per campaign — Lid (matched), Недозвон, Sifatsiz, Dubl, Jarayonda by `leadBucket` of the stage each sits in now (the three per-campaign FAKT columns were removed the same day, on the client's word). «Formalar · Meta» (2026-10-10, `leadForms`): the same columns with a Meta LEAD FORM on each row — `campaignLeads` answers per campaign × form (organic leads included, no campaign's), and a form's money is its ADS' (`formAdDays`: `meta_ad_insight_daily` filed under the form most of the ad's own `meta_lead` rows name, this window's first, else of all time — the creative is the `ads_management` budget); a lead-form ad no read lead names a form for is the row «Forma aniqlanmagan»; under the brand switch a Meta lead goes with its campaign's budget, an organic one to «Brendsiz». Since 2026-10-13 the forms tab is EVERY form the token's pages list, read like SinoTarget's «Formalar» (Sahifa · Forma nomi · Holati · Yaratilgan sana · Jami lidlar first; Sahifa / Holati / Tartib selects; opens Faol first, newest on top) — `meta_lead_form`, written by `importMetaLeads` on each hourly pass (page, name, status, `created_time`, Meta's all-time `leads_count`; a form gone from its page's list is deleted, DELETED and rows unlisted for 2 days left out), a quiet form too; under the brand switch a quiet form goes by its name (`leadBrand` on «Заполнение CRM-формы "<name>"»), a busy one only with its money/leads. Needs a token with pages_show_list + pages_manage_ads + leads_retrieval on the pages; since 2026-10-14 prod's is the system user «AI Targetolog» (11 pages, 22 forms) — the ads also run forms on ~16 pages it is not assigned to, and a form on such a page cannot be read even by id: the page must be assigned. Those forms ARE drawn since 2026-10-14 off the ads' creatives (`meta_ad_form`, `importMetaAdForms` after the leads, once per ad, ≤300 a pass by the account's `ads` edge filtered by id — the creative is the `ads_management` budget that one full pass exhausted on 2026-09-23): status «Ruxsat yoʻq» (`NO_ACCESS`), page named from `META_PAGE_NAMES`, no name / total from Meta, the ads' money and Meta leads; a creative's form on a page the token DOES read that no longer lists it is «Oʻchirilgan» (`DELETED`). The Meta pass runs on the WALL CLOCK since 2026-10-14 (`lastMetaAt`, seeded from `meta_ad_daily.importedAt`): on the tick counter every deploy pushed it half an hour away |
| Lidlar | `/leads` (section `leads`, 2026-09-25) | `leads/LeadsPage` — four tabs. «Lid manbalari»: `LeadSourcesSection`. «Lid kogortasi»: `LeadCohortSection`. «Targetologlar» (2026-10-08, moved off «Reklama samarasi»): `reklama/TargetologDaySection`, the client's per-targetolog day sheet as a strip of cards — one per targetolog (Rasxod $ · Meta лид · лид $ · Sayt · SMS · HR · Jami $ · Bitrix лид · % · кв лид · кв лид $, off LeadSources' `forms` block so it equals «Lid manbalari»; the sheet's own лид matched neither source, so both are printed; an owner with only hiring / «Boshqa» money is a card of its own, `forms.expenseOwners` — DM money alone makes a targetolog row since 2026-10-14), then the sheet's «Telegram» block per brand (`ManualSpendCard`: the dollars TYPED BY HAND into `reklama_manual_spend` — Telegram Ads has no feed — by a `kpi:manage` account through `TypedField` in place, `POST /reklama/manual-spend`; Bitrix лид / кв лид = Регистрация deals the portal filed under a Telegram source, brand by «Проект», a lead with none is «Brendsiz» and on no card), then `SideCard` (SideSection.tsx), the client's narrow «HR · Kosmetika» day table (2026-09-28: HR = every hiring campaign plus the HR Eldor account, Kosmetika = Kosmetika Eldor, `sideColumn` in `meta/accounts.ts`), drawn only under «Hammasi» / «Brendsiz» and only when the window has that money. The cards share one request, `/reklama/targetologs` (`forms` + `manual` + `side` + `canEdit` + `today`); its кв лид is the arrival cohort's (the stage the lead sits in now), not the headline's `closedAt`. («ROP otchet», a tab here from 2026-10-02, moved to «RNP jadvali» on 2026-10-07.) «Guruhlar» (2026-10-02): `GroupPlanCard` — the client's sheet «Usp soni · Reja (Avto) · Buyurtma summasi · Bajarilish % · Qarz · Dostup», from the first of the day's month to the day; seller by seller from 2026-10-03, ONE ROW PER ROP since 2026-10-13 (the user: «факат роплар руйхати»): Usp soni = the team's без квал (`registration/bezkval.ts` since 2026-10-22, the /rnp group «без квал»), Reja = 200 000 × it, Buyurtma = the team's «ROP otchet» Факт-1 summed over the days, Qarz = Факт-1 − Reja (the opposite sign of «Отклонение»), Dostup «Ruxsat emas» on a red Qarz; leads and orders with no ROP are no row and not in «Jami» (`domain/registration/groupPlan.ts`). «ROP otchet» carries the same Dostup per seller since that day: red «Отклонение» → «Ruxsat emas». It replaced the «безквал / квал» group report; `registration_group_intake` is kept, unread. («Sotuv · ROP» was removed 2026-10-01 at the user's request.) Since 2026-10-02 «Lid manbalari» also carries the old «Registratsiya» split cards (`LeadSplitCards`), placed through `LeadSourcesSlots`: the split under the channel tiles, the month grid «Kimga qancha lid kelayapti» above «Targetologlar» (its «Квал | Безквал» switch, 2026-10-05: Квал = handed-out leads by `leadDistributedOn`; Безквал = SINCE 2026-10-22 clients by the client's spec (see «БЕЗКВАЛ» under *Registratsiya*; cells open their clients, a «Jami lid (bitimlar)» row under the total); until then Регистрация deals by `createdAtSource`'s Tashkent day, every stage, credited to the ROP team their «Ответственный» (`deal.employeeId`) HEADS — or, for a registrar whose portal name carries «rop» (Davlat imomaliyev 104 rop → Shohjaxon, the user 2026-10-05), the ROP unit `department_member` lists them in; any other registrar sitting in a ROP's unit is «ROP belgilanmagan»; since 2026-10-06 also a deal someone else opened now with a seller whose PRIMARY unit is a ROP's (registrars excluded), and else the last hand-over to a ROP in `deal_owner_change` — see «БЕЗКВАЛ» under *Registratsiya*) | `/leads/overview`; `/leads/watch` + `/leads/watch/summary` («Лид назорати», 2026-10-09 — see below; no period, no brand); `/lead-cohort/overview`; `/registration/{overview,groups}?day=`, `POST /registration/split` (section `leads`, `kpi:manage` inside for the POST); `/reklama/targetologs` + `POST /reklama/manual-spend` (section `leads` since 2026-10-08, `kpi:manage` inside for the POST) | LeadSources (+ Reklama's Meta rows and `manualSpend`, + Insights' queue cohort for «Факт1 мижоз»), LeadCohort | **SINCE 2026-10-09 (the client's written spec) THE TILE RULES BELOW ARE SUPERSEDED:** a tile is its SOURCE alone (`LEAD_TILE_SOURCES` — «Сммщик ии» = the bot / SMM accounts by creation day, listed per account, «ИИ квал сана» a quiet line — REVERSED ON THE CARD 2026-10-15, the client: «ИИ квал сана» is the right count: the card's big number, «shundan N dubl», kval and per-account list are Регистрация deals by «ИИ квал сана», any creation day, on the client's nine sources only (`AI_CARD_SOURCE_IDS` — their portal filter of 2026-10-15; «Телеграмм» and the other sources are out) (`tiles.ai`, `smmAccounts`, no close-day count); the creation-day count stayed what «Jami» summed, a quiet line under it, until 2026-10-16 — since then «Jami» sums the CARD, the cards on screen, the client: «barchasini jamiga to'g'rilash kerak», and the line is gone); «Жами / Янги / Дубль лидлар» ARE the tiles' «Jami» (no «Исход», no «Boshqa»; the «+N → Жами лидлар / ИИ farqi» note and `tiles.toHeadline` are gone); kval on the headline and every tile is the COHORT's (created in the window, WON now), the closed-in-window count a quiet second line (`closedQualified`); «Квал лид нархи $» = `forms.total` — all Meta ad money (forms + «Bogʻlanmagan sarf» by account) ÷ every «Ген лид» kval — the same server figure as «Targetologlar»'s «Jami» «Kval narxi»; «Barcha manbalar»'s «Jami» is `totals.counted`, «Исход» listed and marked «jamiga kirmaydi». What follows is the history. «Lid manbalari» is on the dashboard period: Регистрация (role LEAD) and «ИИ обработка» (role AI_TRIAGE) by `createdAtSource`'s Tashkent day — except kval on the headline AND the channel tiles, which is WON by `closedAt` (the portal's CLOSEDATE; `qualifiedSources`, split onto the tiles by source since 2026-10-02 — the tables below keep the arrival cohort's outcome). The tiles' «Jami» is the six channels: «Исход» and «Boshqa» sit apart and «Сммщик ии» reads «ИИ квал сана» in the window (both the client's, 2026-10-02) — since 2026-10-03 only the deals in Регистрация; the ones already in Первичный отдел / Доставка are printed under it, quietly, as «+N dubl · … · sanalmagan» (`tiles.aiElsewhere`) and summed nowhere — so it is NOT «Жами лидлар»; its note says what takes it there, «+N → Жами лидлар · Исход +… · Boshqa +… · ИИ farqi …», from `tiles.toHeadline` — an identity the server keeps, never a remainder the client takes. (On 2026-10-03 «Jami» was made «Жами лидлар» with «Исход»/«Boshqa» inside it and reverted the same day: the client wants them apart and out of «Jami».) «Сарафан» (2026-10-05, the client) is NOT Регистрация: «Сарафан маркетинг» deals in the Ecommerce pipeline (#14, `SARAFAN_PIPELINE_ID`), created in the window, kval = WON («Доставлен») by `closedAt` — out of «Jami» (`LEAD_TILES_OUTSIDE_REGISTRATION`), and a Регистрация lead on that source counts under «Boshqa»; measured that day, Ecommerce held none, so it reads 0. Every tile, «Jami» included, prints «shundan N dubl» quietly — the duplicates are IN the big number; Meta lead-form campaigns by `meta_campaign_daily."date"`, met on the targetolog, never joined per deal. «Факт1 мижоз» (2026-10-01) is the one per-deal join: a lead's phone (last 9 digits) against FAKT 1 orders whose `queued_at` is in the same window and whose deal was created after the lead (`leadFakt1Clients`), distinct clients per line. «Lid kogortasi» takes its OWN day window (default the last 14): the row is `deal."leadArrivedAt"`'s Tashkent day, the column `"leadDistributedOn"` (a DATE, never zoned) minus it. The ROP cards take their OWN shared day (`?day=`, default today), see *Registratsiya* below. |
| AI registrator | `/leads/ai-registrator` (2026-10-22; its OWN section `airegistrator` since 2026-10-23 — the owner: «faqat Umida akkauntiga»; it rode `/leads`'s grant until then, so an account holding «Lidlar» no longer sees it unless ticked; ADMIN / MANAGER by default via `ALL_ROUTES`) | `aiRegistrator/AiRegistratorPage` — the voice agent's call tiles and outcomes, «AI ulab berdi vs oddiy registrator», per seller, the transfer tries per extension, the leads deal by deal. Since 2026-10-23 EVERY NUMBER OPENS ITS CALLS (the owner: «AI qoʻngʻiroq degan joylarda ustiga bossa qaysi nomerlar … kim ulaganini, kim nima qilgani»): the six tiles, each result row, a seller's AI «lid», an extension's «Urinish» open `aiRegistrator/AiCallsDrawer` — each call with its phone, deal, outcome, talk time and attempt, every extension tried with its seller and result, the agent's notes field by field, the lead now and, for a lead the report follows, its verdict and sales; searchable by phone / deal id, 100 at a time | `/leads/ai-registrator`; `/leads/ai-registrator/calls` (same window + `kind` all · unique · answered · outcome · ext · seller · ordered, picked by `selectCalls` — the very rule each number is counted by); the agent writes through `POST /api/ai-registrator/calls` (outside v1, bearer `AI_REGISTRATOR_INGEST_TOKEN`) | AiRegistrator → AiRegistrator | **two hand-off clocks, one per cohort**: AI = `ai_registrator_call."startedAt"` of the deal's first `interested_transferred` call in the window; KLASSIK = `closedAt` of a WON Регистрация deal with «Регистрация» filled and no agent call. The funnel tiles read every call's `startedAt`. What followed reaches past the window to now (sales deals opened −10 min … +30 days) |
| RNP jadvali | `/rnp` (section `rnp`, 2026-09-28) | `rnp/RnpPage` + `RnpSheetTable` + `RnpCostCell` — the client's «СентябрРНП» sheet row by row (`lines`), nothing else: day plan / plan / fact / forecast / index before the days. A second tab «ROP otchet» (`leads/RopReport`, moved from «Lidlar» 2026-10-07) on its own window — a day, a month or a range since 2026-10-14 (`RopWindowPicker`) | `/rnp/overview`, `POST /rnp/plan`, `POST /rnp/costs`, `POST /rnp/headcount` (`analytics:read:all` at the gate, `kpi:manage` inside — except `/rnp/headcount`, see «Ходим сони» below; `/rnp/overview` and `/registration/report` take `analytics:read:own` since 2026-10-24: a TEAM account holding RNP as «Oʻz boʻlimi» gets its own teams' blocks and logistics only, `narrowRnpSheet` / `narrowedTo`, and «ROP otchet» its own people only, `keepsSeller` — OWN refused; see `data-scope.md`); `/registration/report?day=` or `?from=&to=` (a month or a range, ≤ 93 days, since 2026-10-14; section `rnp` since 2026-10-07) | Rnp → Insights (`rnpTeamDays`), Rnp, Reklama (Meta) | its OWN calendar month. FAKT 1 / FAKT 2 / refusals on the queue cohort (`queued_at`), team off the deal as on Logistika; handed-out leads on `leadDistributedOn` (fresh hand-outs only since 2026-10-02: created ≤ 30 days before it); Регистрация on `createdAtSource` (kval on `closedAt` of WON); calls on `startedAt`; Склад on Доставка stage history; Meta on `meta_campaign_daily."date"` |
| Target tahlili | `/target` | `target/TargetPage` + `TargetGroupTable` + `TargetLeadTable` + `TargetMeta` | `/target/overview`, `/target/leads` | Target → Target | **the deal's creation, `createdAtSource`** — a lead on the day it was registered, a sale on the day the seller's deal was opened. The Meta block reads `meta_ad_daily."date"` over the same Tashkent calendar days; its «Forma leadlari» (since 2026-10-15) reads `crm_form_fill."filledAt"` — the instant the form was filled |
| Roistat | `/roistat` (section `roistat`, 2026-10-05) | `roistat/RoistatPage` — the client's own Roistat page (rustamov0277-cmd.github.io/roistat) rebuilt from Meta + Bitrix24 only: 12 tiles vs the previous window, 11 cuts (Кампании → Адсеты → Объявления drill, Таргетолог, Форма, Источник, Товар, Регион, РОП, Продавец, Регистратор; «Дни» is drawn on Savdo dinamikasi as «Kunlar boʻyicha», 2026-10-05 — same `RoistatTable`, `RoistatService.days`), funnel + spend/ROAS chart, сум/$ on the CBU rate. **No UTM on the portal, so the Meta cuts carry Meta figures only**, and spend sits beside leads only on day / targetolog (account owner = form owner) / product (`columnsOf`, `domain/roistat/roistatCuts.ts`); hiring campaigns excluded everywhere | `/roistat/overview` | Roistat → Roistat (+ Reklama `campaignDays` for spend) | **the LEAD's day**: a Регистрация lead on `createdAtSource`; each Первичный отдел / Тасдиклаш / Доставка deal tied to its ORIGIN LEAD (same contact, ≤ 30 days before, WON first) and counted on that lead's day, else on its own creation. Orders = reached CONFIRMATION/REVENUE, sold = REVENUE WON («Target tahlili»'s counters). Meta: `meta_ad_insight_daily` (ad grain, new 2026-10-05) for the three Meta cuts, `meta_campaign_daily` for the money elsewhere |
| Yalpi marja | `/margin` | `margin/MarginPage` | `/insights/margin` | Insights → Insights | `closedAt`, WON + `countsAsRevenue` |
| Logistika | `/logistics` | `logistics/LogisticsPage` + `DailySection` | `/insights/logistics` | Insights → Insights | **the arrival in `C4:NEW`** (`queued_at`) — the confirmation queue's own cohort, since 2026-09-10. It was `createdAtSource` until then |
| Sverka | `/sverka` (section `sverka`, 2026-10-06) | `sverka/SverkaPage` — four Bitrix24 ↔ MoySklad pair tiles (FAKT 1, FAKT 2, Yoʻlda, Qaytgan) + «Kassa» (2026-10-08; since 2026-10-14 FAKT 2 owed against the PAYMENT MoySklad booked on each deal's order, `payedSum`, deal by deal — `totals.kassa`, received + left = due = FAKT 2 inside MoySklad's reach; the «Касса» / «Успешно» statuses are only listed with how many carry a payment — measured 2026-10-17, «Успешно» waits for its money and «Касса» has it, and a status that says otherwise is the `PAYMENT` chip; `payedSum` moves without the order's `updated`, so every import re-reads it for 62 days of orders and for all of them on a sweep run — `refreshPayments`; Bitrix24 keeps no payment sum) + «Toʻliq mos», the difference list (chips by issue, a row opens both sides), products by code, ROP teams | `/sverka/overview` (`analytics:read:all`) | Sverka → Insights (`sverkaCohort`), Sverka | **the arrival in `C4:NEW`** (`queued_at`) for the Bitrix24 side — FAKT 1 / FAKT 2 are Savdo dinamikasi's to the soʻm; each deal's MoySklad orders whatever their date. Plus MoySklad orders whose `moment` is in the window and whose deal is not in the cohort |
| Tasdiqlash navbati | `/confirmation` | `confirmation/ConfirmationPage` | `/insights/confirmations/orders` | Insights → Insights | **the arrival in `C4:NEW`** — since 2026-10-09 EVERY Tashkent day the order arrived on is a row, in the state that visit ended in (`queueSql` unit `'day'`; every other queue-cohort screen keeps the latest arrival only); `?queue=backlog` (where the bell lands) drops the window entirely |
| Sotuvchilar oyligi | `/payroll` | `payroll/PayrollPage` + `PayrollSheet` + `PayrollTeams` — the dashboard's own window since 2026-10-17 (Bugun · Kecha · Shu oy · Sana, the client: «huddi savdo dinamikasidek»; the «Haftalik / 15 kunlik / Oylik» tabs went); the table is picked by the window's length (`payrollSchemeOf`: ≤ 7 days the week's, ≤ 16 the fortnight's, longer the month's, measured on the whole unit so «Shu oy» is a month); since 2026-10-20 ONE sheet in blocks Toshkent · Navoiy · Baza · Zextra (`payrollBranchOf`), every figure against the dashboard's `previousEquivalent`. Since 2026-10-23 two tabs (the client: «sotuvchilar oyligi … huddi shunday jadval usulida»): **«Maosh jadvali»** first (`payroll/PayrollGrid`, in `features/shared/sheetGrid`'s frame with «KPI jadvali»: the page is the grid, name and JAMI pinned, then Hisob · FAKT 2 · Foiz · Fiksa · Oʻsish · the «ROP otchet» counts, then a column per day of the window with that day's FAKT 2 — a ROP's row carries their 2% basis per day; blocks and teams fold, a block's heading sticks; «Excel» CSV) and **«Batafsil»** — the page as it was | `/payroll/sellers` (preset / from / to); `/payroll/days` (the same window — `payrollService.days`, FAKT 2 per seller and per team label per Tashkent day, `confirmationSellerDays` = the rating's cohort / operator / delivery test cut by `faktTrendSql`'s day, pinned in `confirmationSellerDaysSql.test.ts`) | Payroll → Insights (`confirmationSellerRating`, `confirmationSellerDays`) | **the arrival in `C4:NEW`** (`queued_at`) since 2026-10-17 — Savdo dinamikasi's FAKT 2 to the soʻm (the client: «savdo dinamikasidagi to'g'ri malumot ekan»); it was the DELIVERY day from 2026-10-05 |
| Sotuvchilar reytingi | `/sellers` | `sellers/SellersPage` | `/analytics/sellers` | SellerBoard, Analytics → SellerBoard | the arrival in `C4:NEW` (`queued_at`) — the confirmation queue's own cohort. **The television board**: two podiums and two ranked lists (sellers left, teams right) — the sellers' seats and rows carry medals, the teams' carry none — and ONE control, the FAKT 1 / FAKT 2 switch in each heading; the FAKT 1 / FAKT 2 totals, conversion, bonus fund and ladder render on Savdo dinamikasi (`sales/ConfirmationFaktSection`), which is why the route lists both sections |
| KPI rejalari | `/kpi` | `kpi/KpiPage` — two tabs since 2026-10-23: **«KPI jadvali»** first (`kpi/KpiSheetScreen` + `kpi/KpiSheetTable` on `features/shared/sheetGrid` — the column under the pointer lights up, a block's heading sticks under the header with «✓ mos» / «N farq», blocks fold, a date holding a difference carries a red dot; the client: «kpi natijalari … jadval usulida … rnp jadvali vizualidagi … excel jadvaldek … moyskladdan ham bitrix24dan aniq»: the cards below as ONE calendar month on the RNP grid's CSS but its own look since the same day («aynan huddi rnp jadvalidek emas … visual darajasida oʻzgacharoq»): `kpi/KpiSummary` tiles on top (FAKT 1 / FAKT 2 orders and soʻm, Нутрицолог $, differing orders — Bitrix24 big, MoySklad under it, «✓ mos» or the gap), then the grid with label, «Jami» and «Moslik» pinned (`matchOf`: the days' absolute gaps over Bitrix24's figure) and a column per day; each figure is a PAIR of rows Bitrix24 / MoySklad (`sheetGroups`) — a day that differs turns the MoySklad cell red with a ▲▼ gap chip under its figure, the server's «Farq» rows stay in the payload and the CSV; a month sparkline under each name; blocks «Collagen + Zextra», then each brand with its products per FAKT figure; a day cell opens that day's orders in a drawer (`DayOrders`); «Excel» downloads a `;` CSV with a BOM; its own `?`-less month box, floor 2026-06; built by `domain/sverka/kpiSheet.ts` over `SverkaService.brandLines` for the month as a custom window, so `/kpi/days` over the same month hits the same cache entry — measured on production 2026-10-23: that read 3.3 s for October, 5.5 s for September, cold) and **«Kartalar»** — every card below, unchanged: `kpi/NutritionistCard` («Нутрицолог · Collagen», 2026-10-17, the client: «коллаген факт1 / факт2 сони, Битрикс - Мой складан, 100*2$ = 200$»; «· Collagen va Zextra» since 2026-10-20 — the owner: «zeektra», «men aytganimdek»; the RNP sheet has a «Нутрицолог» line under both projects; same 2 $, the rate was not given for Zextra) + `kpi/ProductCompareCard` («Tovarlar · Bitrix24 ↔ MoySklad», 2026-10-20, the owner: «Bitrix24da shuncha tovar … Collagendan shuncha tovar MoySkladda ham, ikkisini solishtirilgan holatda» — each brand's pieces and soʻm per product, a «Collagen · jami» / «Zextra · jami» heading row, a FAKT 1 | FAKT 2 switch) + `kpi/SverkaSummaryCard` («Bitrix24 ↔ MoySklad · solishtirish», 2026-10-19, the client: «kpi natijalariga chiqar barcha maʼlumotlarni solishtirib» — «Sverka»'s whole comparison: the four pairs, Kassa, every issue's count and soʻm, the teams; deal rows stay on «Sverka») | `/kpi`; `/kpi/sheet?month=YYYY-MM` (`sverkaService.sheet`, `analytics:read:all`, section `sverka`), `/kpi/nutritionist`, `/kpi/products` (`sverkaService.products`) and `/kpi/sverka` (`sverkaService.summary` = the cached overview less `lines` / `products`) (`analytics:read:all`; section `kpi` for the first, `sverka` for the other two — each is a subset of `/sverka/overview` and must reach no one that one refuses; a card is not drawn on a 403) | Kpi, Analytics → Reference, Deal; Sverka → Insights (`sverkaCohort` with `brands`: ONE scan, each deal labelled by `brandOfSql` — `brandSliceSql`'s expression without the comparison), Sverka | **the plan's own `periodStart`/`periodEnd`** — the dashboard window only *selects* which plan is live. The nutritionist card is the exception: the DASHBOARD window over the queue cohort, «Sverka»'s FAKT 1 / FAKT 2 order counts (`sverkaTotals`) per brand (Collagen, Zextra — «Brendsiz» on neither), Bitrix24 against MoySklad, each × `NUTRITIONIST_USD_PER_ORDER` (2 $, `domain/sverka/nutritionist.ts`); the employee / department filters do not narrow it. «Tovarlar» reads the SAME brand lines (`SverkaService.brandLines`, one cached scan with the deals' product rows, shared by both cards): `productRows(lines, 'FAKT1' | 'FAKT2')` — FAKT 1 is «Sverka»'s product table rule, FAKT 2 is Bitrix24's delivered deals against the orders MoySklad calls Успешно / Касса, as `sverkaTotals` counts them; a `beforeFloor` deal on neither side |
| Struktura | `/structure` | `structure/StructurePage` | `/insights/structure`, `/insights/structure/roster` | Insights → Insights | **nothing — the screen is DATELESS.** `period={false}`, no window control, and neither endpoint takes one |

`/` RENDERS NOTHING. It is a signpost with **no** `requireSection`: it calls
`firstSectionFor(LANDING_ROUTE)` and redirects, because it is where every login
and every bookmark lands and a guard there would bounce the user off their own
home page. `LANDING_ROUTE` in `src/lib/sections.ts` is «Sotuvchilar reytingi» —
named rather than taken from the head of `SECTIONS`, so where 289 people land
after signing in is a decision and not an ordering detail. An account that does
not hold it falls through to the first section it does, then to `/account`.

Per-screen traps worth knowing before you touch one:

- **AI registrator** — added 2026-10-22 (the owner: «AI registrator kimga
  ulab berdi, sotuvchi qaysi sdelkalarga oʻtkazdi … AI ulab berishi yaxshimi
  yoki mutaxassisga ulagani yaxshimi»; he reads it for a day or two and
  decides). Bitrix24 holds nothing this dashboard can read about the voice
  agent's calls (it writes a timeline comment; the ATS logs the call), so the
  agent PUSHES each finished call to `POST /api/ai-registrator/calls` →
  `ai_registrator_call`, upserted by `callId` (it retries until a 200). The
  route lives outside `/api/v1` like `/api/bitrix24/events`: a service, not a
  person, a bearer token compared in constant time, 404 while
  `AI_REGISTRATOR_INGEST_TOKEN` is unset. `dealId` is the Регистрация deal's
  portal id, joined to `deal."externalId"` at READ time — a push may land
  before the sync read the deal («Bitrix24dan hali oʻqilmagan»). An outcome
  the screen does not know is stored and printed as given, never refused.
  A transfer TRY's `result` is the opposite — `z.enum(TRANSFER_RESULTS)`, an
  unknown one refuses the whole call — so a new result lands HERE first and
  the agent sends it after. Since 2026-10-27 (the owner: «band faqat boshqa
  odam bilan gaplashayotgan bo'lsa … ataylab ko'tarmadi, qizilni bosdi — aniq
  ko'rinsin»): `busy` = on another call only, `rejected` = it rang and the
  seller turned it down, `no_answer` = rang out, `caller_left` = the caller
  hung up while it rang (not counted against the extension), `failed` = the
  ATS refused; each try may carry `ring_sec`, printed «· 15 s jiringladi».
  Every definition is in `domain/aiRegistrator/aiRegistrator.ts`: the two
  cohorts are dated by their HAND-OFF (AI: the transfer call's start; KLASSIK:
  «Сделка успешна» of a lead the agent never called — a lead the AI talked to
  is on neither side), a sale goes to the contact's LATEST hand-off at or
  before it (every hand-off the contact ever had takes part, so one sale is
  never on two leads), «Buyurtma» = a Тасдиклаш / Доставка deal exists (its
  sum the Доставка deals' when any, else the Тасдиклаш deals'), «Yetkazildi»
  = Доставка WON with `countsAsRevenue`. The seller on the AI side is the
  extension's floor number (`indexByFloorNumber`), on the classic side the
  first order's `operatorEmployeeId`, else the first sales deal's owner; «Bitim:
  …» on a deal row names who wrote the deal when it is not the person the AI
  rang. Below `MIN_LEADS_TO_COMPARE` (20) AI leads the screen says no
  conclusion is possible yet — a floor, not a significance test. NOTE: the
  agent's own Bitrix24 write-back (`deal_sync.py`, 2026-10-22) also sets
  «ИИ квал сана» (`aiQualifiedAt`) on every lead it finished calling, and
  «Lidlar»'s «Сммщик ии» card counts that field — once the agent calls real
  leads, that card mixes its leads with the SMM bot's.

- **Target tahlili** — added 2026-09-19 («targetingni toʻliq qanday
  boʻlayapti koʻrish uchun… pul maʼlumotlari… toʻliq leadlar haqida»). The
  client's «Target» Google Sheet is private and was never read; the screen is
  built from what that sheet is built from (`~/bitrix-sheets/Bitrix24Sync.gs`):
  deals on the `TARGET_SOURCE_IDS` in `mapping.ts` — that export's seven, plus
  «collagen.marine» (UC_MWIKOC, Collagen) since 2026-10-02 at the user's word.
  The export does not carry it, so the client's sheet runs below this
  screen's Collagen by exactly that page's deals; do not "fix" the list back.
  **A LEAD AND ITS SALE ARE TWO DEALS.** The lead is the Регистрация (LEAD)
  deal; «Сделка успешна» makes the portal open a SECOND deal for the same
  contact in Первичный отдел, copying SOURCE_ID and the targetolog, and that
  deal id moves on to Тасдиклаш and Доставка. The summary counts both sets over
  one creation window and never adds them — per-source and per-targetolog rows
  pair them by the fields the portal copied, not by a join. Only the lead LIST
  joins, per row after the LIMIT (`LEFT JOIN LATERAL` on `customerId`).
  База is never read. «Buyurtma» = a sales deal now in CONFIRMATION or REVENUE;
  «Tushum» = REVENUE + WON.
  **THREE NEW DEAL COLUMNS** — `targetolog` (enum, `UF_CRM_1772197583641`),
  `creative` and `primarySource` (type unknown while empty, read with
  `labelOrText`). Null is «Koʻrsatilmagan», never organic; 5% of target leads
  carried a targetolog on 16.08–15.09.2026 and the screen prints that share.
  They are backfilled by the WORKER, once: `DEALS_BACKFILL` in
  `syncWorker.ts` re-reads every deal modified since 2026-08-01 in the
  Tashkent night (01:00–06:00), through the worker's own provider — same
  limiter, hourly ceiling and refusal gate, never a second process on the
  portal. It runs as sync mode `BACKFILL` (new enum value): never moves the
  watermark and is never mistaken for the DEALS / FULL deletion sweep. A
  BACKFILL success after `requestedAt` settles it; unserved requests expire in
  14 days. By hand: `npm run bitrix:resync -- DEALS --since=YYYY-MM-DD`.
  **THE AD SPEND IS META, READ DIRECTLY — the client's «Лид база» sheet.**
  `importMetaSpend` (src/server/integrations/meta) reads Meta Ads Insights per
  ad account per day into `meta_ad_daily`, hourly from the worker
  (`SYNC_META_EVERY`, off without `META_ACCESS_TOKEN`). GET ONLY: the
  client's system-user token also carries `ads_management`, and nothing here
  may ever write. `META_ACCOUNT_OWNERS` maps each account to a targetolog and
  a product AT READ TIME (fix the map, history follows); an unmapped account
  shows as «Boshqa», never dropped. Checked 2026-09-19 against the sheet: Aug 1
  and 2 match to the cent per column; July's Timur columns did not reconcile
  (Zextra 4 846,7 $ vs 5 353,4 $). The sheet's Organic / Telegram / Аббос
  columns are outside these accounts, and the screen says so. Each product's
  spend is set beside its own pages' Bitrix24 leads and delivered money
  (`TARGET_SOURCE_PRODUCT`) — «1 Bitrix24 lead narxi» and ROAS name both
  sources; ROAS borrows the Roistat snapshot's UZS rate. The Roistat page's
  own ad figures are NOT on this screen: they run weeks behind Meta.
  **COLLAGEN AND ZEXTRA, SEPARATELY OR SIDE BY SIDE (2026-09-19).** `?product=`
  (`all` | `Collagen` | `Zextra`) narrows BOTH halves — leads to that
  product's own pages (`TARGET_SOURCE_PRODUCT`), spend to its own accounts —
  and overrides `scope`. The lead instrument is `ProductCompare`: spend at hero
  size, 100 % share bars (spend / leads / orders / money), the two products in
  columns with «yaxshiroq» on the four cost-and-return rows only, and
  `productVerdicts` writing the conclusion in sentences from figures already on
  screen. Collagen is `--series-4`, Zextra `--series-1`, everywhere
  (`targetTheme.ts`).
  **«FORMA LEADLARI» COUNTS FILLS, AS META DOES (2026-10-15).** The client
  read «83% yetib keldi» as leads lost; measured over 01–15.10 the portal had
  recorded 16 489 CRM-form fills against Meta's 16 550 form leads (every day
  97–103 %) — the 83 % was the Регистрация DEALS they opened. A returning
  contact's fill is filed as a `crm.activity` (PROVIDER_ID `CRM_WEBFORM`) on
  the contact's OLD deal and opens none; the «Qayta zayavka» robot opens one
  for only some, and its 05.10 burst is a late copy `replayedCteSql` drops.
  The client: count «huddi shu kombinatsiyada». So the worker appends every
  fill to `crm_form_fill` (`formFillFeed.ts`: id floor kept ten minutes
  behind the newest fill, a page written as it is read, one request every
  five minutes, backfilled from `FORM_FILLS_FROM_MONTH`, bookmark in
  `lead_watch_sync` row 'forms'), and `bitrixFormLeads` is the window's
  fills by their form's brand (`formFillBrand`: the name's brand, else its
  targetolog's; website, vacancy and cosmetics forms out, as Meta leaves
  «Sayt», hiring and Kosmetika out) plus the AI targetolog's deals, which
  never arrive as a CRM form. «Leadlar · jami» and the per-lead rates (kval %,
  1 lead narxi, buyurtma %) divide those leads; kval, orders and money stay
  on the deals. A window the fills do not cover — starting before the
  backfill, or running past a last whole pass more than 30 minutes old
  (`fillsCover`) — is counted by deals as before (`formLeadsBasis: 'deals'`).
  THE SAME ON EVERY META-BESIDE-BITRIX LEAD COUNT (2026-10-16, the client:
  «leadlar qanday hisoblanayotgan bo'lsa huddi shunday qilib o'tkaz»):
  «Lidlar»' `forms` block takes the fills by day (`formFillDays`, shared
  helpers in `formFillRepository.ts` / `domain/leads/formFills.ts`), files
  each on the row its form's deals are filed on (`formOwner`, then a tail map
  of its own that also knows the fills' names — the deals' map never sees
  them, so a fill cannot move a deal — else the form's own `form|` row),
  sliced by `leadBrand` on the form alone; the website's form counts there
  (that «Meta lid» counts «Sayt»), a vacancy's or Kosmetika's never
  (`isCustomerForm`); «Brendsiz» keeps the deals. Every owner carries
  `bitrixLeads` + `leadsBasis` — «Targetologlar»' «Bitrix24 lid», its
  «Yetib keldi», «Lid narxi» and Kval % divisor, the day cards' «Bitrix лид»
  (`FormDayDto.leads` is the fills on that basis), /target's targetolog
  cards (`withTargetologLeads`), «Отчёт Т»'s kval % divisor (`withFormKval`)
  and «Лид назорати»'s «Yetib keldi». `outcome` (kval, недозвон, sifatsiz,
  dubl, jarayonda) stays the deals'. A failed fills read is the deals'
  basis, logged — never the tab down. SINCE 2026-10-16 «Lid manbalari»'s
  «Ген лид» tile too (the client: «bitrix24dan ol facebookdan emas»): its big
  number is `forms.bitrixLeads` — every fill, the AI targetolog's deals, the
  hand-typed «Ген лид» (`tiles.generatedBasis`) — so «Жами / Янги лидлар»
  sum it; its dubl and kval stay the deals'. Portal 01–16.10 09:40: 15 806
  «Ген лид» deals, 1 068 of them the 05.10 late copies, ~17 300 fills; every
  form deal (14 179) on «Ген лид»'s source, so no other tile counts a fill
  twice. «Barcha manbalar» (`totals.counted`) stays deals, so its «Jami» is
  no longer the tiles' «Jami». A formless deal filed on an owner is its
  fill, so under «Brendsiz» the tile is the hand-typed «Ген лид» alone and
  Collagen + Zextra + Brendsiz still add up; dubl is capped at the fills;
  `tiles.generatedDeals` is the deals' quiet line «Bitrix24 bitimlari».
  Company-wide (`analytics:read:all`, in `COMPANY_WIDE`): it names customers
  and phones, and neither half has a team to narrow by.

- **RNP jadvali** — added 2026-09-28 from the client's written spec of every
  cell of «СентябрРНП 26» («huddi shu jadvaldek har bir malumot bitrix24 dan
  tortiladi»). The user chose, that day: FAKT 1 / FAKT 2 are the DASHBOARD's
  (the queue cohort), not the spec's «качонки сделка» date, so this screen can
  never disagree with Savdo dinamikasi or Logistika; the team is the deal's
  «Организация сотрудника» with the department as fallback (Logistika's
  basis, `rnpTeamDays`); plans are typed in here — FAKT plans stay in
  `team_month_plan`, every other plan and the header settings (`usd_rate`,
  `lead_value` with a `fromDay`) are `rnp_plan`,
  values × 100; rows with no Bitrix24 / Meta source (followers, HR, bloggers)
  were left off the screen (reversed 2026-09-30: such a row keeps its place,
  empty and hatched); a team is its department name plus its head.
  **DRAWN A SCREENFUL FIRST (2026-10-20, «page dan page o'tishim … silliq …
  qotmasdan»).** ~370 lines × ~36 cells opened in one go froze the sidebar
  click for 3.1 s at CPU ×4 on a local build (6.7 s from click to address on
  a return with the data cached). `RnpSheetTable` mounts 48 lines and adds 96
  per idle turn (`useLinesDrawn`); `usePinnedSummary` reads every header
  before it writes, and writes last visit's offsets before the first read
  (`lastPin`) — a `--rnp-left-*` written on the box restyles every cell. After:
  0.5 s click → address, the rest lands below the fold in short pieces.
  **The sheet's formulas ARE copied (the client, 2026-10-01: «har bir
  formula … huddi shunday»), a broken one by what it meant:** the forecast
  is the sheet's `=D/$C$2*$C$1` — the fact so far ÷ today's day of the month
  (today counted, = «Oʻtgan kunlar») × the month's REAL length (the sheet
  types 31); a summed row's day plan is `=C/27`; every rate is ΣA ÷ ΣB for a
  day and the month alike; a snapshot row (headcount, «не собран») is never
  summed.
  **Portal facts it rests on**, measured 2026-09-28 through the MCP: for a
  COUNT BY DISTRIBUTION DAY a handed-out lead is ONE deal (it keeps its id
  from Первичный отдел on; 21.09: 338 deals in pipelines 12/4/6, two sharing a
  contact) — Sevinch 38, Saidaziz 41, Maftuna 27 that day. This does not
  contradict «Lid kogortasi»'s «up to three deals»: that fold is keyed on the
  ARRIVAL, so do not «fix» `leadDaysSql` into a fold without re-measuring.
  SINCE 2026-09-30 the ROP's leads are the client's own portal filter —
  «Лид таркатилган сана» + «РОП (Первичка)», EVERY pipeline (База included),
  EVERY day of the month (September: 1–14.09 almost unfilled, 15.09 half,
  full from 16.09 — Sevinch 646, Lola 688, Azizbek 1 629 for the month).
  ON 2026-10-08 THIS WAS REPLACED AND PUT BACK THE SAME DAY: a ROP's kval
  leads were counted by «Сотувчи (Первичка)» (UF_CRM_1789399379, Регистрация
  at «Сделка успешна», the seller's unit — caf53def, 6a43d285) and the client
  called it wrong hours later («eski usuli toʻgʻri ekan»). The hand-out rule
  above is the one that stands, on the sheet and «ROP otchet» («Guruhlar» reads без квал since 2026-10-13).
  `deal."primarySellerEmployeeId"` (migration `20261008120000`) is still in
  the database, unread and no longer written, until a migration drops it.
  Only the rates divided by it (conversion, plan %) still start at
  `LEAD_ROP_RELIABLE_FROM` (16.09). Calls are wrong before 15.09
  (`CALLS_RELIABLE_FROM`, = `CALL_DATA_FLOOR`): days before a row's
  `reliableFrom` are DRAWN muted but never enter its month cell, its pooled
  rate or its forecast pace. «ИИ квал» is NOT a
  kval — the AI hands the deal back to Регистрация and the registrar's WON is
  the kval. БАЗА teams (`BASE_TEAMS`: Charos = «Малика БАЗА», Baza = «Фаррух
  БАЗА») are measured by connected calls, not leads.
  **A duplicate is «Дубликат (лид)» ONLY** (UC_GV19A1, the client's rule of
  2026-10-02 — the red «Дубликат» UC_V1NS34 at the pipeline's end is a lead
  in «Тушган лид»). «Дубль лидлар» on /leads is NOT this since 2026-10-16:
  it counts the «Такрор лид» field (`deal."repeatLead"` filled), every tile's
  «shundan N dubl» and «Янги» (= Jami − it) with it — the client: «dublikat
  lid degan joydagi emas … takroriy deb yaratilganlar» (portal 16.10: 24 in
  the stage, 256 repeat leads, 21 both).
  Matched `~ '[Дд]убл[^(]*\([[:space:]]*[Лл]ид'`, never `~*`: Cyrillic case
  folding follows the ctype, and under a C locale every duplicate was a lead.
  **A LATE «QAYTA ZAYAVKA» IS NOT A LEAD OF ITS DAY** (2026-10-07, the
  client: «Жами лид сонлари хато»). Since 05.10 16:20 a portal robot opens a
  Регистрация deal for a returning contact's form fill («Qayta zayavka (forma
  akt #N) …» in SOURCE_DESCRIPTION), in act order, about once a minute; at
  18:00–20:00 that day it also opened 1 071 deals for acts filled days
  earlier and row 47 read 2 309 (portal-measured: 2 298 → 1 238). A deal whose
  act is below one opened before it (running max, seeded from the day before
  the window) is left out of leads and duplicates (`replayActSql`); a live
  re-fill counts — it is a lead that arrived that day. Its kval still counts.
  «Lidlar»' creation scan applies the same rule (`replayedCteSql`, one
  home) since the same day: 05.10 «Жами лидлар» 2 337 → 1 266.
  Compared with production on 2026-09-28: FAKT 1 to the soʻm on 27 of 27
  days, handed-out leads per team per day, registration and calls all match
  the portal. **The screen once timed out there** (registration 7–10 s, the
  old warehouse statement 9–77 s against the pool's 20 s): the registration
  scan's closed days are a 30-minute stale-while-revalidate memo, and
  «не собран» is counted in TypeScript from the packing stays.
  **2026-09-29: THE WHOLE SHEET** («to'liqligicha, formula va boshqa narsalar
  bilan»), every one of its 445 rows mapped. What that added, and the traps:
  · **NO TYPED DATA — the client's rule of 2026-09-29 evening** («qo'lda
    malumot kiritilmaydi umuman … raqam har doim bitrix24dagi … formula
    qilib hisoblangan»). A day of the sheet is shown only if Bitrix24 or Meta
    can compute it; the sheet's typed rows (Instagram/Telegram 5–10, HR
    335–343, the P&L cost lines 411–415 / 438–442, a group's «без квал»,
    Zextra's lead count; «без квал» / «квал %» ARE filled since 2026-10-09 —
    «Lidlar»'s «Безквал» of the group's ROP team, `RnpRepository.bezkvalDays`
    → `reg:bezkval:<g>` / `reg:bezkval_pct:<g>` = квал ÷ без квал; since 2026-10-13 the user's rule «без квал = every Регистрация deal, kval or not» is drawn whole: `reg:bezkval:other` (teams with no group row), `reg:bezkval:none` (no ROP) and `reg:bezkval:total`, so groups + other + none = total — 12.10 on the portal: 990 + 174 + 502 = 1 666; SINCE 2026-10-14 EACH LEAD ONCE, the user: «dublikatlar ikkita birxillikni olmasligi kerak» — `bezkvalDaysSql` drops «Дубликат (лид)» and keeps one PHONE NUMBER's first deal of the day (the contact's first number, last 9 digits; «hamma kelib tushgan raqamlar»), so 12.10 reads ~1 510 on every bezkval screen: «Lidlar» «Безквал», «Guruhlar», /rnp) are NOT filled from the sheet — they keep their place
    empty and hatched (HR was later removed, the cost lines became typed, see
    below) — and a ROP's early leads stay muted rather than being filled from
    the sheet. `rnp_manual_day` and its
    September import were built the same day and then retired; the table was
    dropped on 2026-09-30 with the client's approval. Plans
    (column C) stay — targets and settings, not data (the registrar→group
    mapping stayed too, until 2026-10-02, see «guruh» below).
    ONE EXCEPTION, 2026-09-30 afternoon: the P&L's five cost lines no system
    holds (Блогерлар, Нутрицолог, Брендфейс, Маркетинг харажатлар, Маркетинг
    команда; both projects) are typed in place per day in soʻm — table
    `rnp_manual_cost`, `POST /rnp/costs` (`kpi:manage`), rows carry
    `manual: { kind: 'cost', project, line }` — and count into «Маркетинг
    харажат факт».
    SECOND EXCEPTION, 2026-10-01: each ROP team's «Ходим сони» is typed per
    day (no longer counted from calls) — table `rnp_manual_headcount`,
    `POST /rnp/headcount` (`kpi:manage`; only a team the month's sheet draws,
    canonical names), rows carry `manual: { kind: 'headcount', rop }`; the
    month column is the mean of the typed days above 0.
    SINCE 2026-10-07 A ROP TYPES THEIR OWN TEAM'S (the client: «ROPlar oʻz
    xodimini oʻzi kiritsin, faqat oʻzinikini»): the route's gate is
    `analytics:read:own` + section `rnp`; `kpi:manage` on an ALL account still
    types any team, anyone else only the teams their linked employee HEADS
    (`rnpService.headcountTeamsOf` → `teamsHeadedBy`, aliases folded) — judged
    on headship, not scope, so the TEAM-scoped ROP accounts qualify though a
    mutation never widens. `/rnp/overview` sends those teams as
    `headcountTeams` and the grid opens only their «Ходим сони» rows.
    «REJALAR» IS GONE (2026-10-01, the client: «butunlay olib tashla»): the
    plans form, `POST /rnp/plans` and `POST /rnp/registrars` were deleted.
    Plans already saved are still READ (`rnp_plan`, `team_month_plan`);
    `rnp_registrar_group` is not read since 2026-10-02 (kept, not dropped).
    OCTOBER'S PLANS ARE SEPTEMBER'S (2026-10-02, the client's decision):
    migration `20261002120000_rnp_october_plans` copies every September plan
    the screen reads (not `lead_value` / `usd_rate`, not the old form's dead
    keys) and every `team_month_plan` row into 2026-10, with the two values
    the client's «Октябр» tab changed — Collagen budget 16 000 $, Collagen
    Meta leads 18 000 — written first; ON CONFLICT DO NOTHING, so a typed
    cell is never overwritten. The tab's ×10 cheque and Мафтуна typos are
    not taken from it; its plan % differs because an admin saved 100 on 01.10.
    A later month still opens empty until it is typed.
    PLANS ARE TYPED IN THE GRID since (2026-10-01): where the sheet types a
    column-C cell the row carries `planInput` and the cell is an open field
    (`POST /rnp/plan`, `kpi:manage`, only cells the month leaves open; a
    team's FAKT 1/2 → `team_month_plan`, the rest → `rnp_plan` from day 1).
    Where the sheet computes C the plan is derived, never typed: orders =
    FAKT ÷ cheque, conversion = orders ÷ leads, row 47 = kval ÷ kval %,
    «Отказ %» = 100 − success, and (2026-10-02) the brand P&L's 395/397 and
    422/424 — the sheet's `=D395/D394` and `=IFERROR(D397/D395,0)`: «Сумма
    факт2» as a share of «Сумма факт1» and «База усп» of «Сумма факт2», a
    percent over a soʻm row (`RnpRowDto.planUnit`), no day plan, no index;
    `brand_fakt2` / `brand_base_fakt2` are no plan keys any more. The P&L
    percentages are the sheet's constants (marketing plan 11 %, targetolog
    10 %, marketolog 1 %) unless a month saved its own; `lead_value` is
    inherited team by team from the last month that had one. A БАЗА team
    prices a connected call at ITS OWN `lead_value` (2026-10-02, migration
    `20261002120100_rnp_base_lead_value`): the sheet divides Малика's calls by
    400 000 and Фаррух's by 400 000, then 200 000 from 27.09 — not by the
    company's 500 000 — and October is written out (400 000 both), else it
    would inherit Фаррух's 200 000. The plan % hint names the schedule in
    force.
  · **THE CLIENT RESHAPED THE SHEET (2026-09-30 afternoon)** — see the header
    of `rnpSheetLayout.ts` (hand-kept since): «Таргет Collagen/Zextra», totals
    above them, 47 under 48, Zextra registration → groups «Asliddin ROP» /
    «Sadriddin ROP» («Регистрация COLLAGEN» is every kval), each ROP block
    opens on «План бажарилиши» beside the ROP name and ends on its reach,
    «Чарос РОП» → «Садриддин РОП», Саида / HR / БАЗА «Конверсия % факт2» /
    per-ROP «Свод» / РОП-Регистрация-Разница removed, logistics named per ROP,
    «Кунлик план» after «Индекс». Sections for appended lines are row SETS
    (`rnpSheetView.ts`), since the layout is no longer in sheet-row order.
    2026-10-03 («тепага чикариб берасиз, основный показатели»): the page
    opens on «Основные показатели» (title id 3000) — САС, ROMI, 42–45, then
    «Свод» 346–349; «Свод»'s «Бюджет» (350) is off the page (it was row 42
    again), and 346 no longer opens a ruled table gap.
  · **THE PAGE IS THE SHEET, AND ONLY THE SHEET (2026-09-30, final).** After
    two reversals the client settled on «faqat jadval … to'liqligicha»: the
    ROP rail, KPI cards, charts, funnel and ranking are deleted. Every row of
    «СентябрРНП 26» is listed in `domain/rnp/rnpSheetLayout.ts` (generated
    from the sheet's HTML export: label, column-B text, title/value/helper,
    colour tones); `rnpSheetView.ts` turns it into `lines`, each pointing at
    the block row whose `sheet.row` names it. A row Bitrix24 cannot supply
    keeps its place, empty and marked «Bitrix24ʼda yoʻq» (the client's
    choice). Teams the sheet lacks are added after its own teams and after
    its logistics, DRAWN ON A SHEET BLOCK'S TEMPLATE since 2026-10-02 — the
    lines of the first sheet block of the same shape (lead team / БАЗА team /
    logistics), its labels, bold, tones and order, the team's name on the
    first line — whose first line carries `added: true`, drawn as the chip
    «Bitrix24ʼdan · sheetda bloki yoʻq» (no heading band any more; «Жараёнда,
    %» stays in the payload, off the page); every team the sheet has is drawn
    even in a quiet month (zeros, not «missing»). «ROP» (`?rop=`) cuts the
    sheet to one team's block and its logistics (`ropLines`, each line carries
    `team`; «Свод» has no per-ROP lines since 2026-09-30); «Barchasi» is the
    whole sheet. Its list (2026-10-02) offers every team that has lines, in
    the order their lines first appear — the sheet's — a logistics-only one
    too (Шохжахон, «(ROP yoʻq)»), named by `teams`, else its first team /
    section line's column-B text; a `?rop=` the month has no lines for is
    kept, not cleared, and applies again in a month that has the team.
    The month follows the Tashkent calendar by itself unless one is picked.
    A picked month rides in the URL (`?month=`, `replaceState` like `?rop=`,
    2026-10-02), stripped for the current month and ignored unless it is a
    whole month in [2025-01, current] (`rnpMonthIn`; `RNP_FIRST_MONTH` is the
    overview schema's floor). The month box requests only such a month: a
    half-typed or out-of-range value stays in the box (`draft`) until it is
    one, and a blur puts the shown month back — a box that reverted every
    keystroke would make a year untypable in Chrome (0002 → 0020 → …).
  · **THE DOLLAR RATE IS THE CENTRAL BANK'S, DAY BY DAY** (2026-09-30; it was
    typed as 12 200 while the bank's ran ~11 800). `integrations/cbu/cbuRates`
    reads cbu.uz for every day up to today (past days cached for good, today
    for an hour; a failed read is remembered ten minutes, so a hanging bank
    does not cost every load its timeout — 2026-10-02); a day not answered
    converts at the last answered day's rate, the month's first days before
    any answer at the month's first answered rate (never at 0); no rate at
    all → the converted rows are empty. The header names the latest day the
    bank ANSWERED.
    Old `usd_rate` rows in `rnp_plan` are ignored, and the plans form no
    longer offers the field.
  · **THE SHEET IS KEPT WARM** (2026-09-30, «tezroq ochilish»). Cold, the
    month's scans took ~17 s on production; served from the memo, ~0.1 s.
    `src/instrumentation.ts` starts `rnpWarmer` in the Node runtime of a
    production server: the current Tashkent month is built at start and every
    4 minutes (under the memo's 10-minute hard limit), one build at a time,
    failures logged at warn and retried on the next tick.
  · **Where the sheet's own formulas are wrong, ours are:** its forecast
    multiplies by 31 (C1) in a 30-day month; its SUMIFS still read
    'ОТЧЕТ'/'роп', which stop in August, so FAKT 2, logistics and «Свод» are 0
    there; most September facts are typed by hand (FAKT 1 matched Bitrix on
    167 of 239 team-days exactly). Its FAKT 2 average-check row is labelled
    «Средний чек факт 1» — relabelled «факт 2» here. «Отказ %» is the
    sheet's 1 − «Успешкность %» (still in flight counts), unclamped.
  · September's column C plans are imported by migration (the ×10 «Средний
    чек факт 2», the plans derived from it and zero plans left out; Мафтуна's
    400 000 → 400 mln), October's copied from September (above). The lead's
    value changes on **14.09**, from the sheet's column T.
  · Teams read as the sheet names them (`SHEET_TEAM_NAMES`, «Малика РОП -
    БАЗА» with the sheet's hyphen), and `TEAM_ALIASES` folds old snapshot
    names — Sevinchxon → Sadriddin, Malika → Charos — BEFORE anything is
    summed. ONE NAME PER TEAM (2026-10-02): a team the sheet does not name is
    «<department> РОП» on its block, its logistics and in the ROP list alike
    (`labelOf`; «(ROP yoʻq)» keeps its own). Teams come in THE SHEET'S ORDER
    (`TEAM_SHEET_ROW`, then `LOGISTICS_SHEET_ROW`), the rest by name — it was
    the month's FAKT 1, so the added blocks and the ROP list reshuffled.
  · Registration «guruh — квал» rows = THE LEADS HANDED TO THE ROP TEAM THE
    GROUP IS NAMED AFTER (`GROUP_TEAM`, «Aziz» = Azizbek; the client's
    decision of 2026-10-02) — the very series of that team's «Квал лид сони»,
    never dashed. They were groups of REGISTRARS (`deal.registrar` grouped in
    `rnp_registrar_group`), but nothing could edit that map after «Rejalar»
    went, the desk reshuffled from 22.09 («Sevinch guruh» ~0 while her team
    got 46–61 a day), four groups had nobody, and the Zextra desk's two
    registrars feed Asliddin AND Sadriddin. The table is no longer read
    (kept), nor `leadDaysSql`'s registrar column. The appended «Boshqa
    jamoalar — квал» (key `reg:group:none:qualified`, was «Guruhsiz») holds
    every other team's (Шохжахон, Маржона, Ҳаёт, Kompaniya, the БАЗА heads),
    named in its hint, so the rows add up to «РОП ларга тарқатилди». Row 48
    stays the registrars' WON by close day: the two differ by definition
    (01.10: 240 kval, 233 handed out); its hint says so.
  · **THE CRM FORM'S NAME DECIDES FIRST (2026-10-15, the client: «crm-forma
    nomlariga qarab … hamma yerda», after renaming every form «<targetolog>-
    collagen …» / «<targetolog>-zextra …»).** A LEAD is the brand its form's
    name states (`formNameBrand`, `FORM_BRAND_PATTERNS`: «zextra», then
    «collagen|kollagen|[Кк]оллаген») before «Проект» and its source; an ORDER
    is the brand its ORIGIN LEAD's form names (`originFormBrandSql` in
    `leadFormSql.ts`: Roistat's origin lead — same contact, ≤ 30 days before
    the sales deal, WON first — else the sales deal's own form title), before
    its product and team (`saleBrand(product, team, formBrand)`,
    `brandSliceSql`, `rnpTeamDays.formBrand`, Roistat's sale `b_form`).
    Portal 14.10: 946 of 946 form leads named their brand, «Проект» agreed on
    all 804 that had both; orders opened 10–14.10: 155 of 345 had a form lead,
    the rest fall through to the rules below. Meta money and Meta leads stay
    on the ad ACCOUNT's budget (`adBudgetProduct` — Meta's own records, named
    by Meta's form names, not the portal's renamed CRM forms); team blocks
    stay team blocks. A SALE reads no `form_alias`: a lead known only by its
    form's short name (452 of 6 320 leads in the week of 01–06.10) is that
    form's brand, its order the product's. Roistat's «Товар» cut for a sale is
    the same brand (`sfb`), so cut and switch agree. A FORM IS ITS NAME
    TODAY (2026-10-16): a deal and a fill keep the name AS IT WAS when the
    form was filled, and the forms were renamed on 29.09, so an old name is
    read as its form's current one (`FORM_RENAMED`, each checked to one form
    id on the portal's fill activities) and a form whose name names no brand
    even now by what its leads' sales sold (`UNNAMED_FORM_BRANDS`) — both in
    JS (`currentFormName`, `formNameBrand`, `formOwner`) and SQL
    (`renamedFormNameSql`, `formBrandOfTitleSql`; every step fenced with
    `OFFSET 0`, or the planner inlines the fold into each arm — 4–6× slower;
    the space class `SPACE_CLASS_SQL` is JS `\s`'s, pinned by a test). «Sobirjon» (form 140, 804 leads 31.07–17.09) is
    Zextra, where the guess below said the collagen; «Sobirjon-collagen I.S |
    Short form new 14.09» (form 198, 29.09–05.10) is Zextra too. `form_alias`
    gives a short name to the form holding every titled deal, or ≥ 95 % of
    them when no form sharing it names another brand, its old and new names
    one form: «Sinolife Collagen - 30.04» was Eldor's on 909
    of 911 deals of 01–16.10 and the strict «one name only» left 230 repeat
    leads formless. Portal, deal by deal, old → new: August 685 leads
    Collagen → Zextra; September 310 moved (Collagen → Zextra 142, brandless
    → a brand 168); 01–16.10 117 (Collagen → Zextra 51, brandless → a brand
    66); nothing the other way. The rest of this paragraph is the fallback.
  · Brand P&L: an ORDER's brand is the PRODUCT most of its money was paid
    for (2026-10-06, the client: «mahsulot bo'yicha») — its paid `deal_item`
    lines summed per brand (`PRODUCT_BRAND_PATTERNS`: «collagen|kollagen»,
    «zextra»; Prox, Tibomed, Omega … are «Brendsiz»), `saleBrand` in
    rnpSheet.ts, SQL `InsightsRepository.dealProductBrandSql`. Only an order
    with no paid line falls back to its SELLING TEAM, by the sheet's SUMIFS
    lists (`BRAND_TEAMS`: Collagen = Sevinch, Gulzora, Azizbek, Lola,
    Saidaziz, Maftuna, Marjona, Baza, Shohjaxon; Zextra = Asliddin,
    Sadriddin (+Sevinchxon), Charos (+Malika)) — the rule from 2026-10-01
    until then. The same rule drives every screen's brand switch
    (`?brand=all|Collagen|Zextra|none`, «Brendsiz» the complement, so the
    three slices add up to «Hammasi»); team BLOCKS stay team blocks; a LEAD
    with no brand in its form's name reads its «Проект» field
    (`productLine`, UF_CRM_1750413928942 — since 2026-10-06, the
    client's rule; «Kosmetika» or another non-brand project = none; filled on
    ~a third of the leads so far), else its source (`LEAD_SOURCE_BRAND`, +
    collagen.sinolife and «Сммщик sinolifeuz» since 2026-10-02 — the map also
    marks «Lidlar»'s DM page rows), else a Kamron / Tursunbek form is Zextra
    and any other form Collagen, else none; a form title missing its
    closing quote still names its form. A «Brendsiz» block carries what
    neither brand claims (other products, brandless leads), so the three add
    up to the company; it is drawn as «Brendsiz проект» under the «Brendsiz»
    slice only, never on «Hammasi».
  · **THE AUDIT OF 2026-10-02** (prod vs portal, 282 checks): what it changed
    besides the above, each with its reason in the code.
    THE ROP OF A LEAD — a person heading TWO ROP units counts in the one they
    sit in (`ORDER BY (h."id" = e."departmentId") DESC, h."name"` in
    `leadDaysSql`, `RegistrationRepository.leadRopSql` and its roster): prod's
    «Saida(ROP)» still had Shohjaxon as head after the portal cleared it, and
    the first by name filed all his leads under «Саида РОП». The department
    sync now CLEARS a head the portal no longer names (`headId: null`; one it
    names is linked after the employee pass as before).
    FRESH HAND-OUTS ONLY (the client's decision): «Квал лид сони» and
    everything built on `leadDays` counts a deal created at most 30 days
    before its «Лид таркатилган сана» (`createdAtSource`; «Лид тушган сана» is
    empty before 14.09). On 26.09 the portal re-stamped 1 704 old deals
    (715 to Azizbek, who read 752 where the sheet typed the 37 fresh ones).
    «Lidlar» (`handedOutSql`) does NOT apply this bound — the two can differ
    on such a day.
    A RATE OVER TOO FEW LEADS IS «—»: when a lead team's leads over the rates'
    days are fewer than its FAKT 1 orders, its conversions and plan % print
    «—» day and month, with a hint (Маржона: 1 lead, 53 orders → 5.300 % /
    16.660 %); the counts stay. No definition changed.
    ON THE PAGE: row 45 sits under 42–44 (it is `=G42/G47`); row 346 prints
    the month's own name (the sheet kept «ИЮЛЬ»); a month wholly before a
    row's `reliableFrom` prints «—», not 0 (August's БАЗА calls); a closed
    month's row with `reliableFrom` keeps its reliable days' pace (September's
    БАЗА calls: 16 days, not 30); the undrawn «Логистика — жами» opens no plan
    cell; the БАЗА reach hint says calls arrive about every 3 hours.
    ELSEWHERE: the hiring rule reads English «Vacancy» too (`HIRING` in
    `meta/accounts.ts` — 123 $ of September HR sat in Collagen's budget; the
    «HR» side column on «Reklama samarasi» gains it); «Collagen AI
    Targetolog» (1052133867828964) is mapped to Collagen; `callDirection`
    follows Bitrix24's CALL_TYPE (1 outgoing, 2/3 incoming, 4 callback — it
    read 1 as inbound); a packing stay with no synced leaving is not
    «не собран» for 62 days (only a deal standing there now is open); the
    costs body bounds its month like the others.
    IN THE GRID (front end): a failed BACKGROUND refetch keeps the sheet and
    any half-typed cell — the error card is for no data at all. A typed field
    untouched since the server last filled it takes a refetched figure on
    blur / Enter and sends nothing (it wrote the old figure back over another
    editor's save); typed cells are keyed by what they save (plan
    `${month}:${row.key}`, day `${row.key}:${day}`). Plan fields show their
    row's sign («80%», «$36.000», «$0,80») and take it typed or pasted
    («16 000$», «0,80$»): one «$» before or after a dollar plan, one «%»
    after a percent; the other row's sign, a lone sign or «0.850» (grouping
    after a 0) is refused in place. A dollar figure under $10 prints to the
    cent («$0,77»: to one decimal a 0,77 fact and its 0,80 plan both read
    «$0,8»), larger ones to one decimal, 0 as «$0» (`formatUsd`). The index
    pill is graded on the printed one-decimal value (a «100,0%» is never
    amber), its digits in the tone's ink (`inkOf`), `-mr-2` so they share the
    column's right edge; typed fields pad 10px (18px on the last day) for the
    same edge. The toolbar's «Bugun» is a button on a month that has today
    (`scrollToToday`: today's column to the frozen block's edge); the page
    still opens on the first day. Summary headers carry the sheet's formula
    as a `title`; a heading with a sheet row is upper case whatever its tone
    («ТАРГЕТ ZEXTRA»), a ROP's own heading keeps its case; the «qoʻlda» chip
    names what is typed (soʻm on a cost line, the head count on «Ходим
    сони»); a tinted row paints its band as a background IMAGE, so the row's
    hover reaches its day cells; drag-to-scroll forgets a press when a move
    arrives with no primary button; an orange section line after a line with
    no sheet row («Свод» after an added team's logistics) opens with the
    block gap. The page lead says plans, P&L costs and «Ходим сони» are typed
    in the grid.
    STACKING (`globals.css`, pinned by `tests/features/rnpGridCss.test.ts`):
    not `data-pin-wide`, the unpinned summary cells sit at z 0, so they pass
    UNDER the frozen label (they slid over it on a phone's or a 1024px
    laptop's sideways scroll), and their headers at z 2, under the corner's
    3; a typed cell holding a refusal is z 2, so its message shows over the
    rows below — that rule must stay AFTER the narrow one, which has the same
    specificity. The grid's keyboard ring is drawn on its Card, which clips
    the box's own. The box's scroll padding is the frozen width (the pinned
    block, or the label when narrow) and the header's height, so Tab never
    parks a field under them.
    THE AUDIT'S CRITIC (2026-10-02). A typed cell reads ONE figure: a TAB or
    a line break — a sheet's row or column pasted at once; checked on the
    paste itself, since a field turns a line break into a space — is refused
    («bitta katakni nusxalang»), and grouped thousands are threes under one
    separator (NBSP / narrow NBSP are spaces): «5 075 000⇥0» was saved as
    50 750 000, «8⇥5» as 85 %, «1 25 000» as 125 000. A month that ended
    before today has no hard limit in the memo (`pastMonthCache`: served
    however old, rebuilt behind the reader) — it has no live cells, and
    September read in October waited a cold ~17 s after every ten quiet
    minutes. The warmer's tick is a real rebuild, waited for (`refresh`), so
    «rnp warmed {ms}» is the build's time; in a month's first week it also
    builds the month that ended, once. **Since 2026-10-24 the three warmers (RNP,
    «Lidlar», «Лид назорати») share ONE lane** (`inWarmLane`, rnpWarmer.ts):
    a tick that finds another warmer building waits for it, and `{ms}` is
    its own build — after the 18:29 deploy that day they met on their own
    clocks, failed ×12 on the 20 s timeout and left readers queueing for
    the six screen connections. A rebuild that fails behind a reader
    is logged («rnp rebuild failed; serving the previous answer») — it used
    to vanish while the old rows were served.
  · **«Баҳо» (2026-10-03, the client's scales)**: every ROP block has a grade
    line under «Сумма факт 1 сум» — the day's FAKT 1 graded 2–5 on the team's
    scale (`domain/rnp/rnpGrade.ts`: Collagen первичка 20/35/50 M, Zextra
    25/40/60 M, both БАЗА 15/25/35 M; a bound is the higher grade), a day with
    no FAKT 1 ungraded, the month the mean of the graded days (unit `grade`).
    The client wrote Zextra's 4 as «45–60 M» after «25–40 M»; the gap is
    closed at 40 M. A team with no scale (Kompaniya, a new ROP) draws the line
    empty. No sheet row: layout id = the block's first row + `GRADE_ROW_OFFSET`.
  · **THE FOLLOWER ROWS ARE A COLLAGEN FUNNEL (2026-10-03, the client's
    template).** Rows 5–10 under «Маркетинг COLLAGEN · Хаёт» are gone; ids
    2001–2017 (block `funnel:collagen`, keys `fn:collagen:*`) take their
    place, day by day, Collagen only, each definition approved by the user:
    views / clicks = Meta impressions / clicks (all clicks) of the Collagen
    accounts, hiring left out (`adBudgetProduct`); leads / kval = Регистрация
    by brand (as «Коллаген проект»); new transactions = the FAKT 1 orders of
    Collagen's PRODUCTS sold by the primary teams, successful = their FAKT 2
    (БАЗА out); «Сумма общий успешка» = every Collagen-product FAKT 2, БАЗА
    in — the P&L's own figures (by product since 2026-10-06); ROI = (primary FAKT 2 −
    budget × CBU rate) ÷ (budget × rate), no typed plan (the grid caps a
    percent plan at 1 000 %). «Кол подписчиков» (2003) stays unfilled: Meta's
    ads API reports no follows. Plans shared with the P&L where the figure is
    the same (`brand_*`, `budget_collagen`); the rest are `funnel_*` keys.
- **Registratsiya** (FOLDED INTO «Lidlar» on 2026-10-02 — «registratsiya boʻlimi toʻliqligicha oʻchiramiz»: section id, `/registration` page and nav entry deleted; its four stat tiles were dropped; the split card and the 7-day grid live on «Lid manbalari», «ROP otchet» on its own «Lidlar» tab, all on one shared day; the endpoints kept their `/registration/*` paths and now gate on section `leads`; «ROP otchet» moved to a tab of «RNP jadvali» on 2026-10-07, its own day, and `/registration/report` gates on section `rnp`) — added 2026-10-01 from the client's Excel («Jami /
  yangi / dubl», ROP → % → лид сони). ONE company-wide split, set EVERY day
  (`registration_split`, basis points, a day's rows sum to 10 000, saving
  replaces the day). «Jami» is the day's HANDED-OUT leads (the client chose
  this over the registration intake: 29.09 — 1 082 registered, 306 kval,
  289 handed out). The portal stamps «Лид таркатилган сана» on the
  Регистрация deal too (54 of 343 that day, none with a ROP), so the LEAD
  pipeline is left out of «Jami». No handed-out lead sits in a duplicate
  stage, so a duplicate is the same contact handed out twice that day. Plan
  leads are `apportion`ed (src/lib) so they sum to the new leads exactly; the
  form converts leads to basis points the same way. The nine teams are
  `SPLIT_ROPS`; any other team that got leads is appended. Migration grants
  the section to accounts that hold `rnp` explicitly. Checked locally on a
  throwaway copy with synthetic leads, NOT against production.
  «ROP OTCHET» (2026-10-01, in the split table's place): Лид сони = the
  same handed-out deals, team named the same way, credited to the operator
  else the owner; FAKT 1 / FAKT 2 = the board's queue cohort per operator,
  team as `rnpTeamDaysSql`; Конверсия = Транз-1 ÷ Лид сони. План = 500 000
  soʻm × Лид сони since 2026-10-02 («план = 500.000* лид сони»; the plan
  typed per seller and its `POST /registration/plan` were removed — the
  `seller_day_plan` table is still there, unread), Отклонение = План − Факт-1
  (the client's sign; ✅ when Факт-1 ≥ План, 🔴 below). Дозвон / Длительность
  (2026-10-02) = the day's connected calls and their talk time per person,
  as «Qoʻngʻiroqlar» counts them, on the person's roster row (off-roster: the
  group where they earned most), a dash before `CALL_DATA_FLOOR`. Roster = team heads +
  PRIMARY department members; leads/orders naming no team form «Jamoasiz».
  «БЕЗКВАЛ» v2 SINCE 2026-10-26 — THE CLIENT'S SPEC v2
  (`~/Downloads/bezkval-lid-spec (1).md`, checked by its author on the
  portal; `docs/bezkval.md` says where every number comes from). A KIRIM =
  a deal created in Регистрация (#0, `crm_deal_birth`) or moved there from
  «ИИ обработка» (#20, `crm_deal_move`: a TYPE_ID 5 row into #0 whose
  previous row is in #20); Первичка → Регистрация is not one. Its day =
  the history row's (DATE_CREATE) — «Лид тушган сана» is two hours early
  on form leads and is never read. A client = a phone number as the spec's
  4.4 keys it (`phoneKey`: local nine digits, a foreign number whole), tied
  by union-find as before — the deal's own «Телефон ракам» always beside the
  contact's (the etalon counts that way: 23.10 on the portal 1 232 vs 1 250). Its ROP = the MAIN (earliest) deal's: «ROP KVAL
  LID» → «РОП (Первичка)» → the owner's «(ROP)» team (each person: the
  team they head, else sit in — `bezkvalPersonRopSql`); none → «Taqsimlanmagan»
  when the owner is the desk (portal users 10 and 1), else «Регистрация
  boʻlimida» (`bezkval_client.bucket`). Yangi / Takror 30 kun / Takror eski
  = no earlier non-HR deal of any contact holding the number / the latest
  within 30 days / older (`bezkvalHistorySql` — one GIN probe per number;
  the array form scanned every contact). «Kval» = Первичный отдел births by
  client, stored beside (`kval_client`), never in безквал. The day card
  (`BezkvalDayCard`): 7 cards (Kirim · Bezkval · Yangi · T30 · T eski ·
  Taqsimlanmagan · Kval), the ROP table with the head's name and the two
  buckets, sources, «Kirim turi», hours, 30-day trend; every number opens
  its clients (masked to the last four digits, a link to every deal, the
  earlier deal of a repeat) with «Excel» (CSV). The paragraphs below are
  its history.
  «БЕЗКВАЛ» IS STORED SINCE 2026-10-24: the sync worker counts each day
  (`bezkvalRefresh.ts`, today every 10 min) into `bezkval_client`, and every
  screen below reads those rows — the card prints «Hisoblangan: …».
  «БЕЗКВАЛ» SINCE 2026-10-22 — THE CLIENT'S WRITTEN SPEC
  (`~/Downloads/bezkval-lid-spec.md`), `domain/registration/bezkval.ts`;
  everything below in this paragraph is its history. A lead = a deal born
  in Регистрация (#0) / Первичный отдел (#12) (`crm_deal_birth`) or standing
  in one now (the user, against the spec's letter: an «ИИ обработка» deal
  moved into Регистрация counts — 21.10: 102, 51 with a ROP), every stage,
  «Дубликат (лид)» too. Its day: creation, or «Лид тушган сана» when «Как
  поступил лид» names Lead Guard (21.10: 373 of 2 816, most the evening
  before). A client = a phone number (last nine digits, nine equal digits
  refused), every number of a contact and a contact named by two deals tied
  by union-find; no number → the deal's «Телефон ракам» → `c:<contact>` →
  `d:<deal>`. One client a day = one безквал. Its ROP = the first ROP its
  deals of the day were handed to, by time — «ROP KVAL LID», else «РОП
  (Первичка)», the person's team if they head one, else the ROP team they
  sit in (since 2026-10-24 — not their own name, which made rows of
  «Дониёр Рустамов», «201 Ruxshona»), else that deal names no ROP (the
  user's reading of «birinchi berilgan ROP», 2026-10-22); none →
  «Tarqatilmagan». A change to these rules bumps `BEZKVAL_RULES` and the
  worker counts every stored day again. The owner / seller / hand-over guesses are gone. Live
  check 21.10 on the portal: 2 816 deals in Регистрация by DATE_CREATE, 2 372
  numbers (the spec's own measure, exact); the new rule 2 922 leads → 2 398
  clients, 873 «Tarqatilmagan», 11 with two ROPs; new in 30 days 1 791, new
  outright 1 531 (findbycomm + the contacts' earlier deals). Every bezkval
  screen reads it: the month grid, «Guruhlar», /rnp. The day card «Bezkval
  lidlar» (`BezkvalDayCard`, `/registration/bezkval` + `/clients`, under the
  grid) adds «30 kunda yangi» / «Butunlay yangi» (`bezkvalHistorySql`: a
  number's contacts through `customer_phone_nines_idx`, HR out), ROP /
  source / hour / 30-day trend, and every number — the grid's cells too —
  opens its clients with their deals and the earlier deal that makes a
  repeat (masked numbers).
  «БЕЗКВАЛ» (2026-10-05, the client: «Регистрациядан ответсвенный РОП
  белгиланганлари»): the portal has no «Ответственный РОП» field — the desk
  makes the ROP the «Ответственный» (ASSIGNED_BY_ID) of the Регистрация deal
  (04.10: Azizbek 275 of 921; Дониёр, the admin and registrars own the rest).
  `bezkvalDaysSql` counts those by creation day and HEADSHIP — plus a
  registrar NAMED «… rop» (only «Davlat imomaliyev 104 rop», measured
  2026-10-05), credited to the ROP unit `department_member` lists them in
  (the user's choice; the other registrars filed in ROP units — Umida →
  Gulzora, Dilafruz → Lola, Sevinch 205 → Saidaziz, the Zextra desk in both
  Asliddin and Sadriddin — stay «ROP belgilanmagan», also their choice).
  2026-10-06 (the client: «ропларни номига нечта сделка ўтаяпти … номига
  ўзгартириб ўтказиб берилаётган»): a deal handed to a ROP stays the ROP's
  after it moves on. Measured that day on the portal (05.10): the desk
  (Дониёр, the admin) opened 780 of the 804 deals ROPs held; a ROP then passes
  some to their own sellers (04.10: 38 with Maftuna's team) and those fell
  out. Bitrix24 REST returns NO «Ответственный» history (`crm.stagehistory`
  is stages only; no timeline list for system entries), so the sync now
  stores `deal.createdByEmployeeId` (CREATED_BY_ID; the night
  `DEALS_BACKFILL` requested 2026-10-06 fills it since 2026-09-01) and writes a
  `deal_owner_change` row whenever a re-read Регистрация deal names another
  owner (`ownerChangesOf`, in one transaction with the upsert; ~1 min
  granularity, nothing before 2026-10-06). The creator FK is NOT VALID on
  purpose (see the migration).
  From 2026-10-07 the portal stamps «ROP KVAL LID» (UF_CRM_ROP_KVAL_LID →
  `deal.ropKvalLidEmployeeId`) on every Регистрация deal: a business process
  on add/update (owner a ROP → that ROP; owner a seller, field empty → the
  seller's ROP head; never rewritten after), the owner-changing robots write
  it too, older deals were filled over the API. It is the client's own rule
  and comes FIRST — so a deal a seller opened for themselves counts for
  their ROP (06.10: 122 such deals); the guesses below are only the fallback
  for rows the sync has not re-read yet.
  The HAND-OUT rule (`leadRopSql`: /rnp «Квал лид сони» and the group
  «квал» rows, Lidlar «Квал», ROP otchet) does NOT read it: back
  on 2026-10-13 to the client's 30.09 filter, «Лид таркатилган сана» +
  «РОП (Первичка)» (its head, then the unit they sit in), every pipeline.
  From 07.10 it read «ROP KVAL LID» first and then the seller's team; the
  desk's WON copy carries that field AND the hand-out day, so a lead was
  counted twice (13.10: Azizbek 39 against the portal's 26), and the field
  named another ROP on ~40% of the day's deals. The user: «eskisiga qaytar».
  `bezkvalDaysSql` order: «ROP KVAL LID»'s team (same head / «… rop» rule) →
  today's owner's ROP (head / «… rop» registrar) →
  a deal someone ELSE opened, now with a seller whose PRIMARY unit is a ROP
  team and who sits in NO non-ROP unit (`department_member`: a registrar is
  listed in Регистрация, so the desk stays out even when filed under a ROP;
  an unknown opener is not counted) → the LAST recorded hand-over to a ROP →
  unassigned — counted once per lead (no «Дубликат (лид)», one phone number once a
  Tashkent day, the first deal's ROP; 2026-10-14). Current owner wins over history, so a ROP→ROP move credits
  the later ROP (the user's example). The month grid's two readings run on
  two clocks — never sum them.
  A person heading two ROP units belongs to the unit they sit in, for the
  leads and the roster alike (2026-10-02, as on «RNP jadvali»).
- **Lidlar** — a section of its own since 2026-09-25 («yangi bir boʻlim ochamiz
  lidlar deb, oʻsha yerga koʻchiramiz lid kogortasini ham … Sotuv ROP ni ham»).
  Migration `20260925120000_leads_section` grants `leads` to every account
  that held `marketing` explicitly, so nobody lost a tab in the move; the
  role default gained `/leads` beside `/marketing`.
  **«LID MANBALARI» WAS BUILT FROM A WEEK READ OFF THE PORTAL** (18–24.09.2026,
  through the read-only Bitrix24 MCP in `~/Work/bitrix24-mcp`);
  `domain/leads/leadSources.ts` carries the numbers. A Meta lead form lands
  in Регистрация as «Ген лид» (`REPEAT_SALE`) titled «Заполнение CRM-формы
  "<form>"» (a title missing its closing quote still names its form since
  2026-10-02 — deal 1038510), and the FORM NAME carries the targetolog («…
  Eldor», «(UMAR) 777», «Kamron …»): the per-targetolog лид / кв лид of the
  client's «Отчёт Т», which the 5%-filled targetolog field never could give. **Only
  Регистрация is read**: the same title is copied onto a Первичный отдел deal
  once the lead is WON (263 of 263), so reading both counts every kval twice.
  Every Instagram conversation is a deal in «ИИ обработка» on the page's
  source — the client's «Кол мурожат», where Meta's conversation count runs
  at about half. `crm.lead` holds only Asterisk call records and is not read;
  UTM_* was empty on every deal.
  **«TARGETOLOGLAR» IS TARGETOLOGS' ROWS ONLY (2026-10-14, the user: «faqat
  targetologlar malumoti turishi kerak»).** A lead's owner is its form name's
  targetolog, then a nameless form that ENDS one named form's name
  (`formTailOwners`), then the deal's «Таргетолог» field (`deal.targetolog`);
  its product is `leadBrand` — no «Проект» on a formless lead is that person's
  «Brendsiz» row (`brandless|…`), so the brand switch stays every screen's.
  Portal 01–14.10: 235 formless «Ген лид», 196 carry the field (181 were
  Eldor's «Sinolife Collagen - 30.04», whose short name a deal retitled
  «Collagen Marine ген лид» made ambiguous); the 39 left are incoming calls the
  desk filed under «Ген лид» and stay «Ген лид · formasiz». «Bogʻlanmagan
  sarf» is no row: each account's DM / other ad money is its owner's
  «DM / boshqa sarf» column (`unlinkedUsd`). «Yetib keldi» counts form leads
  only (`formlessLeads` out), on the table and on «Лид назорати».
  **A LOW «Yetib keldi» (Bitrix24 lid ÷ Meta lid) IS THE FINDING, not a
  fault of the screen**: that week Collagen Eldor's «IF-15.01» campaigns and
  Umar 63's campaigns created from 21.09 on had no Bitrix24 deals at all —
  forms not linked to the portal — while linked forms ran ~80%. Company-wide.
  The UI was read on a throwaway copy DB with synthetic deals; the figures
  were NOT compared against production after deploy.
- **Lid kogortasi** (a tab of «Lidlar»; of «Reklama samarasi» until 2026-09-25) — added 2026-09-24 from
  the client's written spec («Lid tushgan kuni bilan tarqatilgan kuni
  o'rtasidagi bog'liqlik»). FIVE NEW DEAL COLUMNS: `leadArrivedAt`
  (`UF_CRM_1789453947`), `leadDistributedOn` (`UF_CRM_1770642221743`, a DATE —
  `calendarDate()` takes the date part as written), `aiQualifiedAt`,
  `leadRopEmployeeId` (the «РОП (Первичка)» user, resolved like `employeeId`)
  and `repeatLead` (BOUGHT / PROCESSING / OTHER from «Такрор лид», null =
  new). Only pipelines 12 / 4 / 6 by `pipeline."externalId"`. **ONE LEAD IS UP
  TO THREE DEALS** — the portal copies the fields on to Тасдиклаш and
  Доставка — so `foldLeads` keys on (customerId, arrival instant) and takes
  the EARLIEST distribution day; a deal with no contact is its own lead. The
  table starts at `LEAD_COHORT_START` (2026-09-14, when the portal began
  filling the field); older arrivals and deals with no arrival are counted
  under the table, never in it. The deals are memoised per window for FIVE
  minutes (the client asked for 5–10); pipelines and ROP filter the memoised
  rows. Backfilled by `DEALS_BACKFILL` (since 2026-09-13). Company-wide. The
  field formats were taken from the spec, NOT read off the live portal — the
  local webhook was revoked — so check one day against Bitrix24 after deploy.
- **Лид назорати** (a block of «Lidlar», 2026-10-09) — what is WAITING right
  now, where every other screen counts what happened: seven checks, always all
  seven on the wire, each `ok` / `warn` / `critical` with its rows (longest
  waiting first, capped at `maxRows`, `count` the real one), and the working
  day's intake by hour. **No period, no brand, no scope**: always today in
  Tashkent, company-wide (`analytics:read:all`, section `leads`), so ONE
  snapshot is memoised 60 s (+4 min stale-while-revalidate, a warmer every
  2 min in `WARM_HOURS`) and `/leads/watch/summary` — the sidebar badge —
  reads the same memo; a badge cannot disagree with its page.
  **EVERY THRESHOLD IS IN `src/lib/leadWatchSettings.ts`** (the client: «barcha
  chegaralar bitta sozlamalar faylida»), read by the server and the page; the
  domain takes it as an argument (`domain/leads/leadWatch.ts`, pure, every rule
  with its reason). A row is a problem STRICTLY past `warn` minutes and red AT
  `critical` minutes. The population of every deal check: Регистрация deals
  created today, OPEN, not «Исход» (by `leadChannel` — a form wins over its
  source); channel = `leadChannel` folded to five (form + manual → «Ген лид»,
  page + smm → «СММ»); brand = `leadBrand` (form name, then «Проект»), nothing new.
  **PORTAL FACTS IT RESTS ON** (read-only MCP, 2026-10-09):
  · `voximplant.statistic.get` links a call to the CONTACT, almost never to
    the deal, and PORTAL_NUMBER is `REST_APP:64` on every row. So «no call» is
    no call on the deal OR its contact since the deal was created — an
    OUTGOING attempt counts, answered or not, and any call that connected;
    the customer's own unanswered ring does not (it is the lead asking
    again) — and a missed call's brand is the caller's latest deal's
    — «liniya aniqlanmadi» when there is none; the line itself is unreadable.
  · «Чат с клиентом» on the kanban is `crm.activity.list` with PROVIDER_ID
    `IMOPENLINES_SESSION`, COMPLETED N, OWNER_TYPE_ID 2. 29 460 such open
    activities; 815 of a day's 826 had RESPONSIBLE_ID 1 (the NEXTBOT bot) —
    never read. With a DATE in the filter a page took 12–16 s; with an ID
    floor, `start: -1`, ID ASC, 1.0 s. So the window is an activity ID.
  **THE TWO FEEDS** (`sync/leadWatchFeeds.ts`, run by the worker every
  `refreshEveryMs` after the tick — never during `CALM_TICKS` or with the gate
  shut, each in its own try): recent CALLS through `fetchCalls` +
  `engine.persistRecords('CALLS')` (the ordinary mapping; 10 min overlap, a
  70-minute settle read twice an hour so a long call does not stay «missed»;
  a database's FIRST pass is such a settle read, not the whole day — the
  reference pass holds the rest; the walk stops between pages when the worker
  is stopping; no `sync_log` row — CALLS / BACKFILL settles the one-off
  re-read), and the OPEN CHATS into `open_line_chat`, REPLACED each pass (a
  failed read wipes nothing; more than max(10, half) gone at once is held ONE
  pass, then believed; an EMPTY answer over stored rows is never believed
  alone — one control read without `!RESPONSIBLE_ID` (`anyOpenLineChat`):
  rows there, the lines are visible and the table is emptied; empty there
  too, the pass FAILS and nothing is wiped — an empty list is also what a
  webhook user who lost the open lines gets). A feed's failure is stored and
  printed through `describeFeedError`: the provider's redacted errors as they
  are, anything else as class + code + one struck-out line. The chats' floor is the portal's newest activity id noted hourly
  and used a day later; the one dated read (`firstActivityIdSince`, cost NOT
  measured) is sent once in a database's life — `dated` is saved before it is
  asked — and falls back to the head. Ordinary pass: 2 requests / 3
  invocations, pinned by `tests/integrations/leadWatchFeeds.test.ts`; ~175
  invocations an hour. `lead_watch_sync` keeps both clocks; `dataAsOf` is the
  oldest of them and the deal sync, null if one never ran.
  **NOT `unansweredCallers`** for the missed calls: that list is «never got a
  second of conversation today», so a client answered at nine and missed at
  eleven is not on it; `missedCallers` walks each number's calls in time
  order (a later answered call or ANY outgoing call ends the wait; two
  records of one instant are read unanswered first, so a ring with an
  answered and an unanswered leg is not left waiting).
  **«Канал стоп»** = a form / SMM page silent `silentMin` in working hours
  (counted from its last lead or the START of the working day, whichever is
  later — a lead at 02:30 is not 390 minutes of silence at 09:00) where that clock hour averaged ≥ `usualPerHour` over 7 days (late «Qayta
  zayavka» copies left out of both sides), plus «Yetib keldi» from
  `targetologForms` over yesterday + today. **«Notekis»** reads
  `buildLeadSplit`'s own numbers; its average is over teams IN PLAY (a lead
  or a share today), not the nine always listed, and a team is a row only
  when it is also `minDiffLeads` (5) LEADS off — plan 3 / received 5 is +67 %
  and no problem. The page's timers are neutral on the three cards with no
  warn/critical pair (`waitThresholds` → null), never another card's colours.
  **MEASURED ON THE PORTAL, 2026-10-09 (778 Регистрация leads that day):**
  «РОП (Первичка)» — the field the spec names for `unassigned` — was empty
  on ALL of them (it is stamped on the Первичный отдел deal), so
  `rop_assigned` is «РОП (Первичка)» OR «ROP KVAL LID» (474 of the 778).
  «First stage (NEW)» held 15 leads: the portal files a new lead under «Лид
  новый (лид)» / «Веб-сайт (лид)» / «Сммшик (лид)», so `idle` reads the four
  `REGISTRATION_INTAKE_STAGE_IDS`. «Дубликат (лид)» is parked, not waiting —
  never a problem row, still in the flow. A row's CHANNEL is the tile «Lid
  manbalari» counts the lead on (`leadTile` over `LEAD_TILE_SOURCES`, the
  client's SOURCE_ID list of 2026-10-09), so «Исход» is out by source alone. Service checked on a throwaway DB
  with synthetic rows, NOT against production.
- **Savdo dinamikasi** — **stripped to FAKT 1 / FAKT 2 on 2026-09-10**, on the
  client's instruction («bu boʻlimda koʻp malumotlar ortiqcha boʻlib ketgan…
  menga bu boʻlim fakt 1 va fakt 2 va bitrix24dan»). Gone: the «Yopilgan
  tushum» hero figure and its composition line, «Yopilgan bitimlar boʻyicha»,
  «Savdo pulsi», «Bosqichlar qamrovi», «Mahsulotlar boʻyicha», «Manbalar
  boʻyicha» and the bonus ladder. What that bought is the reason to keep it
  that way: the screen had SEVEN requests on THREE clocks and now has two on
  one, so nothing on it can disagree with anything else on it. Re-adding any
  closedAt figure re-adds the reconciliation prose with it.
  `/analytics/sales`, `/insights/flow` and `/insights/pulse` lost their last
  caller with those blocks and were **deleted on 2026-09-10** in the callerless
  sweep below, along with their services. The URL `/analytics/sales` is still
  the SCREEN's address; only the endpoint of that name is gone.
  **The one block on that screen with a different clock is the Доставка board**,
  and it is deliberate: `/insights/delivery` takes a period and uses none of it,
  because the client reads these columns beside the portal's own kanban, where
  an order that arrived in June and is still in VODIY is in VODIY today. Two
  traps live in that one query and both print a plausible board rather than an
  error — the dashboard filters must ride the LEFT JOIN's ON clause (moved to
  the WHERE they delete every empty column) and the count must be
  `count(d."id")` (an outer join makes `count(*)` print 1 for an empty one).
  `tests/http/deliveryBoardSql.test.ts` pins both, and every stage name is
  printed VERBATIM in Russian — the block's whole value is that it reconciles
  against the screen it was copied from.
  **«PROGNOZ» — THE RUN-RATE AT EVERY LEVEL THE BOARD REPORTS, since
  2026-09-16.** Asked for by the client for FAKT 1 and FAKT 2 together, for the
  company, each ROP team and each seller. What existed before was ONE
  projection — of FAKT 2, for the company — behind one tile on the queue band,
  and `forecast.projected` is now `forecast.fakt1` / `forecast.fakt2`, the
  singular REMOVED rather than kept beside the pair for the same reason
  `restrictToEmployeeId` was.
  **IT COSTS NO REQUEST, NO ENDPOINT AND NO SQL.** A straight-line run-rate is
  `money ÷ elapsed fraction` and that fraction is ONE number for the whole
  screen, so every figure — 126 sellers, fifteen teams, the company — is
  arithmetic over rows already on `/analytics/sellers`. `ForecastSection` reads
  `useFaktBoard`, the same cache entry the hero and the FAKT band read, which
  is what makes it unable to disagree with the figures above it. The page still
  makes its two requests.
  **THE HORIZON IS THE SELECTED PERIOD'S OWN CALENDAR UNIT.**
  `projectionElapsedFraction` → `fullUnitWindow`, never the report window: a
  to-date preset is by construction nearly spent, and «Shu oy» on the 9th read
  94.4% and projected FAKT 2 forward by six percent. A finished preset passes
  through with an elapsed fraction of 1 and the block SAYS «davr yakunlangan»
  rather than printing a total under a forecast heading; below
  `PROJECTION_ELAPSED_FLOOR` (2%, ~the first fourteen hours) it says «erta».
  **NULL IS NEVER A ZERO, and on this cohort that is not a nicety** — delivery
  lags the arrival it is projected from by about two days, so «0 soʻm» in a
  column headed «prognoz» tells a floor that is working normally that its month
  ends at nothing. Every projection column prints an em dash instead.
  **A TEAM IS PROJECTED FROM ITS OWN MONEY, not from its sellers' projections
  summed.** Identical under a straight line, and the reading that stays true to
  what the column is asked the moment the rule grows a floor or a cap.
  **THE CHART RUNS PAST TODAY, DASHED, AND THE BUCKETS RIDE THE BOARD RATHER
  THAN `faktTrend`.** Appended to the trend they would reach
  `ConfirmationOutcomeSection`, which reduces the confirmation rate over every
  point it is handed and cannot tell a projection from a measurement — the rate
  would have been dragged towards zero with nothing on screen saying so. Three
  things in that continuation print a plausible chart rather than an error and
  all three are pinned: the granularity is `chooseGranularity(ctx.period)`
  passed in EXPLICITLY (the default would take it from the full unit — on «Shu
  yil» in February that is 46 days against 365, one either side of the 62-day
  threshold, so six weekly dashes would continue forty-six daily points); only
  buckets starting at or after the report window's end are drawn, so today's
  half-elapsed bucket is never drawn twice; and `spreadRemainingMinor`
  distributes the truncation remainder, so the dashed area sums to EXACTLY the
  tile above it. `tests/services/sellerForecast.test.ts`,
  `tests/features/faktTrendRows.test.ts`, `tests/domain/spreadRemaining.test.ts`
  and `tests/features/salesForecast.test.tsx` are what hold all of it; each was
  checked by mutation.
  **IT IS A PACE RESTATED AND NOTHING MORE.** No weekday shape, no holiday, no
  portal outage, no allowance for the FAKT 2 lag. Every projected figure is
  printed beside what has actually landed and the block names the method and
  the horizon in its first sentence, which is the only thing that makes the
  numbers safe to quote.
  **«TASDIQLASH NATIJASI» SITS DIRECTLY UNDER THE HERO, since 2026-09-15**
  («tasdiqlanganlar, tasdiqlanmay chiqdilar bilan tasdiqlanmaganlar nisbati…
  oʻrtachasi»). It is the hero's «navbatda jami N ta» opened up: the queue's
  FIVE states as a partition of the cohort — count, share and money each —
  the «Тасдиқланиш %» figure, and that rate day by day with the period's rate
  dashed across it. **It adds NO request.** The partition is `totals.outcomes`
  on the board `useFaktBoard` already holds, and the daily line divides
  `byOutcome` counts riding on the same `?include=faktTrend` points the FAKT
  chart draws — so the screen is still two requests to one endpoint and the
  block cannot disagree with the figure above it. Both come from the same
  `ratingSql` / `faktTrendSql` statements as FAKT 1 (five `state_*` columns
  beside it, `null` on `basis=intake`), pinned by
  `confirmationSellerRatingSql.test.ts` and `confirmationFaktTrendSql.test.ts`.
  **SHARES ARE OF THE COHORT, NEVER OF FAKT 1** — the Тасдиқлаш board divides
  by everything that entered, and a reader carries the number between the two
  screens. **The dashed «davr oʻrtachasi» is the POOLED rate**
  (ΣТасдиқланди ÷ Σcohort, the queue board's own `Math.round(x·1000)/10`),
  not the mean of the days: a Sunday with three orders at 100% weighs a
  thirtieth of the month in one and a thousandth in the other, and one screen
  carries one figure under that name — the same one the tile prints.
  `faktTrendSql` LOST ITS `HAVING` for this: a day whose every order was
  refused is a 0% point on the rate line, not a gap, and the FAKT chart never
  needed the gate (the service zero-fills every bucket). Measured on
  production for August 2026: 3 222 entered, 2 873 Тасдиқланди (89.2%), 331
  Тасдиқланмади, 17 Тасдиқланмай чиқди, 1 still queued. Per-ROP was offered
  and DECLINED («faqat kompaniya boʻyicha») — do not add the columns unasked.
- **Sverka** — added 2026-10-06 («bitrix24 bilan moy skladni solishtiramiz …
  mahsulot … fakt 2 va fakt 1»). MoySklad is a SECOND SOURCE read directly:
  `importMoyskladOrders` (`src/server/integrations/moysklad`, GET only — the
  token can write) fills `moysklad_order` / `moysklad_order_item` from the
  worker every `SYNC_MOYSKLAD_EVERY` ticks (3), off without `MOYSKLAD_TOKEN`;
  every 10th read also sweeps deleted orders (refuses on a short listing or
  > max(50, 5 %) gone). By hand: `npm run moysklad:import [-- --sweep]`. The
  first, whole-table read is ~100 pages, ~6 min (measured 2026-10-06: 9 777
  orders, 20 671 lines). **The two systems meet on the DEAL ID** — the
  client's integration writes «ID сделки в BX» (and `code` «bx…») on every
  order — never on a name or sum. **MoySklad's dates are Moscow time with no
  offset** (+03:00, checked against a deal's portal timestamps). **Products
  meet on CODE**: Bitrix24 XML_ID (`product.sku`) = MoySklad `externalCode`;
  a deal sells trade OFFERS («Sinolife collagen marine kakao», 676), which
  carry no XML_ID, so the reference pass now stores `product.parentExternalId`
  (catalog offers block only) and the comparison reads the parent's sku.
  Tolerances were read off 357 real orders (01–05.10): a sum differs only by
  ≥ 1 soʻm (MoySklad keeps a discounted line's kopeck), sellers compare
  trimmed and case-folded (24 trailing spaces). An order with no MoySklad
  order is MISSING only past the warehouse — «Подготовка товара» / «Заказ в
  мой склад» are `pending`. That first read found, for the record: 6 orders
  «В пути» in MoySklad whose deal sits in Первичный отдел · Тасдикланмаган,
  1 sum difference (1071484: an extra Sedana line in MoySklad), 1 seller,
  19 orders with no deal id, 11 deals with two orders. Company-wide.
  Checked end to end on a throwaway DB (real MoySklad + those 357 deals'
  real stages/sums), NOT against production.
  **2026-10-06 afternoon («eng kerakli maʼlumotlarni solishtir … farq
  boʻlimiga toʻliq»)**: two more issues, REGION (deal «Регион» against the
  order's «Регион», through `regionKey`'s fourteen regions and their
  spellings — an unknown spelling is never a difference, bare «Ташкент» is
  either Tashkent) and ROP (`operatorTeamSource` against a «…(ROP)» project,
  x/kh folded to h). The panel's ✓ for region/team comes from the server
  (`regionMatch` / `ropMatch`), never from two non-empty strings. Each chip
  carries the soʻm at stake (`issueAmounts`: the gap for SUM, the order's
  money otherwise — not summable across chips); each line its gap
  (`diffAmount`), the products it differs by (`productDiff`), a duplicate's
  other orders, MoySklad's payed/shipped. Search + TSV copy over the list.
  The region/ROP vocabularies were NOT measured on production MoySklad rows
  (no local data then) — if a chip reads high, read the pairs first.
  **THREE MORE CHIPS — 2026-10-20** (the 2026-10-17 audit's findings, the
  owner: «3 tasini qoʻsh»): `PULLED_BACK` — the deal is back in Тасдиклаш
  (C4) or Первичный отдел (C12) while MoySklad's order is «Новый» / «В пути»
  / «Ожидание / нд» (a returned order is no difference); `PAYMENT` — «Касса»
  short of its sum or «Успешно» paid in full, MoySklad against itself, the
  payment summed over the deal's orders as Kassa sums it; `NOT_SHIPPED` —
  «Успешно» / «Касса» with shipments short of the sum. Measured off MoySklad
  01–19.10 (1 535 orders by `moment`, read-only, + the moving orders' deals on
  the portal): 3 / 5 / 4 orders. Each leaves «Toʻliq mos» and shows on
  /kpi's «Bitrix24 ↔ MoySklad» card. The fourth finding, the counterparty
  phone, needs a column and was not built.
  **«Mahsulot farqi» IS RE-READ BEFORE IT IS BELIEVED (2026-10-15)** — the
  client over 1050902 / 1052240: «−1 Omega Sinolife 500» where the portal and
  MoySklad agreed. Both deals lost an Omega row on the portal on 2026-10-06,
  were re-read before DEAL_ITEMS learned to drop unlisted rows (99e25969), and
  were never modified again, so the stale row stayed. After a MoySklad read,
  hourly (`SYNC_PRODUCT_RECHECK_MIN`), the worker hands every deal whose
  stored rows fail `sameProducts` against its newest order and were last read
  over a day ago (`deal_item."updatedAt"`, which every read rewrites; orders
  of the last 120 days, at most 200 deals a check, none asked twice a day) to
  the line-item read — `productCheckRows` → `productRecheckRows` →
  `provider.requestDealItems`, 20 STORED LINES a tick (not deals: a
  reconciliation past `surplusLineLimit`, 25, deletes nothing). While the list
  is non-empty that is ≤ one `crm.deal.productrows.get` per deal, ~10 a tick.
  A difference that survives is the portal's.
- **Mijoz qaytishi** — **REWORKED ON 2026-09-15**, on the client's instruction
  («kogorta jadvalini … kuchaytirish … oddiylashtirish kerak, mijoz qaytishi
  boʻlimini toʻliqligicha yaxshilash»). Three things changed and each fixed a
  reading, not a look.
  **THE MATRIX DEFAULTS TO CUMULATIVE.** «Jami qaytgan» — of this cohort, how
  many have come back at least once BY month N — with «Oylik», the old
  per-month reading, one press away. Measured on production: monthly repeat
  purchase here runs **0–4%**, so ~250 cells landed in the two palest steps of
  a five-step ramp and the grid said nothing; the same customers read
  cumulatively run **0–37%**. It is NOT derivable from the monthly cells — a
  customer returning in +1 and again in +3 is in two of them — so the
  repository counts each returner's FIRST return month (`first_return` →
  `first_offsets`, emitted as a third `is_total = 2` UNION arm — see the 566 ms
  note below for why it is an arm and not a join) and the service runs a total
  over it. That CTE replaced the old `count(DISTINCT customer_id)` rather than
  joining it: a count(DISTINCT) already groups by customer inside each cohort,
  so this is the same work with the month kept. **The identity to check:** a row's last measured cell equals
  its «Qaytgan» share, because the increments sum to `returned` by
  construction. The cumulative reading drops the `0` column (100% monthly, 0%
  cumulatively, for every row there has ever been) and has its OWN colour bands
  — 0/5/10/20/30 against the monthly 0/2/4/7/12, since one ramp cannot carry
  both scales. `tests/components/cohortMatrix.test.tsx` pins both readings and
  the double-count that would send the curve past 100%.
  **A «Jami · oʻrtacha» CELL UNDER `SUMMARY_MIN_BASE` (30) IS PRINTED BUT NOT
  PAINTED**, found on production hours after this shipped. That row read
  4 7 9 10 11 11 12 12 13 13 14 19 27 36 **0** — every figure correct, and
  together a cliff. Each column averages only the cohorts old enough to have
  reached it, so the far right is one or two ancient cohorts and the last
  column was ONE cohort of ONE customer who never returned. On the ramp beside
  fourteen real averages that reads as a collapse in retention. Same floor and
  same argument as Logistika's `WAIT_BAND_MIN_ORDERS`; the figure and its
  fraction stay, the colour and the trend do not.
  **THE GRID OPENS ON TWELVE MONTHS, AND IT IS ONE FIELD RATHER THAN 250
  CHIPS** — 2026-09-15, a second pass on the same instruction («kogorta
  jadvalini … tushunarliroq … soddaroq»). The query asks for eighteen months of
  cohorts, so the table drew up to nineteen columns and only the oldest cohort
  had cells in them: the right half was hatch a reader scrolled sideways
  through. `months` on `CohortHeatmap` (12 by default, «6 oy / 12 oy /
  Hammasi» beside the reading switch) is counted as an **offset, not a column
  count** — cumulative drops the `0` column and monthly keeps it, so a window
  counted in columns would end on «+12» in one reading and «+11» in the other
  under the same label. With the window on, the month columns FLEX between
  `W_MONTH` 44 and `W_MONTH_MAX` 72 so the matrix still fills its card; the
  three pinned columns keep fixed widths because every sticky `left` is a whole
  sum of them, and the hover panel now clamps against the table's MEASURED
  width rather than that minimum. The tiles meet — `GRID_LINE` draws the
  separation as a hairline in the card's own colour and `crosshair()` lights the
  hovered row AND column across the grid, which is what makes «2025-avg × +3» a
  cell anybody can find. The per-cell «%» is gone (the column group already
  says «…ulushi, %», and each cell's `aria-label` still states the figure as a
  percentage), and «Qaytgan» prints the SHARE alone — «117 · 3%» was two
  numbers in two formats in one right-aligned column — with the distinct count
  moved to that cell's `aria-label` and to the row's hover panel.
  **THE IDENTITY ABOVE IS WINDOW-DEPENDENT.** «A row's last cell equals its
  «Qaytgan» share» is true of the last MEASURED cell, never of the last DRAWN
  one, so a truncated grid would have a reader compare a twelve-month figure
  against an eighteen-month one and find the table contradicting itself. The
  legend swaps that sentence for the caveat whenever `truncated` is set.
  **«База» IS FOUR STATES, NOT FIFTEEN STAGES.** The card drew one bar per
  portal stage under copy promising «1 kun, 3 kun, 10 kun, 20 kun, 30 kun» —
  five of the fifteen; the other ten were never named. The partition is
  `src/lib/retentionGroups.ts` (Yangi / Aloqa siklida / Faol mijoz / Sovigan),
  keyed by **stage id** and read by BOTH sides exactly as `logisticsBuckets` is.
  Every level is its own `count(DISTINCT customerId)` under one `GROUPING SETS`
  — stage, group, funnel — because a customer on two stages of one group is one
  person in it, and summing the level below is how this screen once printed a
  base 1 660 people too big. The four still **do not** add up to the base
  (one customer, two open deals, two states) and the card says so rather than
  presenting them as parts of a whole. An unmapped stage becomes its own
  «Boshqa bosqichlar» row; `tests/domain/retentionGroups.test.ts` and
  `tests/http/retentionStagesSql.test.ts` pin the partition and the statement,
  and `tests/features/retentionStateBars.test.tsx` renders the card — the demo
  seed has no RETENTION pipeline at all, so production is the only place the
  bars have ever drawn.
  **«Faol bazada» LEFT THE TILE ROW**, where it read «12 558» beside «Jami
  mijozlar 11 512» — two numbers contradicting each other on their faces
  unless the reader already knew one counts База deals and the other counts
  first purchases. It is stated on the База card now, over its own denominator.
  Still a separate DISTINCT-customer total, never the sum of the bars.
  **AND THE PERIOD CONTROL IS GONE, because it drove nothing.** The matrix
  needs the whole history, the База bars are today's snapshot — so the only
  thing the control reached was `/insights/concentration`, which inherited the
  dashboard default of «Bugun». Read on production 2026-09-15 that gave the
  band **12 customers, ONE first-to-second pair and a cohort of four**, under
  «Top-10 mijoz ulushi 89%» painted critical red. Every figure was
  arithmetically correct and the band as a whole was noise. The endpoint now
  resolves its own trailing 90 days (`trailingDays` in `period.ts`; `days` is a
  parameter, wired to no control), and the four tiles refuse to print at all
  under `MIN_CUSTOMERS` 30 / `MIN_PAIRS` 10 / `MIN_COHORT` 30 — low on purpose,
  to catch a day's trading rather than a quiet fortnight.
  **THE MATRIX IS THE FIRST THING ON THE PAGE, AND «ODDIY» IS GONE —
  2026-09-16, on the client's instruction («kogorta jadvali tepaga chiqarish
  kerak va oddiy degan narsa kerak emas»).** The screen carried TWO renderings
  of one fetch: «Oddiy» (`SimpleView` — three questions in sentences and
  shapes) and «Batafsil» (the matrix and the bands under it), chosen by
  `?mode=`. Both are removed, the toggle with them, and the matrix now opens
  the page with nothing above it.
  **WHAT WENT WITH THE MODE, because it had no other reader.**
  `SimpleView.tsx`, `ReturnAnswer.tsx` and `ArrivalBars.tsx`; the mode half of
  `useCohortMode.ts`, whose file is now `useCohortRop.ts` and carries the team
  cut alone; five test files (`cohortSimpleMode`, `cohortAgreement`,
  `cohortArrivals`, `cohortReturnAnswer`, `cohortMode`); and THREE DTO FIELDS
  — `currentMonth`, `revenueTotalAll`, `revenuePerCustomerAll` — which
  «Oddiy» was the only reader of, in BOTH mirrors. Net **−2 100 lines**.
  `currentMonth` is still COMPUTED on the server (it is the horizon every
  row's `ageMonths` is measured from); it simply no longer travels, and the
  statement underneath is unchanged.
  **FIVE EXPORTS IN `Heatmap.tsx` BECAME INTERNAL** — `columnAverage`,
  `MIN_COHORTS_FOR_AVERAGE`, `sharePercentText`, `columnMoneyAverage`,
  `multipleText` and their three types. Every one was exported for
  `ReturnAnswer`, so that «Oddiy»'s milestone and the grid's summary row could
  not drift apart. With one reading left there is nothing to keep in step, and
  an export with no importer is an invitation to build a second reading again.
  **AND BOTH QUERY GATES WENT.** `/insights/concentration` and
  `/insights/customers` were `enabled: mode === 'detail'`, which earned its
  place while most visits never opened the analyst's view. Every consumer is
  now drawn on every visit, so the gate would be a condition that is always
  true. **The keys stay literals**, and that is the half of
  `cohortStale.test.tsx` that survives: no query here is disabled any more, but
  `providers.tsx` still applies `placeholderData` on any KEY CHANGE, so giving
  one of these reads a moving key puts the latch one `enabled` away from
  being reachable again. That file's DOM cases were rewritten rather than
  deleted — the page must still never be dimmed — and its source pins kept.
  **ONE TEST WAS DELETED RATHER THAN RE-POINTED**: the «izoh» tooltip audit in
  `cohortExplains.test.tsx`. Every tip it checked lived in «Oddiy»; the one
  tooltip left is `RepeatShareCard`'s, which is not in that set, and the
  deleted test's own comment says asserting over an empty set is vacuous.
  **AND ITS `openPage` NOW WAITS ON «Jami · oʻrtacha», NOT ON A CARD TITLE** —
  the title renders before the fetch resolves, so waiting on it would let every
  assertion race the data and fail as «the page does not say this».
  **«YETKAZILGAN» AND «YOPILGAN (WON)» NAME THE SAME EVENT.** A deal becomes
  WON the instant it reaches Успешно, which is the instant Logistika would
  call it delivered; there is no second clock here and an earlier comment
  claiming a 20–25 day gap between the two was wrong (that gap is real, but it
  is order→delivery, and every figure on this screen already sits on the
  delivery side of it). **What does not reconcile against Logistika is the
  DENOMINATOR**: Logistika counts ORDERS that arrived in a bounded C4:NEW
  window, this counts DISTINCT CUSTOMERS by their first purchase over all
  history. A customer with three orders is one here and three there, and a
  customer whose first order predates the window is here and not there. That
  is said to the reader once, in `cohort-total-hint` under the tiles; pinned by
  `tests/features/cohortExplains.test.tsx`.
  **`cohorts()` IS DELIBERATELY UNSCOPED, and that is a business fact, not an
  oversight.** The route declares `analytics:read:all` and the repository
  method takes `{ months }` and nothing else — no `restrictToEmployeeIds`
  reaches it. A customer's purchases are spread across whoever happened to
  answer the phone, so a per-seller retention curve would be measuring which
  seller's colleagues sold to their customers. There is no correct narrowing,
  which is why the endpoint refuses a narrowed account outright rather than
  answering it with a number. See *Which endpoints admit a narrowed account*
  above — cohort is in the still-refusing list, and it belongs there.
  **TWO IDENTITIES A READER CAN CHECK WITHOUT LEAVING THE TABLE.** A row's
  last MEASURED cumulative cell equals that row's «Qaytgan» share, by
  construction: the curve is a running sum of `firstReturners`, each returning
  customer walked in exactly once, advanced only inside the row's reachable
  span. And the matrix footer's money is its own column summed and nothing
  wider — the grid's own `months` prop bounds COLUMNS, so the figure does not
  move under the 6 / 12 / Hammasi control. Both were re-measured against
  production on 2026-09-15 and held on every cohort.
  **«MIJOZLAR OQIMI» IS MOUNTED — 2026-09-16.** The endpoint, the service, the
  three repository statements, `src/lib/customerStates.ts`, `CustomerFlowChart`
  and two test files had all shipped on 2026-09-15 and **nothing rendered
  them**: the screen was one `useQuery` and a band away from the work being
  finished. Four tiles, the new-vs-returning chart, sources and today's
  silence, directly under the matrix.
  **IT INTRODUCES THE SCREEN'S SECOND CLOCK, and both are named out loud.** The
  band dates a customer from the day they ORDERED (`createdAtSource`);
  everything below dates them from the day their first order was DELIVERED.
  «Kogorta tahlili»'s hint gained «Yetkazilgan sana boʻyicha» in the same
  change. The two customer totals differ on purpose and **must never be
  summed**; unlabelled, they read as one of them being broken, which is the
  first conclusion a reader reaches and the one nothing else corrects.
  `cohortExplains.test.tsx` pins both sentences present at once.
  **IT RESOLVES ITS OWN NINETY DAYS, server-side**, exactly as
  `/insights/concentration` does and for the reason that route records: the
  period control was removed on 2026-09-15, and an endpoint wired to a control
  that does not exist is how the sibling came to report twelve customers under
  a critical-red gauge. The span is printed from `meta.period`, not from the
  literal 90, so changing the default moves the sentence with it.
  **ITS KEY IS A LITERAL, AND THAT IS THE HALF THAT STILL MATTERS.** It
  shipped `enabled: mode === 'detail'` and lost the gate hours later with the
  mode; every consumer is on the page unconditionally now. The literal key
  stays, because `cohortStale.test.tsx` exists for the hazard a CHANGING key
  creates: `providers.tsx` gives every query `placeholderData`, which
  query-core applies with no `enabled` check, so `isPlaceholderData` latches
  and nothing clears it. That file's source pin names this key too, and
  `stale=` is still absent from the page.
  **THE BAND CARRIES SOʼM, NOT A THIRD «TAKRORIY TUSHUM ULUSHI»** — a
  deliberate departure from the plan, which asked for a gauge there. That label
  was already on this screen TWICE (whole history, and `RepeatShareCard`'s own
  ninety days), and two was only acceptable because each names its own SPAN; a
  third reading «soʻnggi 90 kun» would have put two ninety-day repeat shares,
  on two different clocks, under one name. «Takroriy xarid tushumi» collides
  with nothing and is the figure that share divides.
  `cohortExplains.test.tsx` pins the count at exactly two.
  **AND TWO PHRASES ARE OWNED BY ONE BLOCK EACH.** «bugungi holat» belongs to
  the База card; the band's silence tile says «davrga bogʻliq emas» instead,
  although it is also a snapshot. `getByText` throws on a second match, which
  is what enforces it. The states block likewise does NOT redraw the portal's
  own four-state verdict — it measures silence from order dates and points at
  the База card rather than inviting a comparison.
  **The sources card is TWO PANELS ON TWO CLOCKS, IN ONE ROW ORDER.** The count
  is the band's ninety days; the repeat rate is the whole history on a fixed
  ninety-day maturity horizon. The lower panel is never re-sorted — what makes
  the pair readable as one answer is that the eye runs down ONE column of
  labels, and sorting it would quietly turn one card into two.
  **STILL UNVERIFIED AGAINST PRODUCTION** — the plan's Task 10 (a probe
  asserting four invariants, then the timing) has not run: this checkout
  cannot reach the database. The statements themselves were measured when they
  shipped; what has never been checked is the band drawn end to end.
  **EVERY CELL NOW PRINTS ITS OWN DENOMINATOR — 2026-09-16, on the client's
  instruction to rebuild the screen around «foizlar va raqamlar bilan
  koʻrsatilgan» matrix.** A cell said «12» and kept the headcount in a tooltip
  and an `aria-label`, so the module's own opening claim — nothing here is a
  number whose denominator the reader has to guess — was true only of a reader
  with a pointer, and this table is read by a manager scanning a column.
  «12 · 47» states both. `W_MONTH` 44 → **66**, measured from the widest pair
  the grid can produce («100» at 11px tabular is 20.5px, the count at 9px
  carries «11 500» in 32 — the summary row's «Oylik +0» cell is every
  first-time buyer in the matrix at once). **The cost was taken deliberately:**
  twelve months plus the 460px pinned block is 1 252px against ~988 on a
  1280px laptop with the rail open, so that screen scrolls by ~264px where it
  scrolled by ~10. The pinned block is sticky and «6 oy» is one press away.
  The share is `data-share` and the count `data-count`, because «the grid's
  figure» used to be `[data-heat]`'s whole `textContent`, which
  `cohortAgreement.test.tsx` compared against «Oddiy»'s milestone. That test
  and that milestone are both gone; the addresses stay, because a tile holding
  two figures needs each of them separately reachable whatever asserts on it
  next. **A cell the reading cannot measure prints
  no count either**: `· 0` under an em dash would report a measured zero where
  the grid means «this month has not happened».
  **A THIRD READING, «PUL», AND IT COSTS NO REQUEST.** `revenue` has ridden
  every row since the matrix learned to print a cohort's money, so the money
  view is arithmetic in the browser over the payload the other two readings
  draw — the page still makes its two requests and the three readings cannot
  disagree. A cell is the cohort's money **through** that month divided by the
  cohort («13,5 ming»), with the multiple against its OWN first month beside
  it («×1,4»). **CUMULATIVE ONLY, deliberately**: a single later month is
  0–4% of the customers times one order, which is a sawtooth across a row and
  noise down a column. **THE RAMP IS ON THE MULTIPLE, NOT ON THE SOʼM** — soʼm
  cannot be banded (product mix and inflation move it and the grid goes one
  colour), the multiple is scale-free, and it is printed in the cell so the
  colour converts back. **«0» IS KEPT HERE AND DROPPED CUMULATIVELY, and the
  two absences mean opposite things**: cumulatively that column is 0% for
  every row there has ever been, in money it is the denominator every other
  cell divides by — so it keeps its soʼm, loses its multiple (×1,00 is a
  definition, not a measurement) and comes off the ramp. **AND THE COLUMN
  COMPARES DOWN, which is the point**: the pinned «1 mijozga» column may not
  be read down its column (`MONEY_YOUNG_MONTHS` — it ranks rows by AGE), and a
  matrix column has no such defect because every cell in «+6» is a cohort at
  six months old. The legend says so, because a reader who has taken the first
  rule to heart will not assume the exception. The row's identity: **the last
  MEASURED money cell equals the pinned «1 mijozga» figure**, by construction.
  **THE FIVE MONEY BANDS ARE NOT MEASURED AGAINST PRODUCTION** (1,02 / 1,1 /
  1,25 / 1,5) — the customer ramps were cut from measured ranges and nothing
  has yet read the money curve on the live portal. A grid in one step is the
  symptom and those five numbers are the whole fix.
  **AND THE MATRIX CAN BE CUT BY THE TEAM THAT BROUGHT THE CUSTOMER IN —
  `?rop=`, 2026-09-16.** The team is whoever made the customer's FIRST
  delivered order, read from `deal."operatorTeamSource"` with the seller's
  current department as the fallback: the same basis, in the same order, as
  Logistika's per-ROP strip, so the two screens name teams identically.
  **RETURNS ARE NOT RE-ATTRIBUTED** — a customer Sevinch acquired who buys
  again from Charos is still Sevinch's returning customer. That makes it a
  measure of WHOSE CUSTOMERS COME BACK and not of who does the retention work,
  which on this portal is whoever answers the phone; the screen says so in
  three sentences above the grid, built from the response's echoed `rop` and
  never from the control, which holds the new team for one render while the
  old rows are still drawn.
  **A DIMENSION, NOT A SCOPE.** The route still declares `analytics:read:all`,
  still refuses a narrowed account outright, and `ctx.scope` still reaches
  nothing — cohort stays in the still-refusing list above and belongs there.
  A ROP choosing to look at their own team and a ROP restricted to it are
  different mechanisms and only the first exists.
  **THE DEFAULT STATEMENT IS BYTE-IDENTICAL TO THE MEASURED ONE.** The
  attribution CTEs, the `$3` filter and the team-list arm are INTERPOLATED, not
  parameterised away, so a page that did not ask for the cut runs what it ran
  before. This endpoint's plan is measured, not assumed — 566 ms once hid in a
  single mis-estimated join — and charging every cold load a grouping, two
  joins and a regexp per customer for a cut most readers never open is the
  trade the wrong way round. `cohortsSql.test.ts` builds BOTH forms through a
  fake client and pins it: the default statement contains no `employee` at
  all. That file's old blanket ban on the word (a source-text assertion) is
  gone; what it forbids now is a SCOPE predicate, in either form.
  **THE SCOPED PATH IS UNMEASURED.** Nothing has run `EXPLAIN` on it — there is
  no production database reachable from the checkout it was written in. Time
  it from the app or from beside the database, never from a laptop in Tashkent
  (see the payroll note for the probe that lied by a factor of ten).
  **THE TEAM LIST RIDES `?include=rops`**, the same choice `/users` made for
  its department heads, and the picker fetches it on the FIRST reach rather
  than on load — its own cache key, `staleTime` five minutes, `months=3`
  because that request throws its own matrix away. `База` and the
  concentration band are NOT cut and say so: the follow-up cycle is run
  centrally, so there is no acquiring team to partition it by.
  **COLLAGEN AND ZEXTRA MATRICES UNDER IT — 2026-10-16** (the client:
  «kogorta … collagenga va zextraga alohida alohida»). `/insights/cohorts?brand=`
  cuts the matrix to the customers whose FIRST order (the earliest WON revenue
  deal of their cohort month, `first_order` → `owner_brand`) is that brand's by
  `brandSliceSql` — form name, then product, then the first order's own team
  (`dealTeamSql`). Returns are NOT re-attributed, as with `?rop=`; a customer
  whose first order neither brand claims is on neither card, so Collagen +
  Zextra = the company less «Brendsiz» (checked on a seeded local DB:
  C + Z + Brendsiz = company on every size, returner and cell). The brand is
  probed once per customer, never per purchase; the default statement is
  unchanged (`cohortsSql.test.ts`). The page asks Collagen after the company
  matrix and Zextra after Collagen, never two at once; each card has its own
  reading / window controls. A team pick does not cut them. NOT MEASURED ON
  PRODUCTION.
  **TWO DIFFERENT THINGS ARE BOTH CALLED `months`, and confusing them is how
  you write a wrong sentence about this screen.** The **API parameter**
  (`COHORT_HISTORY_MONTHS` = 18 in `CohortPage`, `$2` in the statement) bounds
  which cohort **ROWS** the matrix arm draws, and the totals arm deliberately
  ignores it. The **`CohortHeatmap` prop** of the same name is the 6 / 12 /
  Hammasi control and bounds which **COLUMNS** are drawn, of rows the grid was
  already given. Neither touches the other: the reader's column choice cannot
  move a row total, and the eighteen-month request cannot move a column.
  **TWO FLOORS, AND NEITHER IS DECORATION.** Per-customer money prints greyed
  under `MONEY_YOUNG_MONTHS` = 3 (a three-month-old cohort's lifetime value is
  noise, and a money column is an invitation to compare down it); a summary
  cell comes off the ramp under `MIN_COHORTS_FOR_AVERAGE` = 3 cohorts, after
  +12 once printed one cohort's number as the company average. That floor was
  shared with «Oddiy»'s milestone, which refused outright below it — the
  milestone is gone, the floor is not. The sparkline was truncated on that
  same floor
  rather than drawn past it. A third, `SUMMARY_MIN_BASE` = 30, takes a thin
  summary cell off the colour ramp.
  **A STATED LIMIT: DUPLICATE IDENTITIES.** Bitrix24 holds the same human
  under more than one contact row, and a second row is a second first
  purchase — so a returning customer is occasionally counted as a new one and
  the curve reads slightly low. The stated limit is **39 of 11 517 buyers,
  0.34%**, measured 2026-09-15 — kept because it is the higher, more
  conservative of the two figures taken that day. **The denominator moves and
  the method matters**: the same day's probe counted **11 536** buyers (the
  roster grows daily) and found **35 surplus rows sharing a normalised phone
  number, 0.30%**, which is the same finding by a narrower match. Quote the
  0.34% and say which of the two matchings you mean; do not present retention
  here as exact to the person.
  **THE CURVE IS FREE — BUT ONLY AS A THIRD UNION ARM, AND THAT COST 566 ms
  TO LEARN.** The cumulative curve was argued to be free because `first_return`
  REPLACES the old `count(DISTINCT customer_id)` grouping rather than adding
  one. That half is true and is worth about 1 ms. What the argument missed is
  that the per-offset counts then have to reach the matrix — and as
  `LEFT JOIN first_offsets fo ON fo.cohort = p.cohort AND fo.first_offset =
  p.months_since` they were the most expensive node in the product's slowest
  statement. **The planner cannot estimate a CTE**: it read `first_offsets` as
  3 rows against an actual 912, took a **Nested Loop Left Join** and rescanned
  it once per matrix row — `loops=13460`, **1 165 954 rows discarded by the
  join filter, 566 ms of self time**. `first_offsets` is emitted as its own
  `is_total = 2` **arm** instead, merged in the fold by
  `(cohort, months_since)`: ~87 extra rows on the wire, no join at all.
  Measured on production 2026-09-15, `EXPLAIN (ANALYZE, BUFFERS)`, three
  statements interleaved on one connection, twelve runs each — medians
  **pre-change (`7404c2a`) 414–415 ms · with the join 900–959 ms · with the
  third arm 405–467 ms**. The arm is back in the pre-change plan's range; the
  join's Nested Loop is gone from the plan and the only `Rows Removed by Join
  Filter` left (176 672, `returners`) is the one the pre-change plan has too.
  Folded payloads from the two shapes are **byte-identical**.
  **Buffers are `shared hit=24722`, `read=0` on all three shapes**, which is
  the fact that decides where to look next: none of this is I/O, so **an index
  could not have fixed it and cannot fix what is left**. `MATERIALIZED` on the
  CTE was tried and measured and did not help — the estimate drives the plan,
  not the materialisation.
  **The lever on this endpoint is therefore the JOIN SHAPE first and the SCAN
  second**, which is the reverse of what this file and
  `tests/http/cohortsSql.test.ts` said before 2026-09-15: the two `deal` scans
  are ~120–190 ms of the statement, the one join was 566. The covering index
  named in the method's own comment is still worth having; it is no longer the
  biggest thing available. And the 1587 ms recorded for this endpoint is an
  END-TO-END p50 from 2026-09-11, **not** a server-side execution time — do
  not compare it to any figure above. It should be re-timed on the deploy.
  **THE PAGE'S STANDING QUESTIONS ARE BUILT BY THE WORKER AND STORED —
  2026-10-24.** That day every cold build ran into the web pool's 20 s
  statement timeout (500 at 18:13, 18:43, 18:44, 18:46), and with the limit
  lifted to 60 s (8b7b51b6) the screen answered, but cold in 13.1 s for the
  company, **48.1 s for Collagen** and 15.6 s for Zextra — each holding one of
  the six screen connections that long, after every deploy and every quiet
  ten minutes (the memo is 5 min + 5 stale). The deal history (~2 GB) no
  longer fits the one-gigabyte database's memory. So `cohortSnapshotRefresh.ts`
  in the sync worker builds the three matrices the page opens on (18 months:
  company / Collagen / Zextra) and the База card, one at a time, every 30 min
  in `WARM_HOURS` and every 3 h outside, into `cohort_snapshot` (the
  repository's own answer as JSON, BigInt as `{"$bigint": …}`), and
  `InsightsService.cohorts` hands that out — a primary-key read behind a
  60 s memo. **The statement and the fold are unchanged**: the stored value
  IS `InsightsRepository.cohorts`'s answer, so every number is the live one.
  A stored answer is served only while it is under 6 h old AND built in this
  Tashkent month (the horizon is the month it was built in); otherwise — and
  for any question nobody stores: a team cut, the picker's `include=rops`,
  another span — the live build runs as before. `SYNC_COHORTS=0` on the worker
  turns the store off. `tests/services/cohortSnapshot.test.ts`.
  Measured in PGlite over every migration and 440 000 deals (180 000 won
  revenue, 150 000 customers, 240 000 line items): the worker's builds
  1.2 s (company) / 6.8 s (Collagen) / 6.5 s (Zextra); the screen's read
  `Execution Time` 0.03–0.12 ms, the service 1.6–13 ms with no statement
  run; the folded DTO **byte-identical** to the live one for all three. The
  brand cuts' cost is the per-first-order form / product / team probes
  (`brandSliceSql`: 2.58 M shared buffers in that run) — cheap warm, which
  is why a cold database paid 48 s.
- **Qoʻngʻiroqlar** (URL `/customers`, section id `customers`) — **NEW ON
  2026-09-16 as «Mijozlar va qoʻngʻiroqlar», RENAMED AND STRIPPED ON
  2026-09-17** («eng asosiy malumotlarni koʻrsat, keraksiz narsalarni olib
  tashla… har bir narsa aniq vaqti bilan… kim qancha gaplashayapti»). The
  section id and URL did NOT change: ids are stored on account grants, and
  renaming one silently takes the screen away from everyone who holds it.
  **What is on it:** a line with the exact window and the newest call the sync
  has written (CALLS arrives on the three-hourly reference pass, so «Bugun» at
  14:30 can honestly end at 11:48), five tiles, the operators table — talk
  time spelled out with a share bar, team under the name, median AND mean,
  first–last call in Tashkent time — an hour-of-day chart, a per-day chart
  when the window spans days, and the teams table. **All of it is ONE
  statement** (`callActivity`, five `GROUPING SETS` arms), so every table
  and chart sums to the tiles.
  **What went, and must not come back unasked:** the customer-flow band (its
  endpoint `/insights/customers` still serves «Mijoz qaytishi» and its
  `section` moved back to `cohort`), the База / not-База call split and the
  buyer split `customerBaseSplit`, the duration bands, the calls-per-customer
  bands, the unlinked-calls note and p90. Their statements, DTO fields (both
  mirrors), constants and tests were deleted with them.
  **CALL DURATIONS BEFORE 2026-09-15 ARE WRONG IN THE DATABASE.** The
  per-minute pass read `voximplant.statistic.get` from its own watermark, so it
  stored calls mid-conversation and never re-read them. `CALL_DATA_FLOOR` in
  `src/lib/callQuality.ts` clamps every call query to the next midnight, and
  `SETTLE_LOOKBACK_MS` in `SyncEngine.ts` re-reads three hours of calls every
  pass so it cannot recur. Every time on the screen is bucketed with the
  two-step `AT TIME ZONE 'UTC' AT TIME ZONE` — see *Invariants*.
  **A CALL JOINS A CUSTOMER, NEVER AN ORDER** — `dealId` is set on 1 row of
  366 300 — and **direction is the leg, not the intent**, so the screen splits
  by neither.
  **THE MEDIAN IS ON SCREEN BESIDE THE MEAN, AND THE MEAN IS NOT ON THE WIRE.**
  169 s mean against 53 s median above the floor: 8.4% of calls hold half the
  talk time. Durations are spelled in units («2 daq 47 s», «3 soat 12 daq»),
  not `m:ss`, which beside a column of hours read as either.
  **THE TEAM IS `employee."departmentId"`, NEVER `department_member`**, with
  «(ROP)» stripped and non-ROP departments KEPT.
  **NOTHING OF IT RENDERS LOCALLY** — the demo seed has no calls — so
  `tests/features/callsPage.test.tsx` carries production figures.
- **Kanallar** — the dashboard-wide `preset` does **not** reach this
  screen; it resolves its own window from `from`/`to`/`today`.
- **Yalpi marja** — discounts are split by sign in SQL; never net them or
  re-sum them client-side.
- **Logistika** — **REBUILT ON THE QUEUE COHORT ON 2026-09-10**, on the
  client's instruction («logistika boʻlimini yaxshilaymiz… tubdan»). It is
  now their own Google Sheet — ЗАКАЗ, ТАСТИКЛАНГАН, не собран, В пути,
  Ожидание/нд, Отказ, Успешно, %покрытия — and the columns are the eighteen
  Доставка stages grouped six ways by `deal_stage."logisticsRole"`. The
  partition lives in `src/lib/logisticsBuckets.ts`, which BOTH sides read:
  the repository builds its `CASE` from it and the screen draws its labels
  and colours from it, so a business definition the client approved stage by
  stage has one home rather than a hand-mirror. Pinned by
  `tests/domain/logisticsBuckets.test.ts` against `DELIVERY_STAGE_ROLES`.
  **THE COHORT WAS MEASURED, NOT CHOSEN.** Against the client's own week
  (31.08–06.09.2026) their ЗАКАЗ of 893 489 993 sits 98.6% on FAKT 1
  (881 270 000) and their Успешно of 698 539 996 sits 100.4% on FAKT 2
  (701 570 000); the old `createdAtSource` cohort gives 788 670 000 — 88.3%.
  So **ЗАКАЗ is FAKT 1, Успешно is FAKT 2 and %покрытия is one over the
  other**, measured with `FAKT1_OUTCOMES` and `faktDeliveredSql` — the same
  constants `ratingSql` groups by, so this screen and Savdo dinamikasi
  cannot drift. Verified against production: `summary.ordered` equals
  `/analytics/sellers` `totals.ordered` to the soʻm.
  `refused` vs `cancelledEarly` is still decided by whether the deal ever
  has a dispatch-role stage-history row, NOT by its current stage — on that
  week all 48 refusals stand in «Отказ предварительно» and all 48 had
  already reached a post office, so the stage name reports the opposite of
  the truth.
  **THE SHEET SPECIFIED THE COLUMNS; BITRIX24 SUPPLIES THE NUMBERS** — settled
  by the client on 2026-09-11 («bitrix24dagi malumot toʻgʻri… google sheet ni
  koʻrsatganim sababi shu malumotlar dashboardda boʻlishi mumkin… undagi
  malumotlarga tayanma»). Their sheet and ours split «still at a post office»
  against «refused» differently (8.4% vs their 16.70%, 10.9% vs their 4.25%)
  while Успешно and both totals agree to the soʻm — and that is not an open
  defect to chase: the portal wins, the mapping it specified is confirmed
  stage by stage, and nothing here changes. The last block on the screen is
  therefore an AUDIT TRAIL rather than a dispute — every Доставка stage
  verbatim with the column it feeds, so the six can be checked against
  obey.bitrix24.kz instead of trusted. **No stage COUNT is written down**,
  in that block or in `messages.ts`: it was eighteen until 2026-09-10 and is
  nineteen now, and both places said eighteen on a live screen for a day.
  `countsAsRevenue` is NAMED but COUNTED rather than filtered:
  the cohort is chosen by an arrival in Тасдиклаш (#4), which is not a
  revenue pipeline, so a `WHERE` would drop every queued and every refused
  order — `summary.offRevenueOrders` is the tripwire and is expected to be 0.
  **It counts only orders still INSIDE Доставка, and the narrowing is what
  makes the 0 mean anything.** Counted over the whole cohort it read 14 at
  60 days, 589 at 180 and 636 at a year, under a red line saying it must be
  0; every one was a confirmed order handed on to another funnel, 13 of the
  14 into «База» — a repeat purchase, already reported by name as
  `unbucketedOrders`, and the red line sent a reader hunting a defect that
  was ordinary business. Inside the funnel AND unflagged is the case that
  cannot happen, and it measures 0 at 60, 180 and 365 days.
  **The wait gradient follows the page's window, and a fixed trailing window
  was measured and REJECTED.** One row per order, resolved only, at five
  horizons: the first three bands hold at 94 / 86 / 75 whatever the window,
  but the last reads 61.5 (14 d) · 66.9 (30 d) · 62.5 (60 d) · 76.6 (120 d) ·
  78.5 (240 d) — a parcel that sat for weeks and was eventually collected
  only enters the measurement once the window contains its ending. Freezing
  one horizon would have frozen one answer into the block whose whole subject
  is how that answer moves. What a short window really costs is orders, not
  bias, so the guard is on the count: under `WAIT_BAND_MIN_ORDERS` = 30 the
  band prints its count and no rate (at thirty, one parcel is 3.3 points —
  about the gap between two neighbouring bands), and over a fortnight that
  bites on exactly the last band (13 orders against 378 / 333 / 188).
  **PER-ROP FAKT 1 / FAKT 2 SITS DIRECTLY UNDER THE HERO** — asked for on
  2026-09-12 («ROP larni FAKT 1 larini tortgansan… keyingi tarafida FAKT 2 si
  ROP larni har biriga kerak»). It is an eighth `GROUPING SETS` arm (`by_rop`)
  over rows already in memory, not a second question, and its total row IS the
  hero: `ropTotal` must equal `summary.ordered` and `summary.won` to the soʻm,
  which is what makes the table checkable. Like `by_fakt` it is **not** filtered
  to FAKT 1 — FAKT 2 is not a subset of FAKT 1, and a `WHERE k.fakt1` would
  print a full ЗАКАЗ beside a short Успешно.
  **THE TEAM COMES OFF THE DEAL, NOT OFF TODAY'S ORG CHART.** Settled by the
  client on 2026-09-14: «Организация сотрудника (не удалять)» on the deal card
  — `deal."operatorTeamSource"`, which the portal stamps at the moment of sale
  and never rewrites. The seller's CURRENT department (`c.rop`) is only the
  fallback, for the older orders the portal wrote no field on. Under the
  department basis a seller who changes team drags their whole history across
  and a settled month moves; one sampled July order still names
  «Husniddin(ROP)», a department the portal no longer has. The strip has one
  home, `InsightsRepository.ropNameSql`, read by both bases; pinned by
  `tests/http/logisticsSql.test.ts` and `tests/http/confirmationQueueSql.test.ts`.
  **SINCE 2026-09-26 THE WHOLE QUEUE READS IT THIS WAY** («jamoani ham
  bitimdagi maydondan olsin, logistikadagidek qil»): `classified.rop` itself is
  `COALESCE(snapshot, department)`, so `/confirmation` (РОП column, filter,
  Статистика panel, daily numbering), `/sellers`' team table, Savdo
  dinamikasi's teams and the record wall name a team the way the deal card
  does. Measured on 01–25.09.2026 before the change: 22 orders /
  53.9 mln of FAKT 1 sold under Sevinchxon(ROP) were printed under Sadriddin,
  the seller's team today. **A seller can therefore hold orders under two teams
  in one window**, and `ratingSql` groups by (seller, team) and returns SLICES:
  the team table sums them as they are, while everything that prints a PERSON
  — the board's rows, payroll, ranks — folds them first with
  `domain/analytics/sellerTeams.ts` `mergeSellerTeamSlices`, labelled with the
  team of the newest order. Forgetting the fold puts one seller on the board
  twice and splits their FAKT 2 across the payroll tiers;
  `tests/services/sellerBoardTeams.test.ts` and
  `tests/services/payrollTeamSlices.test.ts` pin both. `recordsSql` groups by
  the seller alone for the same reason.
- **Sotuvchilar reytingi** — company-wide on purpose, and it is the ONLY route
  that admits a narrowed caller without narrowing: it passes `ctx.query` and
  never `ctx.scope`, and `boardFilters` drops `restrictToEmployeeIds` a second
  time so a scope cannot reach the SQL by one edit. See the block above
  *Client data flow* for the reason and what it discloses.
  **The FAKT 1 / FAKT 2 switch re-ranks in the BROWSER, and one press moves
  BOTH columns.** Added 2026-09-10 — «ikkita boʻlimni sotuvchilar va
  komandalar boʻyichasini fakt 1 va fakt 2 boʻyicha koʻrish mumkin boʻlsin».
  Every row is already on the payload carrying both facts, so this is one
  answer read two ways and not a second question: no parameter, no request, no
  cache key, nothing that can straddle a sync. `rankedBy` in
  `sellers/SellersPage.tsx` (it lived in `sellers/board.ts` only while the EFIR
  redesigns did)
  therefore MIRRORS `SellerBoardService` — `buildBoard` for the sellers and
  `teamRows` for the teams — the fact being read, then the other one, then the
  key, with competition ranking over BOTH figures; change that rule on the
  server and it has to change here in the same commit, or the two columns
  disagree about who is second.
  `tests/features/sellersTvBoard.test.tsx` is what holds the mirror: read on
  FAKT 2 it asserts the ranks the service sent, shared ranks and skips
  included. The choice lives on the page, not in the column, because a team's
  money is its sellers' money summed and two halves reading different facts is
  the reconciliation the seat's own FAKT caption exists to prevent, one column
  deep. **IT OPENS ON FAKT 1 — 2026-10-07**, the client: «jadvalga kirganda
  FAKT 2 boʻlib turishi emas, FAKT 1 maʼlumot bilan turadi, keyin xohlasa
  FAKT 2 ga oʻtkaziladi». The 'auto' opening state (FAKT 2 once anybody had
  delivered, FAKT 1 until then) is gone with `resolveFakt`, so `FaktChoice`
  is the two facts and nothing else and the two headings cannot light
  different buttons. With it: the table prints **FAKT 1 before FAKT 2** (the
  first figure after a name is the fact the board opens ranked on, not the
  morning's column of zeros), the fact not being read prints its «0» in the
  dash's muted ink (`asideInk` — still a «0», it is a measurement), and a seat
  under a FAKT 1 reading says «N buyurtma» where «0 / N buyurtma» led with a
  delivered-count zero — and «won / N buyurtma» again the moment that seller
  has delivered (the FAKT 2 money line's own test), with the conversion
  behind the same gate, so «Shu oy» keeps the count the floor read on it.
  `sellersMedals.test.tsx` pins the PAGE's opening (it mounts the real
  `SellersPage`: FAKT 1 lit in both headings, every seat «tasdiqlangan»);
  `sellersTvBoard.test.tsx` reads the opening line at the source and pins the
  column order, the heads' `aria-sort` and the one-choice-both-columns rule.
  **«PREMIUM» — 2026-10-07, the same ask** («kartochkani premium,
  professionalroq qilish kerak … oʻzgarib ketmasin juda kuchli»): SAYQAL item
  5 in `globals.css`, a second finishing pass in the ring's own hand and
  PAINT ONLY — colour, background, box-shadow, text-shadow, so the measured
  promises above hold by construction. The seat rim is a metal bevel drawn as
  a border-box gradient under a transparent 1px border (the card is opaque, so
  the hero's glass veil cannot happen), with a 16px contact shade at the foot;
  the plaque is a satin tag with the ordinal engraved; the pedestal lip a
  chamfered strip in the 3px it owns; the rank numeral secondary ink; the
  sticky head's rule `--axis` from 1280; the unlit FAKT lamp a hollow ring and
  the key's lit edge inside its rim; the record wall's month and the medal
  key's gold words in one gold INK (`--emal-gold-d` toward ink — `--medal-gold`
  measured 2.5:1 on the light title band). In the TSX: the row bar's FAKT 1
  layer is `--seq-350` (250 read 1.5:1 against the dark track) and the
  «Buyurtma» count is secondary ink. Proposed by three design lenses and
  scored by two judges; dropped on their verdict: a second specular on the
  ring, a satin rank disc, a tone-tinted table head, the phone switch's key.
  Every base rule a 5x item repaints names it in a comment.
  **Second step, the same day** — the client saw the first cut live and said
  «hech qanday oʻzgarishni sezmadim», chose «oʻrtacha — kartalar + jadval»:
  the rim is the metal itself (pale catch light → the metal → metal toward
  black), the plaque a 46 → 28% metal tag, the pedestal 58 → 30% metal, the
  champion throws a wide gold light; the rows get a rank DISC (`.tv-rank`,
  1.75em, tone-tinted — the one shape added; the rank column widens ~8px and
  the name cell gives it up, the money columns do not move), the ranked
  column's head and cells a 7% tone wash (`tv-th--read` / `tv-cell--read`,
  an inset shadow so it composites over hover and zebra), and a quiet zebra
  from 1280 only (the phone's pinned cells stay opaque).
  **MEDALS, AND NO LEVELS — 2026-09-17** («uroven kerak emas, medallar
  qolsin»). Four redesigns of this board were rejected and the client asked
  for the pre-medal board (`912fc63`) back with medals on it; spec
  `docs/superpowers/specs/2026-09-17-klassik-taxta-medallar-design.md`.
  `?include=medals` answers `{ sellers: [{ employeeId, medals }], from }` and
  nothing else: the level ladder, its titles, the promotion date and the
  per-medal unlock table were DELETED from `domain/analytics/sellerMedals.ts`,
  the service, both DTO mirrors and `sellers/medalCatalog.ts`, so **every
  medal the engine finds is transmitted** — an invisible level cannot hide a
  medal. The fourteen rules and their thresholds were calibrated on production
  and did not move; `MEDAL_ORDER` (true metal first) is pinned on both sides
  by `tests/features/medalCatalogMirror.test.ts`. A seller with a month fact
  in the window is listed even with `medals: []`, rows sort by `employeeId`
  (the reader keys a map by id), the window is fixed to `RECORDS_FROM` → now
  whatever the period filter says, and the 10-minute memo is keyed on the
  window START — never its end, which is `ctx.now` and would never hit.
  **WHERE THE MEDALS STAND, AND THE THREE THINGS THEY MAY NOT DO.** The board
  is `912fc63`'s to the pixel wherever there is no medal; `SellersPage` mounts
  one `<MedalDefs />`, asks `?include=medals` on its own ten-minute clock with
  NO period on the key (the record wall's pattern — a failed medal request
  leaves the ranking exactly as it was), and joins by `employeeId`. A seat
  carries ONE shelf under the team chip — champion up to 4 at 40px, the
  other two up to 3 at 36px (`seatMedals`), a repeat as the ×N chip (`CountChip`)
  inside the SVG; a row carries up to 3 at 26px at the right-hand end of the
  name cell, across the bar and chase lines (`rowMedalsOf`, `first-sale` never
  drawn there). **No «+N» and no caption anywhere; `TeamsColumn` has no prop
  that could receive a medal.** The three promises are CSS, in the MEDALS
  block of `globals.css`, and each was measured against the old board running
  beside it: **the podium does not grow** (489.0 → 488.9px at 1920×1080, and the same
  0.1px under the old board at 1600 and 2560, on «Shu oy», «Bugun» and the
  morning alike — the shelf's 46px came out of the seat's gaps, its paddings
  and a pedestal step that is the old expression LESS 1.2px, 28.6 where the
  old board had 29.8, still 1 : 1.6 : 2.4; the gap ABOVE the ring
  was left alone, because 4px less slides the crown under the plaque. **The
  step was 22px for a day** — blocks a quarter lower, which bought a fifth
  whole row — and the review measured the cost: numerals 47 → 33px, blocks
  that read as strips, bronze standing 3.5px above silver. §1.6 allows a
  tenth; `tvBoardLayout.test.ts` now holds the step within that of the old
  one. The teams' podium carries no shelf and is 46px SHORTER than it was,
  443 → 397); **the row does not
  grow** (the holder is exactly one 26px medal tall inside the 27.9 / 26.5px
  the bar and chase lines already took — 28px would not fit a laptop); **the
  number columns do not move** (`contain: inline-size` plus margins on the
  medals rather than padding on the holder, so the cell's minimum width is
  what it was — 10px of padding once dropped a team chip to a second line at
  1366). A medal that does not fit beside the chase wraps to a line that is
  never painted and so disappears WHOLE: three fit on the television, one or
  two on a 1366 laptop, and a phone gives them a line of their own. **Every
  bar in a list with medals shortens by the same `--row-medals-room`**,
  because the bars share one scale — 96px from 1800, 64px between 1280 and
  1799, and ZERO over 1280–1319 and 1600–1659, the two stretches just after
  the table gains columns, where the name cell is ~190px against a ~160px
  chase: no medal fits there, so no bar gives anything up and the rows are the
  old board's. Spec §1.6 also
  tightened the rows by a tenth (65.4 → 61.5px): at 1920×1080 the sellers'
  list shows 4 whole rows and 0.8 of the fifth (it was 4 and a half), the
  teams' 6 whole (it was 5); and it turned the
  «Bugun» morning's bold «0» into a muted «—» on rows with nothing on EITHER
  fact. **On a 1366 laptop the seat's shelf steps down to 36 / 32px** with the
  rest of the seat type (a 40px medal over a 17px sum out-shouted the money);
  the television keeps 40 / 36. **Steel medals — ~95% of what rows wear — were
  lifted in the two DARK token blocks only**: their body stood 1.6–2.4:1
  against the row and only the gilt device survived at 26px. **A new medal
  lands ONCE**: `useNewMedals` drops its flag after `NEW_MEDAL_MS`, because a
  flag that lived until the next ten-minute payload replayed the animation on
  every remount — a FAKT press, a re-rank, the phone's tab. `tests/features/sellersMedals.test.tsx` holds all of it, the CSS
  included, and was checked by mutation. **One old-board defect the audit DID
  fix:** the champion's pill «+21,500,000 soʻm oldinda» was one 150px nowrap
  run in a pill a 1366 laptop caps at 148px, so the words stood 1.2px outside
  it on both sides (9px at 1280). Between 1280 and 1599 the seat's pill now
  steps down with the rest of the seat type (10px, 6px pill padding, 8px card
  side padding — two lines at 1366, where the podium is 436px against the old
  board's 444), and the run may part
  before «oldinda», never inside the sum, so under ~1345px it takes a third
  line instead of spilling; pinned in `sellersTvBoard.test.tsx`. **Still the
  old board's and not fixed:** at 1366×768 the list is 69px tall (it was 61)
  and no row is whole; the phone's `.tv-seat-card` 8px side padding is a dead
  rule (the card's `padding` shorthand is written after it), on both boards.
  **«EMAL» MEDALS, LINE ICONS AND THE MEDAL KEY — 2026-09-18.** The client
  found the ZARB coins «oʻyinchoqdek» and chose «Yangi medallar + sayqal» on a
  frozen copy of the production page; spec
  `docs/superpowers/specs/2026-09-18-emal-medallar-design.md`, and its
  `assets/…/IMPLEMENT.md` wins any disagreement. A medal is the rank disc's
  small sibling now — an enamel field in a thin metal ring, three tiers told by
  the METAL (a solid disc for a year or a month won, a gold ring for the rare
  three, a steel ring for the daily seven); no laurels, no path-digits, and the
  ×N is the board's own chip (`CountChip`, real text inside the medal's SVG —
  so a seat's shelf now has `textContent`, and only that). `medalDefs.ts` is
  generated (`node scripts/genMedalDefs.mjs`), 26 ids, every colour a
  `--emal-*` token read on `:root` in all three theme blocks; NOTHING is
  re-bound on `.medal-defs` / `.medal-mark` any more. Every colour emoji on the
  board is a `BoardIcon` (one span, the emoji's own advance, so nothing beside
  it moved), and **the crown is centred by MARGIN**: `.rise` ends on
  `transform: none` with fill-mode `both`, which had been wiping the inline
  `translateX(-50%)` and leaving the shipped crown 12.5px right of its ring.
  **The SAYQAL section sits AFTER every other board rule on purpose** — several
  of its rules tie the specificity of what they refine and win on source order,
  which is how the mock was measured (podium −1px at 1920, −2px at 1366,
  number columns and row height Δ 0).
  **«MEDALLAR TASNIFI» CRAWLS ALONG THE FOOT** («medallar tasnifi pastda
  aylanib turishi kerak», the same day): `MedalTasnif` — all fourteen medals,
  drawing + name + the rule it is awarded on, in three named groups, on the
  record wall's mechanism to the letter. It runs the full width of the foot
  (`.tv-foot`) and the credit sits under its right end, absolutely placed in
  `main`'s 24px bottom padding (client: «pastiga koʻchir, kichikroq … medallarni
  ful oxirigacha»), so the two lists gave up 24px at 1920×1080 (a 38px strip
  where a 14px credit stood), not a whole row, and the credit costs nothing. **Its sentences restate the engine's
  thresholds by hand** — the layer rule forbids the import — and
  `tests/features/medalTasnif.test.tsx` checks them against
  `sellerMedals.ts`' constants; change a threshold and that test names the
  sentence. **At 1366×768 the strip sits at its 34px floor** and the lists
  give up 20px — the sellers' list, already 69px there with no whole row,
  keeps about 51px, i.e. its sticky header and a sliver of the first row. Not
  hidden there on purpose: the floor's television may be a 720p panel, and
  the client asked for the key ON the television.
  It is a key to the MEDALS, not the level ladder returning: the
  level guard in `sellersMedals.test.tsx` still refuses that board's class
  vocabulary anywhere on the page, which is why the component and its CSS are
  named «tasnif» and «group». **The same deploy removed the board's dead CSS**:
  the PODIUM block's rules for classes no component has rendered since the
  television board replaced the banner podium (`.podium-name`, `.podium-banner`,
  `.podium-ghost*`, `.podium-story`, `.rank-1/2/3`, `.rank-row`, `.rank-num`,
  `.figure-sum-hero/-runner`), and every base declaration SAYQAL always
  overrides — each base rule now names the SAYQAL item that paints it.
  Verified by diffing the computed style of every element under `<main>` in
  six states (1920 dark/light, 1366, 1440, a phone): identical, except the
  table heads' `font-feature-settings`, whose one rule (`"case"`) the shipped
  Inter subset cannot honour — the heads are byte-identical in a screenshot
  with and without it.
  **A MEDAL OPENS ITS OWN CARD ON HOVER** (the client, the same day: «medal
  ustiga olib borganda medal tasnifi kelib chiqsin»): name ×N, group, rule and
  THIS seller's latest instance — «3 marta · oxirgisi Avgust 2026 · 1,065,…
  soʻm». ONE `MedalTip` for the whole board, listening on the document for
  `.tv-board svg.medal-mark`, NOT the shared `Tooltip` around each medal: its
  `inline-flex` wrapper would break the MEDALS block's direct-child rules and
  with them the row-height and column promises. The seller is found through
  `data-employee` on the seat shelf and the row holder (sellers only — a team
  key is a ROP name). The rule text is `MEDAL_RULES` in `medalCatalog.ts`, the
  ONE source for the card and the strip. `orders` is read per medal and never
  generically (place on `rookie`, days on `work-month`). A TV has no pointer,
  so nothing depends on it; a phone opens it on a tap. The strip's title now
  says where the count starts («1-avg 2026 dan», the payload's `from`).
  **NOT MEASURED ON A FULL BOARD**: the local
  database seats two sellers, so the whole-rows count at 1920×1080 after the
  strip is arithmetic (4 whole and ~0.4 of a fifth for sellers), not a reading.
- **Sotuvchilar oyligi** — **NEW ON 2026-09-14**, the client's own pay scheme
  («hodimlar oyligi ni hisoblovchi bo'lim kerak… sotuvchilar oyligi fakt 2 ga
  qarab olinadi»); **REBUILT ON 2026-10-03 from two Word files** the client
  sent («Sinolife_Oylik_Maosh_Tartibi», «Sinolife_HAFTALIK_DAROMAD_SOM») into
  **two tabs, «Haftalik» and «Oylik»**. Both pay on **FAKT 2 only** — the
  week too (the client's answer when asked). Every table is one shape, a
  floor + a rate + a fixed part, and the rate applies to the WHOLE figure:
  **month** 8% + fiksa (45 → 500 000, 60 → 750 000, 70 → 1 000 000 mln soʻm;
  fortnight: the same at 22.5 / 30 / 35); **week** (`WEEK_TIERS`) under 15 mln
  **nothing**, 15 → 5%, 25 → 8% + 300 000, 35 → 10% + 600 000, 50 → 12% +
  1 200 000 — the oklad is WEEKLY, the document says so. **The dollar
  incentive (40 mln → 50$, 50 mln → 100$, first place +25$) was REMOVED on
  2026-10-03** — the new documents do not carry it and the client said drop
  it. The rule is `domain/payroll/sellerPayroll` — quoted, not
  derived, like `analytics/sellerBonus`, and the two are DIFFERENT schemes:
  that one is the client's published dashboard ladder, this is the payroll.
  `tests/domain/sellerPayroll.test.ts` types out every worked example both
  documents print, including the one contradiction the client settled — 60 mln
  pays **5 550 000** (the formula), not the 5 500 000 the sheet prints beside
  it (the 2026-10-03 file prints it again; the formula still governs).
  **NOBODY IS DISMISSED AND NOBODY IS ZEROED.** Their sheet says a seller
  under 30 mln leaves; they corrected it in the same conversation («ishdan
  ketmaydi shunchaki yozilgan… 30 mln dan pastlarni ham hisoblayver»), so
  every seller with delivered money is on the table with their 8% and no fixed
  part. Reinstating a dismissal rule would delete real pay. (The WEEK is
  different by its own table: under 15 mln it pays 0, and the row still shows,
  with the distance to 15 mln.)
  **FAKT 2 AND NOTHING ELSE — SAVDO DINAMIKASI'S, SINCE 2026-10-17.** The
  client, shown the same seller at 25.6 mln here and 32.9 mln there: «savdo
  dinamikasidagi to'g'ri malumot ekan, sotuvchilar oylikida xato». So the
  rows are `confirmationSellerRating` again (company-wide, no filters, no
  brand) — the queue cohort, an order counted in the window it ARRIVED in and
  delivered now — folded by `mergeSellerTeamSlices` like the board's, and
  only sellers with FAKT 2 > 0 are printed. From 2026-10-05 to 10-17 it was
  `deliveredSellerRows` (dated by the LAST delivery-stage entry, the client's
  «yetkazilgan sana» then), deleted with the switch. **The cost, stated to the
  client before the switch:** a closed month keeps growing while its late
  parcels land, so a payroll read on the 3rd can rise by the 10th.
  **THE WINDOW IS THE DASHBOARD'S** (2026-10-17): `periodQuerySchema` →
  `periodFrom`, the comparison `previousEquivalent`, exactly what Savdo
  dinamikasi sends; `/payroll` is in `SHALLOW_ROUTES`. The table is
  `payrollSchemeOf(period)` — `fullUnitWindow`'s length in Tashkent calendar
  days — so «Bugun» pays by the week's table and «Shu oy» by the month's on
  any day of it. `payrollPeriod`, `payrollWeekPeriod` and the «Sana» range
  route of that morning went with the tabs; `comparablePayrollPeriod` stays
  and cuts `previousEquivalent` to the elapsed time while the window runs.
  **AT MOST A MONTH:** `payrollQuerySchema` refuses «Shu yil» and a range over
  `PAYROLL_MAX_DAYS` (31) with a 400, and PageShell's `periodMaxDays` takes
  «Yil» off the picker — a quarter read by the month's table would print one
  fiksa as a quarter's salary.
  **COMPANY-WIDE, AND FOR A DIFFERENT REASON FROM THE REST OF `COMPANY_WIDE`.**
  It could be narrowed; it is refused to a narrowed account because a team's
  payroll is twelve people's salaries. Opening it to a ROP takes three changes
  in one commit: the route's permission, the scope threaded through the
  service, and the scope added to its memo key.
  **IT IS NOT SLOW, AND THE FIRST MEASUREMENT SAYING SO WAS MEASURING THE
  WRONG THING.** A local `npx tsx` probe read 9–11 s for a whole month and the
  figure went into this file; the same query answered from the app in
  **0.9–1.1 s** (measured 2026-09-14 on `/api/v1/payroll/sellers`, both a
  fortnight and a full month). The gap is the probe's own round trips from
  Tashkent to fra1, not the database — a lesson worth keeping for the next
  probe: time a query from something that sits beside the database, or time
  the endpoint.
  **BY ROP, WITH GROWTH — 2026-10-05** («ROP larga ajratilsin … kim qanchaga
  oʻsganligi … grafiklar bilan»). Tabs «Haftalik | 15 kunlik | Oylik» (gone 2026-10-17, see above); one
  card per ROP (`teams`, summed on the server from the printed rows, so the
  cards add up to the fund); every figure set against the LIKE period before
  — the week before, the same half of the month before, the month before —
  built by `comparablePayrollPeriod`, which cuts it to the same elapsed time
  (floored to the minute) while the period runs and is echoed as
  `meta.comparisonPeriod`. The previous window is paid by the same table; a
  seller absent then reads «yangi», and a team's previous figure groups the
  previous sellers by the label they wore THEN. Both windows count money
  delivered inside them, so mid-period growth is like for like (the
  «oʻsish past koʻrinadi» note went with the queue basis).
  **ROP PAY AND THE WORKING — 2026-10-07** («ROPlar guruhi FAKT 2 dan 2% + 2
  mln oklad … aniq va tushunarli jadval»). `ropPayroll`: 2% of the team's
  FAKT 2 on EVERY tab, + 2 000 000 oklad on «Oylik» only (the user's choice).
  `teams[].ropPay` (head = the «(ROP)» unit's `headId`, `ropHeadNames`;
  several units under one label list every head) and `ropTotals`, kept APART
  from the sellers' fund. The ROP's basis is FAKT 2 SOLD UNDER the label
  (raw slices), not the card's `fakt2`: a seller who moved team mid-period
  leaves the old ROP's share with the old ROP. A label nothing was delivered
  under gets no ROP row (no oklad either — flagged to the user). The
  page prints «ROP lar maoshi» under the hero and a «Hisob» column per seller
  («52 340 000 × 8% + 500 000 =») beside JAMI; the copy carries both.
  **ONE SHEET, БАЗА'S TABLE, A FLAT RATE — 2026-10-20** («baza roplarga
  alohida bo'lim, Toshkentga, Navoiyga alohida bo'lim … huddi RNP jadvali
  kabi»). The ROP cards and the «ROP lar maoshi» card became `PayrollSheet`:
  blocks by `payrollBranchOf` — БАЗА by the team (`isBaseTeam`: «Baza» and
  «Malika», though the portal files them under «Навоий» / «Зехтра»), every
  other team by the nearest ancestor unit naming «Тошкент» / «Навоий» /
  «Зехтра» (`ropAncestorNames`, a depth-bounded walk; a refused walk prints
  «Boshqa», pay unchanged); in each team its sellers, its ROP's row and its
  total; JAMI pinned right from `sm`. Beside the pay, «ROP otchet»'s Lid soni
  (`sellerLeads` over the window's Tashkent days; a refused read is «—»),
  Tranzaksiya (Транз-1), Konversiya and Buyurtma soni (Транз-2). The total
  rows sum the PRINTED sellers only (FAKT 2 > 0), so on «Bugun» their «Lid
  soni» runs below «ROP otchet»'s; their Konversiya is over the rows that had
  a lead — БАЗА is handed none. БАЗА sellers are paid `BAZA_*_TIERS`: 8% under
  20 mln, 10 / 12 / 15% from 20 / 25 / 35, on the whole figure, + 500 000
  oklad on EVERY rung; 15 days and a week divide floors and oklad (the
  user's choice), so «Bugun» shows the week's 125 000. Marjona Shahtiyarovna
  (portal user 7044) is paid a flat 18% of her own FAKT 2
  (`FLAT_RATE_SELLERS`), no fixed part, her ROP 2% kept; a lookup that fails
  or finds nobody fails the payroll rather than paying her by the wrong
  table. The comparison window is paid by each row's same table. ROP pay is
  still 2% + 2 mln everywhere: the client said Toshkent / Navoiy / Baza ROPs
  will get rates of their own, numbers not given yet. A БАЗА seller with no
  FAKT 2 is no row, so no oklad — not asked yet.
  **THE TOP PANEL'S FILTERS — 2026-10-24** («sotuvchilar oyligiga rop lar
  boʻyicha filtrlar … eng kerakli filtrlarni tepa panelga»), both tabs, all in
  the URL (`payroll/payrollFilters`). «Boʻlim» (`?blocks=`, the five block
  keys, enumerated — an unknown one is a 400, the hook drops it first) and
  «ROP» (`?rops=`, team labels, `(ROP yoʻq)` = `PAYROLL_NO_ROP_PICK` for the
  no-team bucket) PICK TEAMS ON THE SERVER: `payrollPickTest` on a TEAM LABEL
  — a seller's row by the team they are printed in, a previous row by the
  label it wore THEN, a ROP's basis by the label it was sold under — applied
  AFTER the ranks (the badge stays «Kompaniyada N-oʻrin») and before every
  sum, so totals, fund, previous, `gone`, teams and blocks are the picked
  teams' own, to the soʻm; a seller's own growth stays theirs. The pick is in
  the memo key (`payrollPickKey`, order-free); the rows memo is the window's,
  so a pick costs arithmetic, no scan. `choices` carries the window's WHOLE
  block and team list whatever is picked — the options; «ROP» lists only the
  picked blocks' teams, plus any stale-link pick. `/payroll/days` stays on the
  window alone. «Bosqich» (`?tiers=` fixed / nofixed / near — `tierProgress`
  ≥ 80%) and «Oʻsish» (`?trend=` up / down / new, by FAKT 2 against
  `previous`; drawn only with a comparison window) PICK PEOPLE IN THE BROWSER,
  never sent: like the search they take the team / block / company sums off
  the sheet (some of a team summed is nobody's pay) and a «Koʻrsatilgan: N
  kishi · soʻm» chip counts what is drawn. Inside a control «or», across
  controls «and». Pinned in `tests/services/payrollPick.test.ts` and
  `tests/features/payrollFilters.test.tsx`.
- **KPI rejalari** — the preset picks the plan but does not slice it. «Bugun»
  and «Shu oy» give identical numbers inside one plan.
- **Struktura** — **no money and no reporting window, and both are load-bearing
  absences.** The client's instruction was that money is stated on «Boshqaruv
  markazi» and nowhere else; that screen was removed on 2026-09-10 and the
  instruction stood, so this page still states none — the card's revenue, the
  list view's «Sotuv» /
  «Tushum» columns, the roster's per-person figures and the «Ishlagan xodimlar»
  ring are all gone. «Ishlagan» went with them because it is not a headcount at
  all — it is "closed a revenue deal in the window", which on a page with no
  window would silently have meant *today* and printed 0 beside almost every
  unit at nine in the morning. With nothing left on the page reading a window,
  the control over it could only lie, so `PageShell` gets `period={false}` and
  both endpoints dropped their `Period` argument. Do not reintroduce a figure
  here without reintroducing a window and a gate; `tests/http/routeAccess.test.ts`
  fails if a route grows `periodFrom`, `ctx.currency` or `analytics:read:all`
  back.
  Totals must be summed over the tree's roots; children are already rolled into
  every parent, so flattening double-counts. The screen re-creates the portal's
  own `hr/structure` org chart, with the old indented table kept behind a
  `?view=list` toggle — both are renderings of ONE `/insights/structure` answer,
  so they cannot disagree and switching costs no request. It prints **two
  headcounts that are both right**: `subordinateCount` is Bitrix24's membership
  minus the head, the figure the floor checks against the portal, while
  `activeHeadcount` counts who is CREDITED here by this dashboard. They differ
  on five of the twenty units. Everything else worth knowing about it is under
  *The org chart* below.

---

