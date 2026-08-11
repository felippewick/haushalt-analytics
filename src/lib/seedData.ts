import type { AppStore, ImportBatch, Transaction } from './types'
import { DEFAULT_RULES } from './defaultRules'
import { cloneDefaultCategories, syncCategoryRegistry } from './categories'
import { categorizeAll } from './categorize'
import { transactionHash } from './dkbParser'

const DEMO_ACCOUNT_ID = 'acc_demo_giro'
const DEMO_IMPORT_ID = 'imp_demo_sample'
const DEMO_IBAN = 'DE00DEMO00000000000000'

/** Shift calendar months from a YYYY-MM-DD anchor (day clamped to 28). */
function monthShift(isoDate: string, deltaMonths: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const total = y! * 12 + (m! - 1) + deltaMonths
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const day = Math.min(d!, 28)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

type SeedRow = {
  day: string // DD within month pattern — full ISO built via monthShift
  counterparty: string
  purpose: string
  type: 'Eingang' | 'Ausgang'
  amount: number
  /** Months ago relative to current month (0 = this month) */
  monthsAgo: number
}

/**
 * Plausible German household sample spanning the last ~4 months.
 * Merchants match default rules so categories look realistic out of the box.
 */
const SEED_ROWS: SeedRow[] = [
  // Current month
  {
    monthsAgo: 0,
    day: '01',
    counterparty: 'Wohnungsgesellschaft Musterstadt',
    purpose: 'Miete',
    type: 'Ausgang',
    amount: -1150,
  },
  {
    monthsAgo: 0,
    day: '02',
    counterparty: 'Arbeitgeber Beispiel AG',
    purpose: 'Gehalt',
    type: 'Eingang',
    amount: 3200,
  },
  {
    monthsAgo: 0,
    day: '03',
    counterparty: 'REWE SAGT DANKE',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -67.45,
  },
  {
    monthsAgo: 0,
    day: '05',
    counterparty: 'BVG',
    purpose: 'Deutschlandticket',
    type: 'Ausgang',
    amount: -49,
  },
  {
    monthsAgo: 0,
    day: '06',
    counterparty: 'Starbucks Coffee',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -5.2,
  },
  {
    monthsAgo: 0,
    day: '08',
    counterparty: 'NETFLIX.COM',
    purpose: 'Abo',
    type: 'Ausgang',
    amount: -13.99,
  },
  {
    monthsAgo: 0,
    day: '10',
    counterparty: 'LIDL FILIALE',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -42.18,
  },
  {
    monthsAgo: 0,
    day: '12',
    counterparty: 'Spotify AB',
    purpose: 'Premium',
    type: 'Ausgang',
    amount: -10.99,
  },
  {
    monthsAgo: 0,
    day: '14',
    counterparty: 'Zalando SE',
    purpose: 'Bestellung',
    type: 'Ausgang',
    amount: -79.9,
  },
  {
    monthsAgo: 0,
    day: '16',
    counterparty: 'Apotheke am Markt',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -18.5,
  },
  {
    monthsAgo: 0,
    day: '18',
    counterparty: 'Vattenfall Europe',
    purpose: 'Strom Abschlag',
    type: 'Ausgang',
    amount: -85,
  },
  {
    monthsAgo: 0,
    day: '20',
    counterparty: 'ALDI SUED',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -31.2,
  },
  {
    monthsAgo: 0,
    day: '22',
    counterparty: 'Cafe Central',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -24.6,
  },

  // 1 month ago
  {
    monthsAgo: 1,
    day: '01',
    counterparty: 'Wohnungsgesellschaft Musterstadt',
    purpose: 'Miete',
    type: 'Ausgang',
    amount: -1150,
  },
  {
    monthsAgo: 1,
    day: '02',
    counterparty: 'Arbeitgeber Beispiel AG',
    purpose: 'Gehalt',
    type: 'Eingang',
    amount: 3200,
  },
  {
    monthsAgo: 1,
    day: '04',
    counterparty: 'REWE SAGT DANKE',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -54.3,
  },
  {
    monthsAgo: 1,
    day: '05',
    counterparty: 'BVG',
    purpose: 'Deutschlandticket',
    type: 'Ausgang',
    amount: -49,
  },
  {
    monthsAgo: 1,
    day: '07',
    counterparty: 'NETFLIX.COM',
    purpose: 'Abo',
    type: 'Ausgang',
    amount: -13.99,
  },
  {
    monthsAgo: 1,
    day: '09',
    counterparty: 'Shell Station',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -62.4,
  },
  {
    monthsAgo: 1,
    day: '11',
    counterparty: 'H&M',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -45.99,
  },
  {
    monthsAgo: 1,
    day: '15',
    counterparty: 'TK Krankenkasse',
    purpose: 'Beitrag',
    type: 'Ausgang',
    amount: -120,
  },
  {
    monthsAgo: 1,
    day: '17',
    counterparty: 'EDEKA',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -38.75,
  },
  {
    monthsAgo: 1,
    day: '19',
    counterparty: 'Deutsche Telekom',
    purpose: 'Mobilfunk',
    type: 'Ausgang',
    amount: -29.95,
  },
  {
    monthsAgo: 1,
    day: '21',
    counterparty: 'CinemaxX',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -22,
  },
  {
    monthsAgo: 1,
    day: '25',
    counterparty: 'Mein Sparkonto',
    purpose: 'Umbuchung Rücklage',
    type: 'Ausgang',
    amount: -200,
  },

  // 2 months ago
  {
    monthsAgo: 2,
    day: '01',
    counterparty: 'Wohnungsgesellschaft Musterstadt',
    purpose: 'Miete',
    type: 'Ausgang',
    amount: -1150,
  },
  {
    monthsAgo: 2,
    day: '02',
    counterparty: 'Arbeitgeber Beispiel AG',
    purpose: 'Gehalt',
    type: 'Eingang',
    amount: 3200,
  },
  {
    monthsAgo: 2,
    day: '03',
    counterparty: 'REWE SAGT DANKE',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -71.2,
  },
  {
    monthsAgo: 2,
    day: '05',
    counterparty: 'BVG',
    purpose: 'Deutschlandticket',
    type: 'Ausgang',
    amount: -49,
  },
  {
    monthsAgo: 2,
    day: '08',
    counterparty: 'NETFLIX.COM',
    purpose: 'Abo',
    type: 'Ausgang',
    amount: -13.99,
  },
  {
    monthsAgo: 2,
    day: '10',
    counterparty: 'Amazon Marketplace',
    purpose: 'Bestellung',
    type: 'Ausgang',
    amount: -56.8,
  },
  {
    monthsAgo: 2,
    day: '12',
    counterparty: 'DB Vertrieb GmbH',
    purpose: 'Fahrkarte',
    type: 'Ausgang',
    amount: -89.5,
  },
  {
    monthsAgo: 2,
    day: '14',
    counterparty: 'Rossmann',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -16.4,
  },
  {
    monthsAgo: 2,
    day: '18',
    counterparty: 'Vattenfall Europe',
    purpose: 'Strom Abschlag',
    type: 'Ausgang',
    amount: -85,
  },
  {
    monthsAgo: 2,
    day: '22',
    counterparty: 'Deliveroo',
    purpose: 'Essenslieferung',
    type: 'Ausgang',
    amount: -28.9,
  },
  {
    monthsAgo: 2,
    day: '26',
    counterparty: 'Geldautomat DKB',
    purpose: 'Barauszahlung',
    type: 'Ausgang',
    amount: -100,
  },

  // 3 months ago
  {
    monthsAgo: 3,
    day: '01',
    counterparty: 'Wohnungsgesellschaft Musterstadt',
    purpose: 'Miete',
    type: 'Ausgang',
    amount: -1150,
  },
  {
    monthsAgo: 3,
    day: '02',
    counterparty: 'Arbeitgeber Beispiel AG',
    purpose: 'Gehalt',
    type: 'Eingang',
    amount: 3150,
  },
  {
    monthsAgo: 3,
    day: '04',
    counterparty: 'REWE SAGT DANKE',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -48.9,
  },
  {
    monthsAgo: 3,
    day: '05',
    counterparty: 'BVG',
    purpose: 'Deutschlandticket',
    type: 'Ausgang',
    amount: -49,
  },
  {
    monthsAgo: 3,
    day: '07',
    counterparty: 'NETFLIX.COM',
    purpose: 'Abo',
    type: 'Ausgang',
    amount: -13.99,
  },
  {
    monthsAgo: 3,
    day: '09',
    counterparty: 'IKEA Deutschland',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -134.5,
  },
  {
    monthsAgo: 3,
    day: '13',
    counterparty: 'LIDL FILIALE',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -29.15,
  },
  {
    monthsAgo: 3,
    day: '16',
    counterparty: 'Booking.com',
    purpose: 'Hotel',
    type: 'Ausgang',
    amount: -189,
  },
  {
    monthsAgo: 3,
    day: '20',
    counterparty: 'Spotify AB',
    purpose: 'Premium',
    type: 'Ausgang',
    amount: -10.99,
  },
  {
    monthsAgo: 3,
    day: '24',
    counterparty: 'Thalia Bücher',
    purpose: 'Kartenzahlung',
    type: 'Ausgang',
    amount: -21.9,
  },
]

function buildSeedTransactions(importedAt: string): Transaction[] {
  const anchor = new Date()
  const anchorIso = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}-15`

  return SEED_ROWS.map((row) => {
    const date = monthShift(
      `${anchorIso.slice(0, 8)}${row.day}`,
      -row.monthsAgo,
    )
    const base = {
      accountId: DEMO_ACCOUNT_ID,
      date,
      amount: row.amount,
      counterparty: row.counterparty,
      purpose: row.purpose,
    }
    return {
      id: transactionHash(base),
      accountId: DEMO_ACCOUNT_ID,
      date,
      valueDate: date,
      status: 'Gebucht',
      counterparty: row.counterparty,
      purpose: row.purpose,
      type: row.type,
      iban: DEMO_IBAN,
      amount: row.amount,
      categoryId: 'uncategorized' as const,
      origin: 'bank' as const,
      importedAt,
      importId: DEMO_IMPORT_ID,
    }
  })
}

/** True when the store has no user-owned banking data yet. */
export function isStoreEmptyOfUserData(store: {
  transactions: unknown[]
  accounts: { id: string }[]
  isDemo?: boolean
}): boolean {
  if (store.isDemo) return false
  if (store.transactions.length > 0) return false
  const bankAccounts = store.accounts.filter((a) => a.id !== 'acc_manual')
  return bankAccounts.length === 0
}

/** Sample household used until the user imports their own CSV. */
export function createSeedStore(): AppStore {
  const importedAt = new Date().toISOString()
  const categories = cloneDefaultCategories()
  syncCategoryRegistry(categories)
  const rules = [...DEFAULT_RULES]
  const raw = buildSeedTransactions(importedAt)
  const transactions = categorizeAll(raw, rules).sort((a, b) =>
    b.date.localeCompare(a.date),
  )

  const batch: ImportBatch = {
    id: DEMO_IMPORT_ID,
    accountId: DEMO_ACCOUNT_ID,
    source: 'dkb',
    fileName: 'sample-demo.csv',
    importedAt,
    addedCount: transactions.length,
    duplicateCount: 0,
  }

  return {
    version: 2,
    isDemo: true,
    accounts: [
      {
        id: DEMO_ACCOUNT_ID,
        name: 'Demo Girokonto',
        bank: 'DKB',
        iban: DEMO_IBAN,
        createdAt: importedAt,
      },
    ],
    transactions,
    rules,
    imports: [batch],
    lastImportedAt: null,
    categories,
  }
}
