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

  nav: {
    overview: 'Umumiy koʻrinish',
    sales: 'Savdo tahlili',
    channels: 'Kanallar',
    cohort: 'Kogorta',
    logistics: 'Logistika',
    confirmation: 'Tasdiqlash',
    warehouse: 'Sklad',
    margin: 'Marja',
    // The Roistat ledger. Its own nav group, because it is not Bitrix24 data.
    marketing: 'Marketing',
    team: 'Jamoa',
    structure: 'Struktura',
    calls: 'Qoʻngʻiroqlar',
    employees: 'Xodimlar',
    leaderboard: 'Reyting',
    deals: 'Bitimlar',
    kpi: 'KPI',
    reports: 'Hisobotlar',
    products: 'Mahsulotlar',
    finance: 'Moliya',
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
      title: 'Kogorta tahlili',
      lead: 'Har oy birinchi marta xarid qilgan mijozlarning qanchasi keyingi oylarda qaytgani.',
    },
    logistics: {
      title: 'Logistika',
      lead: 'Buyurtma qaysi hudud va tashuvchi orqali ketgani, qancha vaqtda yetgani va qayerda qaytgani.',
    },
    confirmation: {
      title: 'Tasdiqlash hisoboti',
      lead: 'Operator buyurtmani tasdiqladimi — va tasdiqlangani yetkazib berilganmi.',
    },
    channels: {
      title: 'Kanal analitikasi',
      lead: 'Har bir manba qancha murojaat, qancha savdo va qancha pul keltirgani.',
    },
    margin: {
      title: 'Yalpi marja',
      lead: 'Mahsulot boʻyicha tushum, tannarx va yalpi foyda.',
    },
    calls: {
      title: 'Qoʻngʻiroqlar',
      lead: 'Kim mijoz bilan qancha gaplashgani. Gaplashgan vaqt — faqat ulangan qoʻngʻiroqlar.',
    },
    warehouse: {
      title: 'Sklad va joʻnatish',
      lead: 'Buyurtmalarni qaysi sklad, kuryer yoki marketpleys bajargani.',
    },
    team: {
      title: 'Jamoa',
      lead: 'Kim qancha sotdi, kim qancha gaplashdi, kim qayerda turibdi.',
    },
    structure: {
      title: 'Kompaniya strukturasi',
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
    dealsWon: 'Yopilgan bitimlar',
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
} as const
