/**
 * Uzbek UI strings.
 *
 * Kept in one module rather than inline so a second language is a new file and
 * a lookup swap, not a sweep through every component. Deliberately a plain
 * object: a full i18n runtime is not warranted for one locale, and this keeps
 * the door open without the dependency.
 */

export const t = {
  app: {
    name: 'SinoLife',
    subtitle: 'Savdo tahlili',
  },

  /**
   * The ten sections, in the order and wording the client asked for.
   *
   * Latin Uzbek, matching every other label in the product — the request
   * arrived in Cyrillic and the client confirmed Latin was fine, so the menu
   * reads in one script rather than two. (A superseded copy of this note stood
   * above it saying the labels were kept in Cyrillic; it contradicted the code
   * under it and went with the 2026-09-10 sweep.)
   *
   * `overview` — «Boshqaruv markazi» — was the eleventh and was removed on
   * 2026-09-10. `/` renders no screen now; see `LANDING_ROUTE`.
   */
  nav: {
    cohort: 'Mijoz qaytishi',
    customers: 'Qoʻngʻiroqlar',
    logistics: 'Logistika natijasi',
    sales: 'Savdo dinamikasi',
    confirmation: 'Tasdiqlash navbati',
    kpi: 'KPI rejalari',
    rnp: 'RNP jadvali',
    structure: 'Kadrlar tuzilmasi',
    sellers: 'Sotuvchilar reytingi',
    payroll: 'Sotuvchilar oyligi',
    margin: 'Yalpi marja',
    marketing: 'Reklama samarasi',
    leads: 'Lidlar',
    target: 'Target tahlili',
    roistat: 'Roistat',
    /** Not one of the nine: account administration, shown only to an admin. */
    users: 'Foydalanuvchilar',
  },

  /**
   * Section headings, and the one-line explanation MOST modules lead with.
   *
   * The explanation is not decoration. Most screens here report something a
   * reader could misread as a more familiar figure — a "sklad" page that shows
   * dispatch rather than stock, a confirmation rate that says nothing about
   * whether the order survived — so they state what they are measuring before
   * they show a number.
   *
   * Two entries carry a title and no lead, and each says why below its own
   * key: Kadrlar tuzilmasi and Tasdiqlash navbati. Both are screens whose own
   * controls already answer the question the sentence was answering, and both
   * are sized to the viewport, where the line costs a card or a row rather
   * than nothing. A missing `lead` is a decision here, not an omission —
   * nothing types this object per module, so nothing else will tell you.
   */
  modules: {
    cohort: {
      title: 'Mijoz qaytishi',
      lead: 'Har oy birinchi marta xarid qilgan mijozlarning qanchasi keyingi oylarda qaytgani — kogorta tahlili.',
    },
    /*
      THE LEAD NAMES WHAT A CALL IS JOINED TO AND WHICH CLOCK IT IS ON.
      `call_record."dealId"` is set on 1 row of 366 300, so a call cannot be
      traced to an order, and every figure is dated by the call's START in
      Tashkent time. The key stays `calls` while the URL and section stay
      `customers` — see CallsPage.
    */
    reklama: {
      title: 'Reklama samarasi',
      lead: 'DM, targetologlar va lid sifati — mijozning oʻz jadvallari, Meta Ads va Bitrix24 dan har kuni oʻzi yigʻiladi. Kunlar Toshkent vaqti boʻyicha.',
    },
    rnp: {
      title: 'RNP jadvali',
      lead: 'Mijozning «РНП» jadvali — har bir koʻrsatkich kunma-kun, fakt, prognoz va reja bilan. Raqamlar Bitrix24 va Meta Ads dan oʻzi yigʻiladi; rejalar, P&L xarajatlari va «Ходим сони» shu jadvalda kiritiladi. Kunlar Toshkent vaqti boʻyicha.',
    },
    leads: {
      title: 'Lidlar',
      lead: 'Bitrix24 ga tushgan har bir lid — qaysi manbadan kelgani, qanchasi kval boʻlgani va qachon tarqatilgani. Kunlar Toshkent vaqti boʻyicha.',
    },
    target: {
      title: 'Target tahlili',
      lead: 'Target sahifalaridan kelgan leadlar — qaysi manba, targetolog va kreativdan kelgani, qanchasi buyurtmaga aylangani va qancha pul keltirgani. Bitrix24 dagi yaratilgan sana boʻyicha, Toshkent vaqti.',
    },
    roistat: {
      title: 'Roistat — skvoznaya analitika',
      lead: 'Meta Ads rasxodidan Bitrix24 dagi lid, kval, buyurtma va sotuvgacha — bir oynada. Kunlar Toshkent vaqti boʻyicha.',
    },
    calls: {
      title: 'Qoʻngʻiroqlar',
      lead: 'Kim qancha gaplashgani — qoʻngʻiroq boshlangan vaqt boʻyicha, Toshkent vaqti. Qoʻngʻiroq mijozga bogʻlanadi, buyurtmaga emas.',
    },
    /*
      WHICH DATE THE WINDOW IS APPLIED TO, on the screens that disagree.

      "Tushum" is one word for more than one measurement on this dashboard.
      Logistics and the dispatch points window on the day an order was TAKEN
      and then report what became of it; the screens that report money window on
      the day a deal was CLOSED. Both are right for their own question — a
      courier is judged on the parcels handed to it, a department on the money
      it banked — but the median order takes 25 days to travel between the two,
      so the same preset gives them genuinely different totals.

      A reader comparing them has no way to know that unless it is written
      down. `t.period.closedBasis` already says this beside the deltas that
      need it; these leads say it where a whole page needs it.

      Kadrlar tuzilmasi used to be the third screen in this note and no longer
      belongs to it at all: it reports no money and has no window.
    */
    /*
      THE CLOCK IS IN THE LEAD LINE BECAUSE IT CHANGED.

      This screen was cohorted on the order’s CREATION date until 2026-09-10,
      and the line here said so. It now runs on the arrival in Тасдиклаш
      (C4:NEW) — the cohort FAKT 1 and FAKT 2 are on, and the one the
      client's own sheet turned out to be on. A lead line still naming the
      old basis would be the most confidently wrong sentence on the page.
    */
    logistics: {
      title: 'Logistika natijasi',
      lead: 'Kunlik logistika hisoboti: ЗАКАЗ (FAKT 1) qanday taqsimlangan, qaysi pochta qanday ishlayapti va har bir Bitrix24 bosqichi. Davr buyurtma tasdiqlash navbatiga TUSHGAN sana boʻyicha.',
    },
    /*
      NO LEAD LINE — the board prints nothing under its title in any mode
      (`description={null}` in ConfirmationPage), so this key has no call site.

      The sentence that stood here carried the two facts an owner needs to
      reconcile the screen with Bitrix24: that only orders which reached a
      confirmation stage are on the board, and that the window is applied to
      the day an order ARRIVED in Тасдиклаш rather than to its Дата создания.
      Neither fact is lost, and neither was being learned here — a caption
      above six state tiles is not where somebody checks a definition. They are
      stated where a reader who is actually reconciling looks: the cohort in
      `insightsRepository`'s queue SQL and in CLAUDE.md's confirmation-queue
      section, both of which say it at length, and the window in the preset row
      immediately under the title.

      What the line cost was two rows of the densest table in the application,
      at every width the board is read at — which is why it went rather than
      being shortened.
    */
    confirmation: {
      title: 'Tasdiqlash navbati',
    },
    margin: {
      title: 'Yalpi marja',
      /*
        THE BASIS IS IN THE LEAD, like Logistika's and Joʻnatish nuqtalari'.

        Every money figure on this screen windows on `closedAt`, and the only
        other thing under the title was a date range — so a reader comparing it
        against Logistika, which windows on the day the order was TAKEN, had
        nothing on either screen telling them the two spans mean different
        things. On this portal the median order takes 20-25 days between those
        two clocks, so the gap is not a rounding difference.
      */
      lead: 'Mahsulot boʻyicha tushum, tannarx va yalpi foyda. Davr bitim YOPILGAN sana boʻyicha.',
    },
    /*
      NO LEAD LINE HERE EITHER — the same conclusion as the confirmation board
      above, reached by a different route and enforced by a different prop:
      that page suppresses the line with `description={null}` while this one
      never has a line to suppress, because `period={false}` means PageShell
      reserves nothing for dates that are not coming. The old one read «Boʻlimlar, rahbarlar va har bir boʻlimning
      natijasi. Davr bitim YOPILGAN sana boʻyicha» — and both halves of that are
      now false: the page reports no «natija» in soʻm (the client asked for
      money to be stated on «Boshqaruv markazi» and nowhere else; that screen
      has since gone and the absence here stayed) and it has no «davr» at all. What is left
      to say about the screen the chart says in its own controls, and the page
      passes no description, so the line is not even reserved: on a canvas sized
      to the viewport, 20px of held-open space is 20px of chart.
    */
    structure: {
      title: 'Kadrlar tuzilmasi',
    },
  },

  period: {
    label: 'Davr',
    today: 'Bugun',
    yesterday: 'Kecha',
    this_week: 'Shu hafta',
    this_month: 'Shu oy',
    previous_month: 'Oʻtgan oy',
    this_year: 'Shu yil',
    custom: 'Tanlangan davr',
    pick: 'Sana',
    day: 'Kun',
    month: 'Oy',
    year: 'Yil',
    range: 'Oraliq',
    from: 'Boshlanish',
    to: 'Tugash',
    apply: 'Qoʻllash',
    comparedTo: 'oldingi davrga nisbatan',
    /*
      The basis, stated where the delta is.

      Revenue is recognised at Доставлено, and the median order takes 25 days
      to get there — so a to-date monthly comparison is measuring warehouse
      throughput as much as selling. Only 898 of August's 3,574 wins were
      CREATED in August; the rest came from June and July. Saying so is the
      honest fix; changing the basis would break the portal reconciliation.
    */
    closedBasis: 'Yopilgan sana boʻyicha — buyurtma oʻrtacha 25 kunda yopiladi',
    truncated: 'Taqqoslash davri qisqartirildi',
  },

  /**
   * The ⌘K command palette and its header trigger.
   *
   * Footer strings (↑↓ tanlash · ↵ ochish · Esc yopish) and the placeholder
   * live inside the CommandPalette primitive itself; only what Shell wires —
   * the trigger chip and the group headings — belongs here. "Davr" is not
   * duplicated: the period group reuses t.period.label.
   */
  palette: {
    search: 'Qidiruv',
    sections: 'Boʻlimlar',
    // Beside the preset the page is already showing — so choosing it again
    // reads as a no-op before it is one.
    currentPeriod: 'joriy',
  },

  cards: {
    kpiAchievement: 'KPI bajarilishi',
  },

  chart: {
    /*
      THE CARD HEADLINES WHAT IT PLOTS, AND SINCE 2026-09-10 THAT IS TWO
      THINGS, NOT THREE.

      It read «FAKT 1 / FAKT 2 va tushum» while the panel drew a closed-revenue
      area with the pair as lines over it. The client took the revenue off this
      screen — «menga bu boʻlim fakt 1 va fakt 2 va bitrix24dan» — so the title
      names what is left, and the basis line below no longer has a second clock
      to reconcile.
    */
    faktTrend: 'FAKT 1 / FAKT 2',
    /*
      The basis and the bucket are two separate facts, so they are two strings.

      The bucket is NOT fixed: the server widens it as the window grows —
      daily up to about two months, then weekly, then monthly — so a single
      hint reading "kunlar kesimida" was a plain misstatement on «Shu yil»,
      where each point is a week and each label is that week's first day.
    */
    faktTrendBasis: 'Navbatga tushgan sana boʻyicha',
    /*
      THE CLOCK, NAMED WHEREVER THE FIGURES ARE READ CLOSELY — the legend and
      the tooltip both carry it.

      FAKT 1 and FAKT 2 are dated by the order's arrival in the confirmation
      queue (C4:NEW), not by the day it was delivered: a July order delivered
      in August adds to July's FAKT 2. Unsaid, a reader reconciling a month
      against the portal concludes the chart is broken — which is what
      `FaktBasisNote` further down the page exists to prevent for the tiles.
    */
    faktBasis: 'FAKT 1 / FAKT 2 — navbatga tushgan sana boʻyicha',
    fakt1: 'FAKT 1 · tasdiqlangan',
    fakt2: 'FAKT 2 · yetkazilgan',
    buckets: {
      day: 'kunlar kesimida',
      week: 'haftalar kesimida',
      month: 'oylar kesimida',
    },
  },

  table: {
    employee: 'Xodim',
    status: 'Holat',
  },

  status: {
    OPEN: 'Ochiq',
    WON: 'Muvaffaqiyatli',
    LOST: 'Bekor qilingan',
  },

  kpiStatus: {
    ACHIEVED: 'Bajarildi',
    ON_TRACK: 'Rejada',
    AT_RISK: 'Xavf ostida',
    BEHIND: 'Orqada',
  },

  delta: {
    // NOT 'yangi'. On an employee leaderboard that word means "new hire", and
    // it was shown for 51 of 126 people — including staff hired five months
    // earlier with 498 orders behind them. It means "the baseline period was
    // empty", which is a statement about the comparison, not about the person.
    no_baseline: 'baza yoʻq',
    small_base: 'baza kichik',
    no_data: 'maʼlumot yoʻq',
    unchanged: 'oʻzgarishsiz',
  },

  state: {
    loading: 'Yuklanmoqda…',
    // "No data" and "failed to load" are deliberately different messages:
    // one is a fact about the business, the other is a fault.
    emptyTitle: 'Maʼlumot yoʻq',
    emptyBody: 'Tanlangan davr va filtrlar boʻyicha bitim topilmadi.',
    errorTitle: 'Maʼlumotni yuklab boʻlmadi',
    errorBody: 'Server bilan bogʻlanishda xatolik yuz berdi.',
    retry: 'Qayta urinish',
  },

  badge: {
    demo: 'Demo maʼlumot',
    demoHint: 'Koʻrsatilgan raqamlar sinov uchun yaratilgan, haqiqiy emas.',
    live: 'Bitrix24',
    lastSync: 'Oxirgi yangilanish',
    justNow: 'hozirgina',
    minutesAgo: 'daqiqa oldin',
    hoursAgo: 'soat oldin',
    daysAgo: 'kun oldin',
  },

  /**
   * WHICH EVENT a figure counts: the KPI table's column headings say
   * «Yetkazilgan» — money that landed (`countsAsRevenue`, status WON,
   * bucketed by `closedAt`) — so they are never read as a seller's own close.
   */
  basis: {
    deliveredRevenueColumn: 'Yetkazilgan tushum',
    deliveredDealsColumn: 'Yetkazilgan bitim',
  },

  /**
   * Kirish, va hisobning ikkinchi qulfi.
   *
   * WHY THESE ARE HERE AND NOT INLINE. Two screens say some of the same
   * things — /login asks for a code, /account confirms the first one — and the
   * sentence that must never drift between them is the one about what happens
   * when the phone and the backup codes are both gone. A string written twice
   * is a string that will eventually mean two different things.
   *
   * These are also the only strings in the app a person reads while LOCKED
   * OUT, which is the worst moment to be vague. Every refusal below says what
   * happened and what to do next, and none of them says anything about whether
   * an account exists.
   */
  auth: {
    signIn: {
      title: 'Tizimga kirish',
      lead: 'Hisobingiz bilan davom eting.',
      email: 'Login',
      password: 'Parol',
      submit: 'Kirish',
      submitting: 'Kirilmoqda…',
      adminNote: 'Kirish maʼlumotlari administrator tomonidan beriladi.',

      /*
        Deliberately vague, and only here. Naming which of the two fields was
        wrong turns the form into an oracle for which addresses are real.
      */
      wrongCredentials: 'Email yoki parol notoʻgʻri.',

      /*
        Everything below must NOT wear that message. An origin rejection shown
        as "wrong password" is how a working password came to look broken: the
        app answers on several addresses, better-auth trusts one, and the
        resulting 403 was rendered as a credential problem for twenty minutes
        of retyping.
      */
      wrongOrigin: (url: string) =>
        `Bu manzildan kirish mumkin emas. Ilovani ${url} orqali oching.`,
      serverDown: 'Server javob bermadi. Birozdan soʻng qayta urinib koʻring.',
      offline: 'Kirish amalga oshmadi. Internet aloqasini tekshiring.',
      failed: (detail: string) => `Kirish amalga oshmadi: ${detail}`,

      /*
        better-auth's own per-minute throttle, which is a different thing from
        the account lockout: it clears on its own within the rate-limit window
        (60 seconds, `rateLimit.window` in server/auth/auth.ts) and counts
        requests from this address rather than failures against this account.
        The account lockout arrives with its own message, in minutes, and is
        shown as the server wrote it.
      */
      throttled: 'Juda koʻp soʻrov. Bir daqiqadan soʻng qayta urinib koʻring.',
    },

    /** The second step, after the password was right. */
    challenge: {
      title: 'Tasdiqlash kodi',
      lead: 'Autentifikator ilovangizdagi 6 xonali kodni kiriting.',
      leadBackup: 'Zaxira kodlaringizdan birini kiriting. Har bir kod bir marta ishlaydi.',
      codeLabel: 'Kod',
      backupLabel: 'Zaxira kod',
      backupHint: 'Koʻrinishi: xxxxx-xxxxx',
      submit: 'Tasdiqlash',
      submitting: 'Tekshirilmoqda…',
      useBackup: 'Zaxira kodni ishlatish',
      useCode: 'Ilova kodiga qaytish',

      /*
        "Notoʻgʻri yoki eskirgan" — both, because the reader cannot tell them
        apart and the fix differs: a wrong code is retyped, a stale one is
        waited out. It says nothing else; a code rejected for an account that
        does not exist reads identically.
      */
      invalidCode: 'Kod notoʻgʻri yoki eskirgan.',
      invalidBackup: 'Zaxira kod notoʻgʻri yoki allaqachon ishlatilgan.',

      /*
        The challenge itself is spent — five wrong codes inside one sign-in, or
        a challenge cookie that expired. The password step has to be walked
        again, so the message says so rather than leaving a dead form on
        screen.
      */
      expired: 'Tasdiqlash muddati tugadi. Emailingiz va parolingiz bilan qaytadan kiring.',

      /*
        The plugin's own account-level lock. FIFTEEN MINUTES MIRRORS
        `accountLockout.durationSeconds: 900` in server/auth/auth.ts — the
        plugin's refusal carries no remaining time, only an English sentence,
        so the number is repeated here. If that config changes, this changes.
      */
      locked:
        'Koʻp marta notoʻgʻri kod kiritildi. Tasdiqlash 15 daqiqaga toʻxtatildi — shundan soʻng qayta urinib koʻring.',
      restart: 'Qaytadan kirish',
    },

    /** Enrolment, on /account. */
    twoFactor: {
      title: 'Ikki bosqichli himoya',
      lead: 'Parolga qoʻshimcha qulf: kirishda telefoningizdagi ilova bergan 6 xonali kod ham soʻraladi.',
      armed: 'Yoqilgan',
      notArmed: 'Yoqilmagan',
      armedBody: 'Kirishda parol va autentifikator kodi soʻraladi.',
      notArmedBody: 'Hozir kirish uchun faqat parol yetarli.',

      /*
        The one line that must be on the screen and not only in a comment.
        There is one user and no administrator behind them: losing the phone
        and the codes together means a database edit by whoever holds the
        connection string. Muted, one sentence, next to the thing it describes
        — a red banner would be read once and then ignored forever.
      */
      recovery:
        'Telefon ham, zaxira kodlar ham yoʻqolsa, hisobga kirishning boshqa yoʻli qolmaydi.',

      start: 'Yoqish',
      passwordLabel: 'Joriy parol',
      passwordHint: 'Sozlashni boshlash uchun parolingizni tasdiqlang.',
      begin: 'Davom etish',
      preparing: 'Tayyorlanmoqda…',
      cancel: 'Bekor qilish',

      stepScan: 'QR kodni skanerlang',
      stepScanBody:
        'Autentifikator ilovangizda (Google Authenticator, Aegis, 1Password va boshqalar) yangi hisob qoʻshing va shu kodni skanerlang.',
      qrAlt: 'Autentifikator ilova uchun QR kod',
      qrUnavailable: 'QR kod chizilmadi — quyidagi kalitni qoʻlda kiriting.',
      secretLabel: 'Yoki kalitni qoʻlda kiriting',
      secretHint: 'Baʼzi ilovalar kamera ishlatmaydi — kalitni matn sifatida kiritish mumkin.',
      copySecret: 'Kalitdan nusxa olish',

      stepCodes: 'Zaxira kodlarni saqlang',
      stepCodesBody:
        'Bu kodlar faqat hozir koʻrsatiladi. Har biri bir marta ishlaydi va telefon yoʻqolganda kirishning yagona yoʻli boʻlib qoladi.',
      codesWhere:
        'Qogʻozga koʻchiring va brauzerdan tashqarida saqlang — shu noutbukdagi parol menejeri zaxira emas.',
      copyCodes: 'Kodlardan nusxa olish',
      copied: 'Nusxa olindi',
      copyFailed: 'Nusxa olinmadi — matnni belgilab, qoʻlda koʻchiring.',
      savedCheckbox: 'Kodlarni saqladim',

      stepConfirm: 'Birinchi kodni kiriting',
      stepConfirmBody: 'Ilova kod bera olishiga ishonch hosil qilgach, himoya yoqiladi.',
      confirmLabel: 'Ilovadagi kod',
      confirmHint: 'Kod har 30 soniyada yangilanadi.',
      arm: 'Yoqish',
      arming: 'Yoqilmoqda…',
      armedNow: 'Yoqildi',
      needCodesSaved: 'Avval zaxira kodlarni saqlang va belgini qoʻying.',

      disable: 'Oʻchirish',
      disableBody:
        'Oʻchirilgandan soʻng kirish uchun yana faqat parol yetarli boʻladi, zaxira kodlar esa bekor qilinadi.',
      disabling: 'Oʻchirilmoqda…',
      disabledNow: 'Oʻchirildi',

      wrongPassword: 'Joriy parol notoʻgʻri.',
      codeRejected: 'Kod notoʻgʻri yoki eskirgan. Ilovadagi joriy kodni kiriting.',
      throttled: 'Juda tez — bir necha soniyadan soʻng qayta urinib koʻring.',
      generic: 'Amal bajarilmadi. Qayta urinib koʻring.',
    },
  },
} as const
