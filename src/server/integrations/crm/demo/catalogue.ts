/**
 * Static vocabulary for the demo dataset.
 *
 * Names are common Uzbek given names and surnames; customers are a mix of
 * plausible Uzbek company names and individuals. None of this refers to real
 * people or real SinoLife customers — it exists so the dashboard reads
 * naturally to an Uzbek-speaking manager rather than showing "Employee 7".
 *
 * The product catalogue is generic health-and-nutrition categories. Real
 * product names arrive with the Bitrix24 mapping; nothing here is presented as
 * an actual SinoLife SKU.
 */

export const GIVEN_NAMES_MALE = [
  'Aziz', 'Bekzod', 'Doniyor', 'Eldor', 'Farrux', 'Gʻayrat', 'Hasan',
  'Ilhom', 'Jasur', 'Kamron', 'Laziz', 'Mirjalol', 'Nodir', 'Otabek',
  'Rustam', 'Sardor', 'Temur', 'Ulugʻbek', 'Shohruh', 'Javohir',
] as const

export const GIVEN_NAMES_FEMALE = [
  'Aziza', 'Barno', 'Dilnoza', 'Feruza', 'Gulnora', 'Hilola', 'Iroda',
  'Kamola', 'Lola', 'Madina', 'Nilufar', 'Ozoda', 'Rayhona', 'Sevara',
  'Shahnoza', 'Umida', 'Zarina', 'Nargiza', 'Malika', 'Dildora',
] as const

export const SURNAMES = [
  'Abdullayev', 'Ahmedov', 'Bekmurodov', 'Ergashev', 'Fayzullayev',
  'Gʻaniyev', 'Hakimov', 'Ibrohimov', 'Joʻrayev', 'Karimov',
  'Mahmudov', 'Nazarov', 'Olimov', 'Qodirov', 'Rahimov', 'Saidov',
  'Toʻxtayev', 'Usmonov', 'Xolmatov', 'Yusupov', 'Zoirov', 'Sharipov',
] as const

/** Uzbek surnames take an -a suffix in the feminine form. */
export function feminineSurname(surname: string): string {
  return `${surname}a`
}

/**
 * The demo company tree — a TREE, with a root and three levels.
 *
 * It used to be four sibling departments with no parent and no head, which made
 * the company-structure screen render four disconnected cards and read as a
 * broken page rather than as a small company. Production's tree is
 * NEWGEN → region → (ROP) team, three deep with up to nine siblings on the
 * bottom row, so the demo models the same shape at a size a reader can hold:
 * one root, two branches, four teams.
 *
 * `sortOrder` is spaced by 100 for the same reason Bitrix24 spaces it by 200 —
 * a unit can be slotted between two others without renumbering the row.
 */
export const DEPARTMENTS = [
  { externalId: 'dep-0', name: 'SinoLife', parentExternalId: undefined, sortOrder: 100 },
  { externalId: 'dep-1', name: 'Savdo boʻlimi', parentExternalId: 'dep-0', sortOrder: 100 }, // Sales
  { externalId: 'dep-2', name: 'Korporativ savdo', parentExternalId: 'dep-1', sortOrder: 100 }, // Corporate
  { externalId: 'dep-3', name: 'Mintaqaviy savdo', parentExternalId: 'dep-1', sortOrder: 200 }, // Regional
  { externalId: 'dep-4', name: 'Onlayn savdo', parentExternalId: 'dep-0', sortOrder: 200 }, // Online
  { externalId: 'dep-5', name: 'Marketing', parentExternalId: 'dep-0', sortOrder: 300 },
  { externalId: 'dep-6', name: 'Logistika', parentExternalId: 'dep-0', sortOrder: 400 },
] as const

/**
 * Which units actually take salespeople.
 *
 * The root and its branch units hold a head and nothing else, the way a real
 * portal's «Навоий» holds six teams and no sellers of its own — a unit whose
 * subtree is full and whose own roster is empty is a case the screen has to
 * render, and generating people into every unit would hide it.
 */
export const STAFFED_DEPARTMENTS = ['dep-2', 'dep-3', 'dep-4', 'dep-5', 'dep-6'] as const

/**
 * Who heads which unit — and the three cases the real portal contains.
 *
 * `dep-0` is headed by someone who sits in it (the portal's NEWGEN). `dep-1` is
 * headed by someone who sits one level DOWN, so the card must decide what to do
 * with a head who is not a member — the portal's «Навоий» is exactly this and
 * its own screen prints no head row at all. `dep-6` has no head, which is the
 * portal's «Тошкент онлайн». Generating a tidy head-per-unit would leave two of
 * the three untested.
 */
export const DEMO_HEADS: Readonly<Record<string, string | undefined>> = Object.freeze({
  'dep-0': 'emp-001',
  'dep-1': 'emp-002',
  'dep-2': 'emp-003',
  'dep-3': 'emp-004',
  'dep-4': 'emp-005',
  'dep-5': 'emp-006',
  // 'dep-6' deliberately has none.
})

/** Where each of those heads actually sits. Note emp-002 heads dep-1 from dep-2. */
export const DEMO_HEAD_OF: Readonly<Record<string, string | undefined>> = Object.freeze({
  'emp-001': 'dep-0',
  'emp-002': 'dep-2',
  'emp-003': 'dep-2',
  'emp-004': 'dep-3',
  'emp-005': 'dep-4',
  'emp-006': 'dep-5',
})

export const POSITIONS = [
  'Savdo menejeri',
  'Katta savdo menejeri',
  'Hisob menejeri',
  'Mintaqaviy vakil',
  'Boʻlim boshligʻi',
] as const

export const REGIONS = [
  'Toshkent', 'Samarqand', 'Buxoro', 'Andijon', 'Fargʻona',
  'Namangan', 'Qashqadaryo', 'Surxondaryo', 'Xorazm', 'Navoiy', 'Jizzax',
] as const

export const PRODUCT_CATEGORIES = [
  { externalId: 'cat-1', name: 'Vitaminlar va minerallar' },
  { externalId: 'cat-2', name: 'Immunitet uchun' },
  { externalId: 'cat-3', name: 'Ovqat hazm qilish' },
  { externalId: 'cat-4', name: 'Sport ovqatlanishi' },
  { externalId: 'cat-5', name: 'Goʻzallik va parvarish' },
] as const

/**
 * Demo products. `basePriceMinor` is in tiyin (1/100 so'm).
 *
 * ASSUMPTION — CONFIRM WITH THE BUSINESS.
 * Prices are set as wholesale/distributor unit prices (roughly 150 000 –
 * 900 000 so'm), not single-jar retail prices, because the deal sizes they
 * produce line up with a KPI target in the 100 000 000 so'm range. If SinoLife
 * actually sells single units at retail through this pipeline, divide these by
 * about ten. Real prices arrive with the Bitrix24 product catalogue.
 */
export const PRODUCTS = [
  { externalId: 'prd-01', name: 'Multivitamin Kompleks', categoryExternalId: 'cat-1', basePriceMinor: 320_000_00n },
  { externalId: 'prd-02', name: 'Vitamin D3 + K2', categoryExternalId: 'cat-1', basePriceMinor: 245_000_00n },
  { externalId: 'prd-03', name: 'Temir va Folat', categoryExternalId: 'cat-1', basePriceMinor: 189_000_00n },
  { externalId: 'prd-04', name: 'Immuno Plus', categoryExternalId: 'cat-2', basePriceMinor: 410_000_00n },
  { externalId: 'prd-05', name: 'Echinacea Ekstrakti', categoryExternalId: 'cat-2', basePriceMinor: 275_000_00n },
  { externalId: 'prd-06', name: 'Probiotik Kompleks', categoryExternalId: 'cat-3', basePriceMinor: 360_000_00n },
  { externalId: 'prd-07', name: 'Fermentlar Formulasi', categoryExternalId: 'cat-3', basePriceMinor: 299_000_00n },
  { externalId: 'prd-08', name: 'Tolali Aralashma', categoryExternalId: 'cat-3', basePriceMinor: 154_000_00n },
  { externalId: 'prd-09', name: 'Protein Kokteyli', categoryExternalId: 'cat-4', basePriceMinor: 580_000_00n },
  { externalId: 'prd-10', name: 'Aminokislotalar BCAA', categoryExternalId: 'cat-4', basePriceMinor: 475_000_00n },
  { externalId: 'prd-11', name: 'Kollagen Peptidlari', categoryExternalId: 'cat-5', basePriceMinor: 620_000_00n },
  { externalId: 'prd-12', name: 'Omega-3 Baliq Yogʻi', categoryExternalId: 'cat-1', basePriceMinor: 338_000_00n },
  { externalId: 'prd-13', name: 'Antioksidant Kompleks', categoryExternalId: 'cat-5', basePriceMinor: 442_000_00n },
  { externalId: 'prd-14', name: 'Magniy va B6', categoryExternalId: 'cat-1', basePriceMinor: 216_000_00n },
] as const

/**
 * Pipeline stages, in funnel order.
 *
 * `category` is our normalised meaning. This is precisely the mapping that the
 * Bitrix24 provider will have to supply for the real portal's stage IDs.
 */
export const STAGES = [
  { externalId: 'stg-1', name: 'Yangi soʻrov', category: 'NEW', sortOrder: 1 },
  { externalId: 'stg-2', name: 'Aloqada', category: 'IN_PROGRESS', sortOrder: 2 },
  { externalId: 'stg-3', name: 'Taklif yuborildi', category: 'IN_PROGRESS', sortOrder: 3 },
  { externalId: 'stg-4', name: 'Muzokara', category: 'IN_PROGRESS', sortOrder: 4 },
  { externalId: 'stg-5', name: 'Shartnoma', category: 'IN_PROGRESS', sortOrder: 5 },
  { externalId: 'stg-6', name: 'Muvaffaqiyatli', category: 'WON', sortOrder: 6 },
  { externalId: 'stg-7', name: 'Bekor qilindi', category: 'LOST', sortOrder: 7 },
] as const

export const SALES_SOURCES = [
  { externalId: 'src-1', name: 'Telefon qoʻngʻirogʻi', weight: 22 },
  { externalId: 'src-2', name: 'Instagram', weight: 26 },
  { externalId: 'src-3', name: 'Telegram', weight: 18 },
  { externalId: 'src-4', name: 'Tavsiya', weight: 15 },
  { externalId: 'src-5', name: 'Veb-sayt', weight: 12 },
  { externalId: 'src-6', name: 'Koʻrgazma', weight: 7 },
] as const

export const COMPANY_PREFIXES = [
  'Oq Yoʻl', 'Zarafshon', 'Navroʻz', 'Buyuk Ipak', 'Sharq Savdo',
  'Bahor', 'Choʻlpon', 'Registon', 'Amudaryo', 'Yangi Asr', 'Marvarid',
  'Oltin Vodiy', 'Sarbon', 'Turon', 'Diyor',
] as const

export const COMPANY_SUFFIXES = ['MChJ', 'XK', 'AJ', 'Savdo', 'Group'] as const
