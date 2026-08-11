/** Built-in category ids shipped as defaults (custom ids are free-form strings). */
export type BuiltinCategoryId =
  | 'groceries'
  | 'coffee_restaurants'
  | 'rent'
  | 'clothing'
  | 'transport'
  | 'subscriptions'
  | 'insurance'
  | 'health'
  | 'utilities'
  | 'shopping'
  | 'gifts'
  | 'salary'
  | 'refunds'
  | 'sales'
  | 'transfer'
  | 'atm'
  | 'entertainment'
  | 'hobbies'
  | 'kids'
  | 'travel'
  | 'reserves'
  | 'investments'
  | 'securities'
  | 'excluded'
  | 'other'
  | 'uncategorized'

/** Category identifier — builtins or user-created slugs. */
export type CategoryId = BuiltinCategoryId | (string & {})

export interface Category {
  id: CategoryId
  /** Default English label (fallback / export); builtins prefer i18n unless overridden */
  label: string
  color: string
  /** User-defined display name; when set, skips i18n for builtins */
  labelOverride?: string
  /** Exclude from expense/income totals (e.g. internal transfers) */
  excludeFromTotals?: boolean
  /** Treat as income rather than expense */
  isIncome?: boolean
}

export interface CategoryRule {
  id: string
  categoryId: CategoryId
  /** Match against counterparty and/or purpose (case-insensitive) */
  pattern: string
  /** If true, treat pattern as regex; otherwise as substring */
  isRegex?: boolean
  /**
   * When set, the rule only matches transactions with this exact amount
   * (used for Excluded: same sender + amount).
   */
  amount?: number
  /** User-created rules take priority when sorted first */
  source: 'default' | 'user'
}

export interface Account {
  id: string
  name: string
  /** Bank / institution label, e.g. DKB */
  bank: string
  /** Own account IBAN when known (from CSV header) */
  iban?: string
  /**
   * Stable identity when IBAN is missing (e.g. Trade Republic).
   * Examples: "broker:trade_republic"
   */
  fingerprint?: string
  createdAt: string
}

export interface Transaction {
  id: string
  accountId: string
  date: string // ISO YYYY-MM-DD
  valueDate: string
  status: string
  counterparty: string
  purpose: string
  type: string // Eingang | Ausgang | ...
  iban: string
  amount: number // negative = expense, positive = income
  categoryId: CategoryId
  /** bank = imported CSV; manual = user-entered (e.g. monthly reserves) */
  origin: 'bank' | 'manual'
  /** True if user manually set the category */
  categoryOverride?: boolean
  importedAt: string
  /** CSV import batch this row was created by (bank origin only) */
  importId?: string
}

export type ImportSource = 'dkb' | 'trade_republic' | 'generic'

export interface ImportBatch {
  id: string
  accountId: string
  source: ImportSource
  fileName: string
  importedAt: string
  addedCount: number
  duplicateCount: number
  /** Original CSV text when available (stored from new imports). */
  rawCsv?: string
}

export interface AppStore {
  version: 2
  /**
   * True while showing the built-in sample dataset (no real bank CSV yet).
   * Cleared on the first real import or store merge.
   */
  isDemo?: boolean
  accounts: Account[]
  transactions: Transaction[]
  rules: CategoryRule[]
  imports: ImportBatch[]
  lastImportedAt: string | null
  /**
   * Customizable category list. Defaults to the built-in set when missing
   * (older store.json files). Always present after hydrate.
   */
  categories: Category[]
}

export interface ImportResult {
  added: number
  duplicates: number
  accountId: string
  created?: boolean
  importId?: string
  transactions: Transaction[]
}

export interface DkbAccountMeta {
  label: string | null
  iban: string | null
}
