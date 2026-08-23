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
    overview: 'Umumiy koÊ»rinish',
    sales: 'Savdo tahlili',
    employees: 'Xodimlar',
    leaderboard: 'Reyting',
    deals: 'Bitimlar',
    kpi: 'KPI',
    reports: 'Hisobotlar',
    products: 'Mahsulotlar',
    finance: 'Moliya',
  },

  period: {
    label: 'Davr',
    today: 'Bugun',
    yesterday: 'Kecha',
    this_week: 'Shu hafta',
    this_month: 'Shu oy',
    previous_month: 'OÊ»tgan oy',
    this_year: 'Shu yil',
    custom: 'Tanlangan davr',
    comparedTo: 'oldingi davrga nisbatan',
    truncated: 'Taqqoslash davri qisqartirildi',
  },

  cards: {
    revenue: 'Tushum',
    dealsWon: 'Yopilgan bitimlar',
    dealsCreated: 'Yangi bitimlar',
    averageDeal: 'OÊ»rtacha bitim',
    conversion: 'Konversiya',
    dealsOpen: 'Ochiq bitimlar',
    pipeline: 'Ochiq bitimlar qiymati',
    kpiAchievement: 'KPI bajarilishi',
    activeEmployees: 'Faol xodimlar',
  },

  chart: {
    revenueTrend: 'Tushum dinamikasi',
    revenueTrendHint: 'Yopilgan bitimlar boÊ»yicha, kunlar kesimida',
    funnel: 'Savdo voronkasi',
    funnelHint: 'Davrda yaratilgan bitimlarning joriy bosqichi',
    bySource: 'Manbalar boÊ»yicha',
    byProduct: 'Mahsulotlar boÊ»yicha',
    leaderboard: 'Eng yaxshi natijalar',
  },

  table: {
    employee: 'Xodim',
    department: 'BoÊ»lim',
    revenue: 'Tushum',
    deals: 'Bitimlar',
    dealsWon: 'Yopilgan',
    conversion: 'Konversiya',
    kpi: 'KPI',
    growth: 'OÊ»sish',
    rank: 'OÊ»rin',
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
    no_data: 'maÊ¼lumot yoÊ»q',
    unchanged: 'oÊ»zgarishsiz',
  },

  state: {
    loading: 'Yuklanmoqdaâ€¦',
    // "No data" and "failed to load" are deliberately different messages:
    // one is a fact about the business, the other is a fault.
    emptyTitle: 'MaÊ¼lumot yoÊ»q',
    emptyBody: 'Tanlangan davr va filtrlar boÊ»yicha bitim topilmadi.',
    errorTitle: 'MaÊ¼lumotni yuklab boÊ»lmadi',
    errorBody: 'Server bilan bogÊ»lanishda xatolik yuz berdi.',
    retry: 'Qayta urinish',
    unavailable: 'Ulanmagan',
    unavailableHint: 'Bu maÊ¼lumot manbasi hali ulanmagan.',
  },

  badge: {
    demo: 'Demo maÊ¼lumot',
    demoHint: 'KoÊ»rsatilgan raqamlar sinov uchun yaratilgan, haqiqiy emas.',
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
