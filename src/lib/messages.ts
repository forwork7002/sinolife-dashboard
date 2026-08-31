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
   * The nine sections, named exactly as the client's director listed them.
   *
   * Cyrillic and untranslated on purpose: this is the vocabulary the request
   * arrived in, and a dashboard whose menu says something slightly different
   * from what was asked for is a dashboard nobody is sure they received.
   */
  /**
   * The nine sections, in the order and wording the client asked for.
   *
   * Latin Uzbek, matching every other label in the product — the request
   * arrived in Cyrillic and the client confirmed Latin was fine, so the menu
   * reads in one script rather than two.
   */
  nav: {
    overview: 'Boshqaruv markazi',
    cohort: 'Mijoz qaytishi',
    logistics: 'Logistika natijasi',
    sales: 'Savdo dinamikasi',
    confirmation: 'Tasdiqlash navbati',
    warehouse: 'Joʻnatish nuqtalari',
    kpi: 'KPI rejalari',
    structure: 'Kadrlar tuzilmasi',
    sellers: 'Sotuvchilar reytingi',
    margin: 'Yalpi marja',
    marketing: 'Reklama samarasi',
    /** Not one of the nine: account administration, shown only to an admin. */
    users: 'Foydalanuvchilar',
  },

  /**
   * Section headings and the one-line explanation each module leads with.
   *
   * The explanation is not decoration. Every screen here reports something a
   * reader could misread as a more familiar figure — a "sklad" page that shows
   * dispatch rather than stock, a confirmation rate that says nothing about
   * whether the order survived — so each states what it is measuring before it
   * shows a number.
   */
  modules: {
    cohort: {
      title: 'Mijoz qaytishi',
      lead: 'Har oy birinchi marta xarid qilgan mijozlarning qanchasi keyingi oylarda qaytgani — kogorta tahlili.',
    },
    logistics: {
      title: 'Logistika natijasi',
      lead: 'Buyurtma qaysi hudud va tashuvchi orqali ketgani, qancha vaqtda yetgani va qayerda qaytgani.',
    },
    confirmation: {
      title: 'Tasdiqlash navbati',
      lead: 'Tasdiqlash navbatiga tushgan har bir buyurtma qaysi holatda yakunlangani.',
    },
    margin: {
      title: 'Yalpi marja',
      lead: 'Mahsulot boʻyicha tushum, tannarx va yalpi foyda.',
    },
    warehouse: {
      title: 'Joʻnatish nuqtalari',
      lead: 'Buyurtmalarni qaysi sklad, kuryer yoki marketpleys bajargani.',
    },
    team: {
      title: 'Jamoa',
      lead: 'Kim qancha sotdi, kim qancha gaplashdi, kim qayerda turibdi.',
    },
    structure: {
      title: 'Kadrlar tuzilmasi',
      lead: 'Boʻlimlar, rahbarlar va har bir boʻlimning natijasi.',
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
    revenue: 'Tushum',
    /*
      "Yutilgan", not "Yopilgan". Both call sites count WON deals only, but a
      LOST deal is closed too — and on the sales page the tile printed 3,588
      under "Yopilgan bitimlar" while its own conversion neighbour divided by
      3,701 closed deals. Two numbers for one word on one screen. The tile's
      own hints already said "yutilgan bitim"; the label now agrees with them.
    */
    dealsWon: 'Yutilgan bitimlar',
    dealsCreated: 'Yangi bitimlar',
    averageDeal: 'Oʻrtacha bitim',
    conversion: 'Konversiya',
    dealsOpen: 'Ochiq bitimlar',
    pipeline: 'Ochiq bitimlar qiymati',
    kpiAchievement: 'KPI bajarilishi',
    activeEmployees: 'Faol xodimlar',
  },

  chart: {
    revenueTrend: 'Tushum dinamikasi',
    revenueTrendHint: 'Yopilgan bitimlar boʻyicha, kunlar kesimida',
    funnel: 'Savdo voronkasi',
    funnelHint: 'Davrda yaratilgan bitimlarning joriy bosqichi',
    bySource: 'Manbalar boʻyicha',
    byProduct: 'Mahsulotlar boʻyicha',
    leaderboard: 'Eng yaxshi natijalar',
  },

  table: {
    employee: 'Xodim',
    department: 'Boʻlim',
    revenue: 'Tushum',
    deals: 'Bitimlar',
    dealsWon: 'Yopilgan',
    conversion: 'Konversiya',
    kpi: 'KPI',
    growth: 'Oʻsish',
    rank: 'Oʻrin',
    deal: 'Bitim',
    amount: 'Summa',
    stage: 'Bosqich',
    product: 'Mahsulot',
    source: 'Manba',
    created: 'Yaratilgan',
    closed: 'Yopilgan',
    status: 'Holat',
    share: 'Ulush',
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
    unavailable: 'Ulanmagan',
    unavailableHint: 'Bu maʼlumot manbasi hali ulanmagan.',
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
    synced: 'Sinxronlangan',
    stale: 'eskirgan',
    pending: 'Navbatda kutmoqda · bugun',
    alerts: 'Ogohlantirishlar',
    noAlerts: 'Hammasi joyida',
    refresh: 'Yangilash',
    refreshing: 'Yangilanmoqda…',
  },

  /**
   * The Reyting switcher's labels.
   *
   * Read by LeaderboardPage and nowhere else, which is why these may carry the
   * BASIS in the label itself while `t.table.*` stays short for the screens
   * that show one basis and cannot be misread.
   *
   * Four of these six rank what was DELIVERED and two rank what the SELLER
   * CLOSED. Those are different sets of deals — last August 2 798 entered the
   * seller's won stage, 3 729 entered Доставка's, and 1 152 were in both — so
   * a bare "Tushum" beside a bare "Summa" reads as two words for one number
   * when it is two numbers. The `Yetkazilgan…` / `Yopgan…` prefixes are the
   * whole disambiguation and are the reason these strings are longer than a
   * segmented control would prefer.
   */
  metric: {
    revenue: 'Yetkazilgan tushum',
    deals_won: 'Yetkazilgan bitimlar',
    conversion: 'Konversiya',
    kpi_achievement: 'KPI bajarilishi',
    /** The seller-close basis — see `basis` below. */
    closed_deals: 'Yopgan bitimlar',
    closed_value: 'Yopgan summa',
  },

  /**
   * WHICH EVENT a figure counts, said in one sentence.
   *
   * docs/DESIGN.md — "A number names its basis when a sibling screen computes
   * one differently." This dashboard measures a seller two ways and they are
   * not the same deals:
   *
   *   YETKAZILGAN  money that landed — `countsAsRevenue`, status WON, bucketed
   *                by `closedAt`. The company's number.
   *   YOPGAN       entries into the won stage of the sellers' own pipeline.
   *                A robot empties that stage within seconds by moving the
   *                deal to Доставка, so the stage history is the only trace
   *                the sale leaves. The seller's own act.
   *
   * Neither is the "real" figure and neither may be substituted for the other.
   * These strings live here rather than in the three pages that show them so
   * that Reyting, Xodimlar and one person's own page cannot drift into
   * describing the same column three different ways.
   *
   * The stage name is passed in rather than written out: it is resolved from
   * the portal by role (`server/domain/analytics/sellerClose`), never matched
   * on a hardcoded `C12:WON`, and a caption that spelled it out would keep
   * claiming it after the portal was reconfigured.
   */
  basis: {
    /** Table headings. Long, because the two bases sit side by side there. */
    deliveredRevenueColumn: 'Yetkazilgan tushum',
    deliveredDealsColumn: 'Yetkazilgan bitim',
    closedDealsColumn: 'Yopgan bitim',
    closedValueColumn: 'Yopgan summa',

    /** Tile and card labels on the person-level screens. */
    closedDealsLabel: 'Sotuvchi yopgan bitimlar',
    closedValueLabel: 'Sotuvchi yopgan summa',

    /** What to call the stage when its real name is not to hand. */
    stageFallback: 'sotuvchining yakuniy bosqichi',

    deliveredRevenue: 'Yetkazib berilgan va tushum sifatida hisoblangan buyurtmalar puli.',
    deliveredDeals: 'Yetkazib berilgan va tushum sifatida hisoblangan buyurtmalar soni.',
    conversion: 'Yakunlangan bitimlarning qanchasi yutilgani.',
    kpi: 'Belgilangan KPI rejasiga nisbatan bajarilish darajasi.',

    closedDeals: (stage: string) => `Sotuvchi «${stage}» bosqichiga oʻtkazgan bitimlar soni.`,
    closedValue: (stage: string) => `Sotuvchi «${stage}» bosqichiga oʻtkazgan bitimlar summasi.`,

    /**
     * The one caveat `closedValue` owes wherever it is printed: the stage
     * history carries no amount, so the sum is the deal's amount TODAY.
     */
    amountCaveat: 'Summa bitimning bugungi qiymati boʻyicha olinadi.',

    /**
     * The explainer, once per page. States the mechanism and stops — a
     * manager reading it should learn why two columns disagree, not be told
     * which one to prefer.
     */
    explainer:
      'Sotuvchining yopishi va yetkazib berish — bir hodisa emas: yopilgan bitimlarning bir qismi yetib borgunicha bekor qilinadi, yetkazilgan pulning bir qismi esa hech bir sotuvchi yopmagan takroriy buyurtmalardan keladi.',

    /**
     * When the seller pipeline's won stage resolved to nothing. Unmeasured is
     * not zero, and a column of zeros here would read as a company that
     * stopped selling.
     */
    unmeasured: 'Sotuvchining yakuniy bosqichi aniqlanmadi — yopgan bitimlar oʻlchanmadi.',

    /**
     * The same fact in one clause, for `StatTile.hint` — which is `truncate`,
     * so a sentence that does not fit is not a shorter sentence, it is a
     * clipped one. A caption that states half a basis is worse than none.
     */
    unmeasuredShort: 'Oʻlchanmadi — bosqich aniqlanmadi',
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
