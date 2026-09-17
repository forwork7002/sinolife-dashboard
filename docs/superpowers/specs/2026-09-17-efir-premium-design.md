# EFIR Premium — «Sotuvchilar reytingi» taxtasini premium darajaga ko‘tarish

**Sana:** 2026-09-17. **Holat:** amalga oshirildi — premium branch'i, deploy kutmoqda.
**Asos:** `2026-09-16-efir-taxta-design.md` (EFIR) — TUZILMA va SEMANTIKA o‘z kuchida (timing-tower qatorlar, tasma + gerb, uch o‘rindiq, bir qatorli komandalar, FAKT 1/FAKT 2 kaliti, rekord devori, legenda, qatorda chase yo‘q, daraja so‘zi faqat o‘rindiqda). Bu hujjat uning VIZUAL materialini, layout o‘lchamlarini, medal tizimini va siyrak («Bugun») holatini ALMASHTIRADI; motor/DTO/API — faqat bitta joyda tegiladi (`MEDAL_ORDER`, pastda).
**Aktivlar (BIRLAMCHI manba — o‘lcham, rang, markup, SVG):** `docs/superpowers/specs/assets/2026-09-17-efir-premium/`
`final-month.html` (Shu oy, qorong‘i) · `final-month-light.html` · `final-today.html` («Bugun» — DIQQAT: undagi «Shu oy yetakchilari / Shu oy komandalari» bloklari va «hozircha» yorliqlari mijoz tomonidan RAD ETILGAN, qurilmaydi) · `final-check.html` (chekka holatlar fixture'i) · `final.css` (barcha qoidalar) · `final-tokens.css` (yakuniy tokenlar, ikkala mavzu) · `final-defs.svg.html` + `gen-final-defs.js` (SVG `<defs>` va uning generatori) · `medals.html` (medal namunalari) · `final-synthesis.json` (`implementation_delta` — 149 bandli batafsil xarita; ushbu spec bilan zid joyda SPEC ustun) · `board-data.json` (2026-09-17 production surati).

## Nega

EFIR 2026-09-17 09:18 da production'ga chiqdi. Mijoz: «dizaynni yanada uyg‘unlashtirib, premium darajada yaxshilash kerak — juda arzonga o‘xshab qolgan; medallarning ko‘rinishini kuchaytirish kerak; ma’lumotlar to‘g‘riligiga ishonch komil bo‘lsin».

**Ma’lumot auditi (production bazasi, faqat o‘qish, mustaqil SQL):** pul so‘mgacha mos (102 sotuvchi, 14 komanda, jami; Logistika bilan ham), 127 sotuvchining darajalari va medallari mos, sahifadagi 5 225 raqam payload bilan mos. Raqamlar TO‘G‘RI; lekin ko‘rinish to‘g‘ri raqamni xatodek ko‘rsatgan joylar bor (pastda «To‘g‘rilik ko‘rinishi»).

**Haqiqiy 1920 kadr (yon panel ochiq):** sotuvchilar ustuni ≈ 978 px, komandalar ≈ 652 px, ikkalasi ≈ 870 px baland (EFIR mocki 1112/696 deb faraz qilgan edi). Jonli nuqsonlar: rekord devori bandlari ustma-ust; komanda nomi «Komp…», qatordagi komanda «A…»; FAKT 1 rejimida komandalar raqami «Buyurtma» ustiga chiqadi; «Bugun» ertalabki holatda «— 0 0 0» qatorlar va bo‘sh ustunlar; medallar ikonka-shriftdek; o‘rindiqlar 1 px ramkali tekis qutilar; hamma matn bir xil Inter semibold oq.

## Mijoz qarorlari (2026-09-17)

1. Yakuniy mock (OBSIDIAN shassi + «ZARB» medal to‘plami) — TASDIQLANDI.
2. «Bugun» ko‘rinishida oy konteksti bloklari — YO‘Q (faqat bugungi ma’lumot). Ikkinchi `this_month` so‘rovi QO‘SHILMAYDI.
3. «hozircha» yorlig‘i — YO‘Q (rekord devorida ham, medal izohida ham, sahifa tagida ham).
4. Medal tartibi: haqiqiy metall birinchi; qatorda eng ko‘pi 3 ta; «+N» YO‘Q — TASDIQLANDI (server `MEDAL_ORDER` shu commit'da o‘zgaradi).

## §1 Material va tokenlar

- Qatlamli qora, yuqoridan BITTA yorug‘lik: sirtlar 1 px ramka bilan emas, ko‘tarilish (gradient + ichki yuqori yorug‘ chiziq + soya) bilan ajraladi. Barcha `--efir-*` tokenlar sotuvchilar ildizi (`.tv-board-shell`) ostida e’lon qilinadi — ikkala mavzu (`final-tokens.css` dan AYNAN; hech qanday `color-mix()` qolmaydi, aralashmalar oldindan hisoblangan).
- `--tier-1..6` yakuniy rampa + har biriga `-hi`, `-lo`, `-wash`. Qoida o‘zgardi: «yuqori daraja panelga nisbatan KO‘PROQ kontrast» (qorong‘ida xira → yorqin; yorug‘da och → to‘q ko‘k). Kontrastlar: qorong‘i 2.44 / 3.55 / 5.26 / 9.80 / 14.34 / 18.30; yorug‘ 1.72 / 2.57 / 3.61 / 4.96 / 7.90 / 13.23 (test pinlaydi). `--efir-ink-3` ≥ 4.5:1, `--efir-ink-2` ≥ 6:1.
- Metall: `--medal-gold/silver/bronze` o‘rta ton sifatida QOLADI (boshqa o‘quvchilar buzilmasin) + `-hi/-lo/-sh/-patina/-well` (oltin, kumush, bronza, po‘lat), `--medal-gilt(-hi)`, to‘rt `--medal-*-wash`, `--medal-key/cast/glint/edge`, `--sheen-*`, `--bloom`, `--ribbon-*`, `--recess-*`, `--slot-*`, `--crest-*`, `--halo-field-*`. `--glow-rare` O‘CHADI.
- Umumiy xrom (`PageShell`, davr boshqaruvi) faqat sahifaga xos sinf orqali uslublanadi — o‘sha fayllar `/confirmation` ga yetadi, TAHRIRLANMAYDI.

## §2 Tipografiya

Inter (variable: 560/620 og‘irliklar; statik fallback qabul). Ierarxiya: ism 19 px/500 (o‘rindiqda ikki qator), kod tokeni («197») ismdan keyin sokin kichik; qahramon pul 23 px/620 (qatorda), 40/52 px/560 (o‘rindiqlar); ikkinchi darajali raqamlar 15 px `--efir-ink-2`; yorliqlar 11–12 px caps, tracking. `tnum lnum` har doim. U+202F ajratgichlari O‘RALMAYDI va TORAYTIRILMAYDI (Firefox'da guruh oralig‘ini yo‘qotadi). Nol yoki null ikkinchi darajali qiymat — xira chiziqcha (`.row__none`), hech qachon qalin «0».

## §3 Medallar, gerb, rank tangasi — «ZARB»

- `medalDefs.ts` = `final-defs.svg.html` dagi `<defs>` (generator `gen-final-defs.js`, aktivda; 87 id: metall gradientlari `mg-*`, planchetlar `pl-*`, qurilmalar `dv-*`, yo‘l-raqamlar `n0..n9`,`nx`, `#ch`, `m-<code>` ×14 metall ichiga pishirilgan, `m-laurel-*`, `crest-0..6`, `crest-plate(-6)`, `halo-1..3`, `halo-sm-1..3`, `halo-laurel`, `halo-ghost`). `<defs>` ichida `color-mix`, `filter`, `class="cut"`, custom-property ichida `url()` YO‘Q.
- **Shakl oilani, metall nodirlikni aytadi.** `MEDAL_METAL: Record<MedalCode,{body,dev}>`: year-champion, month-gold, day-record, conversion-master, streak-fire — oltin/oltin; month-silver — kumush; month-bronze — bronza; streak-steady, day-winner, clean-month, jump, rookie — po‘lat/gilt; first-sale, work-month — po‘lat/po‘lat. `Metal` ga `'steel'|'gilt'` qo‘shiladi.
- **Tartib (frontend + SERVER bir commit'da):** year-champion, month-gold, month-silver, month-bronze, streak-fire, conversion-master, day-record, streak-steady, clean-month, jump, rookie, day-winner, work-month, first-sale. `src/server/domain/analytics/sellerMedals.ts` `MEDAL_ORDER` va uning testi, `medalCatalog.ts` nusxasi va «Mirrors» izohi birga o‘zgaradi.
- **Qator:** 3 ta joy, 28 px, o‘ngdan chapga (eng nodiri pul yonida), sanoq yo‘q, «+N» YO‘Q, `first-sale` yashirin (o‘zgarmagan). **O‘rindiq:** `seatMedals(medals, cap)` — saralash, nodir/gilt bor bo‘lsa first-sale va work-month tushadi, P1 da 4 ta 48 px, P2/P3 da 3 ta 40 px; ×N plastinkasi va oy medallarida dafna FAQAT o‘rindiqda; ostida eng yuqori medal nomi + sanasi (`.seat__cap`) — «hozircha» so‘zisiz.
- **Gerb:** bitta `<use href="#crest-N">`, `.crest { color: var(--tier) }`, o‘lcham `height` prop bilan (qator 20, legenda 15, o‘rindiq 18/20), o‘rindiqda `plated`. Ko‘tarilish animatsiyasi bitta `#ch` qoplamasi (`crest__cell--fill`).
- **Rank tangasi (`Halo`):** zarb qilingan tanga SVG (yo‘l-raqam, shrift yo‘q); P1 da tashqi dafna; o‘lchamlar P1 66, P2/P3 56, sahna 84, komanda ranklari 30 (`small`). >3 rank — tanga yo‘q.

## §4 O‘rindiq

`.tv-podium` grid `minmax(0,1fr) minmax(0,1.24fr) minmax(0,1fr)`, balandlik 291; o‘rindiq 255 (P1 277) px; ramka yo‘q — uch qatlamli fon (metall keyline, radial yuvish, vertikal ko‘tarilgan gradient) + ichki halqa + soya; 6 px `seat__band` inley. Tarkib: tanga · ikki qatorli ism (kod 2-qatorda sokin) · meta (plastinali gerb, daraja so‘zi 11 px caps `--efir-ink-2`, komanda — sig‘masa BUTUNLAY tushadi, hech qachon «A…») · pul (BITTA matn tuguni) · FAKT qatori (boshqa fakt faqat > 0 bo‘lsa) · progress: «Ustozga 127 010 000 qoldi», 4 px metr, va YANGI qator **«Avgustdan beri 172 990 000 / 300 000 000»** (`medal.delivered` / `medal.nextLevelAt`) · medal tokchasi + izoh. Ism bo‘linishi umumiy `parseSellerName(raw) → {name, code}` (`sellerName.ts`) orqali.

## §5 Qator va ro‘yxat

Grid `6px 38px 68px minmax(0,1fr) 80px 96px 148px 104px 40px 60px`, gap 8, balandlik 43. Tartib: tasma · rank · gerb · ism(+kod) · KOMANDA (o‘z 80 px ustunida) · medallar · QAHRAMON (faol fakt, 148 px) · boshqa fakt (104 px) · buyurt. · konv. **Faol fakt har doim qahramon ustunida** — FAKT 1 rejimida ustunlar almashadi (jonli overprint shu bilan yo‘qoladi). Ism uyasi: kod tokeni ism kesilishidan OLDIN tushadi. Fon: pastda 1 px `--efir-hairline` + chapda 88 px `--tier-wash`. Ro‘yxat balandligi har doim qator balandligining butun karrasi (ResizeObserver; 1920/rail ochiq: 11 × 43 = 473), `scroll-snap` qatorlarga; `useAutoScroll` drifti qoladi, dam olish nuqtalarida yarim qator ko‘rinmaydi. Yorliq qatori ro‘yxat tashqarisida (o‘zgarmagan); faol ustun yorlig‘i `.on` + 22×2 belgi.

## §6 Komandalar

Grid `36px minmax(0,1fr) 136px 56px 92px 36px 56px`; rank 1–3 — kichik tanga (30 px), qolganlari sokin raqam; nom + sotuvchi soni BITTA uyada («Lola 9»; alohida «Sotuvchi» ustuni ketadi, yorliq «Komanda · sotuvchi»); qahramon = faol fakt; ulush brauzerda faol fakt bo‘yicha (o‘zgarmagan); `.trow__bar` — ulush ÷ yetakchi ulushi, 4 px, 1–3 da metall gradient. Qator balandligi `clamp(40px, floor(listHeight/n), 52px)` — 14 komanda 50 px da ustunni scrollsiz to‘ldiradi. **Tag plaketi (`footer.jami`):** «{n} komanda jami · FAKT» 30 px + boshqa fakt; o‘ngda «Komandasiz · {k} sotuvchi» puli, «Barcha sotuvchilar» jami, va izoh «Ulush {n} komanda jamidan hisoblanadi». Komandasiz pul = `rop === null` sotuvchi qatorlari yig‘indisi (sotuvchi yozuvlari komponentga uzatiladi; DTO o‘zgarmaydi). Test: komandalar + komandasiz = barcha qatorlar (ikkala fakt).

## §7 Sarlavha, rekord devori, kalitlar, legenda, sahifa tagi

- **Rekord devori:** grid `minmax(0,1fr) minmax(0,1fr)`, har biri 58 px plaket (`container-type: inline-size`): 32 px medal (joriy oy yetakchisi — month-gold; yopiq oy rekordi — day-record), caps yorliq (neytral siyoh, oltin EMAS), o‘ngda «57 ta yetkazilgan», qiymat qatori: ism (ellipsis) + kod + summa (hech qachon kesilmaydi). Container query: 400 px dan tor — sanoq tushadi, 320 px dan tor — kod tushadi. Tor sarlavhada bitta band + 10 s kesish (mavjud) qoladi. «hozircha» YO‘Q.
- **Ustun boshi / kalitlar:** bosh 42 px; kalit yonida izoh «FAKT 2 — yetkazilgan pul» / «FAKT 1 — tasdiqlangan pul»; `.tv-fakt` — botiq yo‘l, faol tab ko‘tarilgan gradient + 2 px `--tier-4` chiziq (oq to‘ldirish yo‘q); `/sellers` davr boshqaruvi va pushti aksent chizig‘i sahifaga xos sinf orqali.
- **Legenda:** 36 px botiq tasma, `space-between`, gerb 15 px; Yangi yorliqsiz (o‘zgarmagan).
- **Sahifa tagi (YANGI):** uch ta’rif — «Konv. = yetkazilgan ÷ (yetkazilgan + barcha bekor)», «Buyurt. = FAKT 1 buyurtmalari», «Daraja — avgustdan beri yetkazilgan pul bo‘yicha». («hozircha» ta’rifi YO‘Q.)
- **Sana qatori:** hafta kuni `Intl.DateTimeFormat('uz', {weekday:'long', timeZone:'Asia/Tashkent'})` bilan hisoblanadi («17-sentabr 2026, payshanba · bugun» faqat `today` presetida).

## §8 Siyrak holat («Bugun» ertalab) — faqat bugungi ma’lumot

- `earners` = faol raqami > 0 qatorlar; `queued` = faol raqami 0, lekin navbatda buyurtmasi bor qatorlar (`openOrders > 0` — reja DTO maydonini repozitoriy bo‘yicha tekshiradi; tasdiqlanmasa son yozilmaydi); hech narsasi yo‘q qatorlar RO‘YXATGA CHIQMAYDI.
- ≥ 3 earner — odatdagi uchlik. 1–2 earner — bitta to‘liq kenglikdagi `article.stage` (tanga 84 + dafna, ism 26 px, meta, progress «Avgustdan beri yetkazilgan», pul 56 px, ikki fakt qatori — ikkinchisi `won = 0` da «FAKT 2 hali yo‘q — yetkazish kutilmoqda», tokcha + izoh); 2-earner birinchi rank qatori. 0 earner — `#halo-ghost` + «Bugun hali savdo yo‘q».
- Sahnadan keyin «Tasdiq kutilmoqda» guruh sarlavhasi va `.row--queue` qatorlar (tasma, gerb, ism, komanda, medallar odatdagidek; bitta keng uya «{n} buyurtma tasdiq navbatida»). Rank «—» va qiymat «0» HECH QACHON chiqmaydi.
- Ustun boshi sanog‘i: «bugun N sotuvchi savdo qildi · M tasi tasdiq kutmoqda». Komandalar: faqat faol raqami > 0 komandalar rank bilan; bitta sokin qator «Hali savdosiz: A, B — navbatda K tadan buyurtma»; tag plaketi «Bugun jami · FAKT».
- Oy konteksti bloklari YO‘Q; qolgan joy sokin bo‘sh (panel materiali bilan), legenda va tag joyida.

## §9 To‘g‘rilik ko‘rinishi (auditdan)

«Avgustdan beri … / …» qatori (§4); faol fakt qahramon ustunida (§5); komandalar jami plaketi va yig‘indi testi (§6); `AnimatedNumber` BITTA matn tuguni chiqaradi (hozir `textContent` da raqam ikki marta); sahifa tagidagi ta’riflar (§7); nol/chiziqcha qoidasi (§2, §8). Tegilmaydi (ma’lum, hujjatlangan): komanda puli sotuvchining joriy bo‘limi bo‘yicha (Logistika — bitimdagi komanda bo‘yicha); portalning 1 so‘mlik shovqini («247 330 001») haqiqiy ma’lumot sifatida chiqadi; yopiq oy medallari yo‘ldagi buyurtmalar tufayli hali siljishi mumkin (mijoz yorliq so‘ramadi).

## §10 Moslashuv va tekshiruv

1366/0.8× blok va rail-yopiq kadr uchun ikkala grid qayta yig‘iladi; telefon (`max-width:1279`) `nth-child` yashirishlari yangi ustun tartibiga ko‘ra: komanda, medallar, boshqa fakt, buyurt., konv. yashirin; o‘rindiqlar ustma-ust; sahna va tag o‘raladi. **Vizual tekshiruv faqat aniq viewport'li headless chromium bilan** (MCP brauzeri dpr 0.667 — yolg‘on kenglik): `~/.npm/_npx/705bc6b22212b352` ichidagi node skript, 1920×1080 dpr 1, rail ochiq va yopiq, ikkala mavzu, ikkala FAKT, `today` va `this_month`; lokal seed siyrak bo‘lgani uchun production payloadlari `page.route` bilan berilib haqiqiy ma’lumotda ko‘riladi; 1366 va 390 ham. Mezon: kesilgan matn 0, ustma-ust matn 0, yarim qator 0, konsol xatosi 0.

## §11 Test

`efirCss.test.ts`: rampa kontrast-monotonligi (uch blok), siyoh kontrastlari, `--glow-rare` yo‘q, EFIR bo‘limida `color-mix()` ham taqiqlangan, yangilangan metall-istisno ro‘yxati, yangi grid satrlari (qator, 43 px, komandalar, `.trow__bar`), `.stage/.group/.row--queue`. `medalDefs` testi: `color-mix|filter|var(--m-|class="cut"` yo‘q, 14 `m-<code>`. `sellerName.test.ts` (6 shakl). `sellersEfir`/`sellersTvBoard`: medal soni aria-label'dan; qator medaliga bitta `<use>`, «+N» yo‘q; qahramon uyasi ikkala o‘qishda faol fakt; o‘rindiq `textContent` raqamni bir marta tashiydi; navbat qatorida «—»/«0» qiymat yo‘q; ro‘yxat balandligi qator balandligiga bo‘linadi; komandalar yig‘indi testi; hafta kuni 2026-09-17 → «payshanba». Domen: `MEDAL_ORDER` yangi tartibi va to‘liqlik testi.

## §12 Ishga tushirish va xavflar

Gate (verify + build + db:check 10/11) → «deploy qil» → push → TV tabini yangilash. Xavflar: TV qutisida 46 KB defs va qatoriga ~30 SVG tugun bilan drift silliqligi o‘lchanmagan (zaxira dastak — o‘rindiq 2–3 da «Avgustdan beri» qatorini tushirish; shriftni KICHRAYTIRMASLIK); gilt (po‘lat tanada shampan belgi) TV da oltindek o‘qilsa — besh kodning `dev` i `'steel'` ga (bir qatorli katalog o‘zgarishi); variable Inter `next/font` orqali berilishi tekshiriladi.
