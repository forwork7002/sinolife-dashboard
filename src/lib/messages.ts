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
      title: 'Tasdiqlash otchyoti',
      lead: 'Operator buyurtmani tasdiqladimi — va tasdiqlangani yetkazib berilganmi.',
    },
    channels: {
      title: 'Kanal analitikasi',
      lead: 'Har bir manba qancha murojaat, qancha savdo va qancha pul keltirgani.',
    },
    margin: {
      title: 'Valovaya marja',
      lead: 'Mahsulot boʻyicha tushum, tannarx va yalpi foyda.',
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
    comparedTo: 'oldingi davrga nisbatan',
    truncated: 'Taqqoslash davri qisqartirildi',
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
    no_baseline: 'yangi',
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
  },

  metric: {
    revenue: 'Tushum',
    deals_won: 'Yopilgan bitimlar',
    conversion: 'Konversiya',
    kpi_achievement: 'KPI bajarilishi',
  },
} as const
