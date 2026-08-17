import { isTauri } from '@tauri-apps/api/core'
import type {
  Account,
  AppStore,
  Category,
  CategoryId,
  CategoryRule,
  ImportBatch,
  ImportResult,
  ImportSource,
  Transaction,
} from './types'
import { DEFAULT_RULES } from './defaultRules'
import {
  applyCategoryKind,
  canDeleteCategory,
  cloneDefaultCategories,
  normalizeCategories,
  remapRetiredCategoryId,
  syncCategoryRegistry,
  uniqueCategoryId,
  type CategoryInput,
} from './categories'
import { categorizeAll } from './categorize'
import {
  detectBankName,
  extractDkbAccountMeta,
  isGermanBankCsv,
  parseDkbCsv,
  readFileAsText,
  suggestAccountName,
  bookingIdentityKey,
  transactionContentKey,
  transactionHash,
} from './dkbParser'
import {
  analyzeCsv,
  buildGenericTransactions,
  mapCsvRows,
  type ColumnMapping,
} from './genericCsvParser'
import {
  isTradeRepublicCsv,
  parseTradeRepublicCsv,
  suggestTradeRepublicAccountName,
} from './tradeRepublicParser'
import { createSeedStore, hasUserOwnedData, omitDemoData } from './seedData'

/** Ids that must survive hydrate (do not rewrite to content hashes). */
function hasStableTransactionId(id: string): boolean {
  return (
    id.startsWith('tx_') ||
    id.startsWith('tr_') ||
    id.startsWith('manual_')
  )
}

/** Native Trade Republic `transaction_id` embedded in `tr_{accountId}_{id}`. */
export function extractTradeRepublicNativeId(
  id: string,
  accountId?: string,
): string | null {
  if (!id.startsWith('tr_')) return null
  if (accountId) {
    const prefix = `tr_${accountId}_`
    if (id.startsWith(prefix)) {
      const native = id.slice(prefix.length)
      return native || null
    }
  }
  // UUID-style native ids even when the account segment is unknown / wrong
  const uuid = id.match(
    /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  )
  return uuid?.[1] ?? null
}

/** TR booking types from their CSV export (not DKB German types). */
function isTradeRepublicBookingType(type: string): boolean {
  const t = type.trim().toUpperCase()
  return [
    'BUY',
    'SELL',
    'SAVINGS_PLAN',
    'SAVEBACK',
    'ORDER',
    'TRADE_CORRECTED',
    'TILG',
    'IPO_SUBSCRIPTION',
    'STOCK_SPLIT',
    'MERGER',
    'SPIN_OFF',
    'DIVIDEND',
    'INTEREST',
    'INTEREST_PAYMENT',
    'LENDING',
    'CARD_CASHBACK',
    'CARD_TRANSACTION',
    'PAYMENT',
    'BENEFITS_SAVEBACK',
    'CUSTOMER_INBOUND',
    'CUSTOMER_OUTBOUND',
    'CUSTOMER_INPAYMENT',
    'INCOMING_TRANSFER',
    'OUTGOING_TRANSFER',
    'TRANSFER',
    'TRANSFER_INBOUND',
    'TRANSFER_OUTBOUND',
    'TRANSFER_INSTANT_INBOUND',
    'TRANSFER_INSTANT_OUTBOUND',
    'SEPA_TRANSFER',
    'TAX',
    'TAX_CORRECTION',
    'WITHHOLDING_TAX',
  ].includes(t)
}

const TAURI_STORE_FILE = 'store.json'

const DEFAULT_ACCOUNT_ID = 'acc_dkb_giro'
export const MANUAL_ACCOUNT_ID = 'acc_manual'

export function emptyStore(): AppStore {
  const categories = cloneDefaultCategories()
  syncCategoryRegistry(categories)
  return {
    version: 2,
    accounts: [],
    transactions: [],
    rules: [...DEFAULT_RULES],
    imports: [],
    lastImportedAt: null,
    categories,
  }
}

export function resetAllData(): AppStore {
  return createSeedStore()
}

function createImportId(): string {
  return `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** Deterministic batch id for pre-importId bank rows (also used when remapping accounts on merge). */
export function legacyImportId(accountId: string, importedAt: string): string {
  const raw = `${accountId}|${importedAt}`
  let h = 5381
  for (let i = 0; i < raw.length; i++) {
    h = (h * 33) ^ raw.charCodeAt(i)
  }
  return `imp_legacy_${(h >>> 0).toString(16)}`
}

function inferImportSource(type: string): ImportSource {
  return isTradeRepublicBookingType(type) ? 'trade_republic' : 'dkb'
}

/**
 * Attach import batches to older bank rows (grouped by account + importedAt)
 * so they can be deleted from the Imports tab.
 */
function backfillImportBatches(
  transactions: Transaction[],
  imports: ImportBatch[],
): { transactions: Transaction[]; imports: ImportBatch[] } {
  const byId = new Map(imports.map((i) => [i.id, { ...i }]))
  const nextTxs = transactions.map((t) => ({ ...t }))

  const groups = new Map<string, Transaction[]>()
  for (const t of nextTxs) {
    if (t.origin === 'manual') continue
    if (t.importId && byId.has(t.importId)) continue

    if (t.importId) {
      // Orphan importId (batch missing) — recreate a stub batch
      if (!byId.has(t.importId)) {
        byId.set(t.importId, {
          id: t.importId,
          accountId: t.accountId,
          source: inferImportSource(t.type),
          fileName: 'Earlier import',
          importedAt: t.importedAt,
          addedCount: 0,
          duplicateCount: 0,
        })
      }
      continue
    }

    const key = `${t.accountId}\0${t.importedAt}`
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }

  for (const [key, group] of groups) {
    const sep = key.indexOf('\0')
    const accountId = key.slice(0, sep)
    const importedAt = key.slice(sep + 1)
    const id = legacyImportId(accountId, importedAt)
    for (const t of group) {
      t.importId = id
    }
    const existing = byId.get(id)
    if (existing) {
      existing.addedCount = Math.max(existing.addedCount, group.length)
    } else {
      byId.set(id, {
        id,
        accountId,
        source: inferImportSource(group[0]?.type ?? ''),
        fileName: 'Earlier import',
        importedAt,
        addedCount: group.length,
        duplicateCount: 0,
      })
    }
  }

  // Refresh addedCount from live txs
  const liveCounts = new Map<string, number>()
  for (const t of nextTxs) {
    if (!t.importId) continue
    liveCounts.set(t.importId, (liveCounts.get(t.importId) ?? 0) + 1)
  }
  for (const batch of byId.values()) {
    const live = liveCounts.get(batch.id)
    if (live !== undefined) batch.addedCount = live
  }

  const nextImports = [...byId.values()].sort((a, b) =>
    b.importedAt.localeCompare(a.importedAt),
  )

  return { transactions: nextTxs, imports: nextImports }
}

/** Normalize IBAN for storage / matching (uppercase, no spaces). */
export function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase()
}

function createAccount(input: {
  name: string
  bank: string
  iban?: string
  fingerprint?: string
  id?: string
}): Account {
  return {
    id:
      input.id ??
      `acc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name.trim() || 'Account',
    bank: input.bank.trim() || 'Bank',
    iban: input.iban ? normalizeIban(input.iban) : undefined,
    fingerprint: input.fingerprint,
    createdAt: new Date().toISOString(),
  }
}

export function findAccountByIdentity(
  accounts: Account[],
  identity: { iban?: string | null; fingerprint?: string | null },
): Account | undefined {
  if (identity.iban) {
    const iban = normalizeIban(identity.iban)
    const byIban = accounts.find(
      (a) => a.iban && normalizeIban(a.iban) === iban,
    )
    if (byIban) return byIban
  }
  if (identity.fingerprint) {
    return accounts.find((a) => a.fingerprint === identity.fingerprint)
  }
  return undefined
}

/** Resolve or create account from CSV identity — never overwrites a custom name. */
export function resolveAccountForImport(
  store: AppStore,
  input: {
    bank: string
    defaultName: string
    iban?: string | null
    fingerprint?: string | null
  },
): { store: AppStore; account: Account; created: boolean } {
  const existing = findAccountByIdentity(store.accounts, input)
  if (existing) {
    // Fill in missing iban/fingerprint if we learned them
    let account = existing
    let accounts = store.accounts
    if (
      (input.iban && !existing.iban) ||
      (input.fingerprint && !existing.fingerprint)
    ) {
      account = {
        ...existing,
        iban: existing.iban ?? input.iban ?? undefined,
        fingerprint: existing.fingerprint ?? input.fingerprint ?? undefined,
      }
      accounts = store.accounts.map((a) =>
        a.id === account.id ? account : a,
      )
    }
    return { store: { ...store, accounts }, account, created: false }
  }

  const account = createAccount({
    name: input.defaultName,
    bank: input.bank,
    iban: input.iban ?? undefined,
    fingerprint: input.fingerprint ?? undefined,
  })
  return {
    store: { ...store, accounts: [...store.accounts, account] },
    account,
    created: true,
  }
}

export function renameAccount(
  store: AppStore,
  accountId: string,
  name: string,
): AppStore {
  const trimmed = name.trim()
  if (!trimmed) return store
  return {
    ...store,
    accounts: store.accounts.map((a) =>
      a.id === accountId ? { ...a, name: trimmed } : a,
    ),
  }
}

/** Remove a bank account and all of its transactions and import batches. */
export function deleteAccount(store: AppStore, accountId: string): AppStore {
  if (accountId === MANUAL_ACCOUNT_ID) return store
  if (!store.accounts.some((a) => a.id === accountId)) return store
  return {
    ...store,
    accounts: store.accounts.filter((a) => a.id !== accountId),
    imports: (store.imports ?? []).filter((i) => i.accountId !== accountId),
    transactions: store.transactions.filter((t) => t.accountId !== accountId),
  }
}

/** Migrate v1 stores (no accounts) and backfill accountId / stable ids. */
function migrateTransactions(
  rawTxs: Array<Partial<Transaction> & { id: string }>,
  accounts: Account[],
): { accounts: Account[]; transactions: Transaction[] } {
  let nextAccounts = [...accounts]
  const hasDefault = nextAccounts.some((a) => a.id === DEFAULT_ACCOUNT_ID)

  const needsDefault = rawTxs.some((t) => !t.accountId)
  if (needsDefault && !hasDefault) {
    nextAccounts = [
      createAccount({
        id: DEFAULT_ACCOUNT_ID,
        name: 'DKB Girokonto',
        bank: 'DKB',
      }),
      ...nextAccounts,
    ]
  }

  const transactions: Transaction[] = rawTxs.map((t) => {
    const accountId = t.accountId ?? DEFAULT_ACCOUNT_ID
    const date = t.date ?? ''
    const amount = typeof t.amount === 'number' ? t.amount : 0
    const counterparty = t.counterparty ?? ''
    const purpose = t.purpose ?? ''
    // Keep bank-native / manual ids stable across reloads so re-import dedupes work
    const id =
      t.accountId && hasStableTransactionId(t.id)
        ? t.id
        : transactionHash({ accountId, date, amount, counterparty, purpose })

    return {
      id,
      accountId,
      date,
      valueDate: t.valueDate ?? date,
      status: t.status ?? '',
      counterparty,
      purpose,
      type: t.type ?? '',
      iban: t.iban ?? '',
      amount,
      categoryId: t.categoryId ?? 'uncategorized',
      origin: t.origin === 'manual' ? 'manual' : 'bank',
      categoryOverride: t.categoryOverride,
      importedAt: t.importedAt ?? new Date().toISOString(),
      importId: t.importId,
    }
  })

  // Dedupe after id migration
  const byId = new Map<string, Transaction>()
  for (const tx of transactions) {
    const existing = byId.get(tx.id)
    if (!existing || (tx.categoryOverride && !existing.categoryOverride)) {
      byId.set(tx.id, tx)
    }
  }

  return {
    accounts: nextAccounts,
    transactions: dropPlaceholderCounterparties(
      collapseRenamedCounterpartyDuplicates(
        removeMisplacedTradeRepublicDuplicates(nextAccounts, [
          ...byId.values(),
        ]),
      ),
    ).sort((a, b) => b.date.localeCompare(a.date)),
  }
}

/** DKB/TR sample account that shows up as Max Mustermann in demo exports. */
const PLACEHOLDER_IBAN = 'DE12120300001000000001'

function isPlaceholderCounterparty(name: string): boolean {
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim()
  return (
    /\b(max|erika)\s+mustermann\b/.test(n) ||
    n === 'erika mustermann und max mustermann'
  )
}

/**
 * Drop leftover sample-name bookings (Max/Erika Mustermann) after a real CSV
 * re-import. Real people who replaced those names are kept by the collapse
 * step above.
 */
function dropPlaceholderCounterparties(
  transactions: Transaction[],
): Transaction[] {
  return transactions.filter((tx) => {
    if (tx.origin === 'manual') return true
    if (isPlaceholderCounterparty(tx.counterparty)) return false
    const iban = tx.iban.replace(/\s+/g, '').toUpperCase()
    if (iban === PLACEHOLDER_IBAN) return false
    return true
  })
}

/**
 * Overlapping CSV exports sometimes rename the counterparty (placeholder
 * Mustermann names → real names). Keep the newest row; preserve a category
 * override from either copy.
 */
function collapseRenamedCounterpartyDuplicates(
  transactions: Transaction[],
): Transaction[] {
  const byKey = new Map<string, Transaction>()
  const passthrough: Transaction[] = []

  for (const tx of transactions) {
    if (tx.origin === 'manual') {
      passthrough.push(tx)
      continue
    }
    const key = bookingIdentityKey(tx)
    if (!key) {
      passthrough.push(tx)
      continue
    }
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, tx)
      continue
    }
    const existingPlaceholder = isPlaceholderCounterparty(existing.counterparty)
    const incomingPlaceholder = isPlaceholderCounterparty(tx.counterparty)
    const newer =
      existingPlaceholder !== incomingPlaceholder
        ? existingPlaceholder
          ? tx
          : existing
        : tx.importedAt > existing.importedAt
          ? tx
          : existing.importedAt > tx.importedAt
            ? existing
            : tx.id > existing.id
              ? tx
              : existing
    const older = newer === tx ? existing : tx
    byKey.set(key, {
      ...newer,
      categoryId: newer.categoryOverride
        ? newer.categoryId
        : older.categoryOverride
          ? older.categoryId
          : newer.categoryId,
      categoryOverride:
        newer.categoryOverride || older.categoryOverride || undefined,
    })
  }

  return [...passthrough, ...byKey.values()]
}

/**
 * Drop Trade Republic bookings that landed on the wrong account (same content
 * already exists on a Trade Republic account). Keeps the TR-account copy.
 */
function removeMisplacedTradeRepublicDuplicates(
  accounts: Account[],
  transactions: Transaction[],
): Transaction[] {
  const trAccountIds = new Set(
    accounts
      .filter(
        (a) =>
          a.fingerprint === 'broker:trade_republic' ||
          /trade\s*republic/i.test(`${a.name} ${a.bank}`),
      )
      .map((a) => a.id),
  )
  if (trAccountIds.size === 0) return transactions

  const trContentKeys = new Set(
    transactions
      .filter((t) => trAccountIds.has(t.accountId))
      .map((t) =>
        transactionContentKey({
          date: t.date,
          amount: t.amount,
          counterparty: t.counterparty,
          purpose: t.purpose,
        }),
      ),
  )
  if (trContentKeys.size === 0) return transactions

  return transactions.filter((t) => {
    if (trAccountIds.has(t.accountId)) return true
    if (!isTradeRepublicBookingType(t.type)) return true
    const key = transactionContentKey({
      date: t.date,
      amount: t.amount,
      counterparty: t.counterparty,
      purpose: t.purpose,
    })
    return !trContentKeys.has(key)
  })
}

/** Merge persisted store with default rules (user rules always win / come first). */
export function hydrateStore(raw: Partial<AppStore> | null): AppStore {
  if (!raw || typeof raw !== 'object') return createSeedStore()

  const categories = normalizeCategories(raw.categories)
  syncCategoryRegistry(categories)
  const categoryIds = new Set(categories.map((c) => c.id))

  const userRules = (raw.rules ?? []).filter((r) => r.source === 'user')
  const defaultRules = DEFAULT_RULES.filter((r) =>
    categoryIds.has(r.categoryId),
  )
  const { accounts, transactions: migratedTxs } = migrateTransactions(
    (raw.transactions ?? []) as Array<Partial<Transaction> & { id: string }>,
    (raw.accounts ?? []).map((a) => {
      // Backfill Trade Republic fingerprint for older stores
      if (
        !a.fingerprint &&
        /trade\s*republic/i.test(`${a.name} ${a.bank}`)
      ) {
        return { ...a, fingerprint: 'broker:trade_republic' }
      }
      return a
    }),
  )

  const remappedTxs = migratedTxs.map((t) => {
    const categoryId = remapRetiredCategoryId(t.categoryId)
    return categoryId === t.categoryId ? t : { ...t, categoryId }
  })
  const remappedUserRules = userRules.map((r) => {
    const categoryId = remapRetiredCategoryId(r.categoryId)
    return categoryId === r.categoryId ? r : { ...r, categoryId }
  })
  const rules = [...remappedUserRules, ...defaultRules]

  const { transactions, imports } = backfillImportBatches(
    categorizeAll(remappedTxs, rules),
    Array.isArray(raw.imports) ? raw.imports : [],
  )

  const hydrated: AppStore = {
    version: 2,
    isDemo: Boolean(raw.isDemo),
    accounts,
    transactions,
    imports,
    rules,
    lastImportedAt: raw.lastImportedAt ?? null,
    categories,
  }

  if (!hasUserOwnedData(hydrated)) {
    if (hydrated.lastImportedAt) {
      return { ...omitDemoData(hydrated), isDemo: false }
    }
    return createSeedStore()
  }
  return repairGemeinschaftskontoAccount(omitDemoData(hydrated))
}

async function loadStoreFromTauri(): Promise<AppStore> {
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const { exists, mkdir, readTextFile } = await import('@tauri-apps/plugin-fs')

  const dir = await appDataDir()
  await mkdir(dir, { recursive: true })
  const storePath = await join(dir, TAURI_STORE_FILE)

  if (!(await exists(storePath))) return createSeedStore()

  const raw = await readTextFile(storePath)
  return hydrateStore(JSON.parse(raw) as Partial<AppStore>)
}

function persistableStore(store: AppStore): AppStore {
  const clean = hasUserOwnedData(store) ? omitDemoData(store) : store
  return {
    ...clean,
    version: 2,
    isDemo: clean.isDemo || undefined,
    rules: clean.rules.filter((r) => r.source === 'user'),
    categories: clean.categories ?? cloneDefaultCategories(),
  }
}

async function saveStoreToTauri(store: AppStore): Promise<void> {
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const { mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs')

  const dir = await appDataDir()
  await mkdir(dir, { recursive: true })
  const storePath = await join(dir, TAURI_STORE_FILE)
  await writeTextFile(storePath, JSON.stringify(persistableStore(store), null, 2))
}

async function loadStoreFromViteApi(): Promise<AppStore> {
  try {
    const res = await fetch('/api/store')
    if (!res.ok) return createSeedStore()
    const data = (await res.json()) as Partial<AppStore>
    return hydrateStore(data)
  } catch {
    return createSeedStore()
  }
}

async function saveStoreToViteApi(store: AppStore): Promise<void> {
  const toSave = persistableStore(store)
  const res = await fetch('/api/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toSave, null, 2),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      (err as { error?: string }).error ?? `Save failed (${res.status})`,
    )
  }
}

export async function loadStore(): Promise<AppStore> {
  if (isTauri()) return loadStoreFromTauri()
  return loadStoreFromViteApi()
}

export async function saveStore(store: AppStore): Promise<void> {
  if (isTauri()) {
    await saveStoreToTauri(store)
    return
  }
  await saveStoreToViteApi(store)
}

export function mergeTransactions(
  existing: Transaction[],
  incoming: Transaction[],
): ImportResult {
  const byId = new Map(existing.map((t) => [t.id, t]))
  const byContent = new Set(
    existing.map((t) =>
      transactionContentKey({
        date: t.date,
        amount: t.amount,
        counterparty: t.counterparty,
        purpose: t.purpose,
      }),
    ),
  )
  const byBooking = new Map<string, string>()
  const byNativeTrId = new Set<string>()
  for (const t of existing) {
    const native = extractTradeRepublicNativeId(t.id, t.accountId)
    if (native) byNativeTrId.add(native)
    const booking = bookingIdentityKey(t)
    if (booking && t.origin !== 'manual') byBooking.set(booking, t.id)
  }

  let added = 0
  let duplicates = 0
  const accountId = incoming[0]?.accountId ?? ''

  for (const tx of incoming) {
    const content = transactionContentKey({
      date: tx.date,
      amount: tx.amount,
      counterparty: tx.counterparty,
      purpose: tx.purpose,
    })
    const native = extractTradeRepublicNativeId(tx.id, tx.accountId)
    const booking = bookingIdentityKey(tx)
    const bookingMatchId = booking ? byBooking.get(booking) : undefined

    if (
      byId.has(tx.id) ||
      byContent.has(content) ||
      (native !== null && byNativeTrId.has(native)) ||
      bookingMatchId
    ) {
      duplicates++
      if (bookingMatchId && bookingMatchId !== tx.id) {
        const prev = byId.get(bookingMatchId)
        if (prev && tx.importedAt >= prev.importedAt) {
          byId.set(bookingMatchId, {
            ...prev,
            counterparty: tx.counterparty,
            purpose: tx.purpose,
            iban: tx.iban || prev.iban,
            type: tx.type || prev.type,
            status: tx.status || prev.status,
            categoryId: prev.categoryOverride ? prev.categoryId : tx.categoryId,
          })
        }
      }
      continue
    }

    byId.set(tx.id, tx)
    byContent.add(content)
    if (native) byNativeTrId.add(native)
    if (booking) byBooking.set(booking, tx.id)
    added++
  }

  const transactions = [...byId.values()].sort((a, b) =>
    b.date.localeCompare(a.date),
  )

  return { added, duplicates, accountId, transactions }
}

export function upsertAccount(
  store: AppStore,
  input: {
    id?: string
    name: string
    bank: string
    iban?: string
    fingerprint?: string
  },
): { store: AppStore; account: Account } {
  if (input.id) {
    const existing = store.accounts.find((a) => a.id === input.id)
    if (existing) {
      const account: Account = {
        ...existing,
        name: input.name.trim() || existing.name,
        bank: input.bank.trim() || existing.bank,
        iban: input.iban ?? existing.iban,
        fingerprint: input.fingerprint ?? existing.fingerprint,
      }
      return {
        store: {
          ...store,
          accounts: store.accounts.map((a) =>
            a.id === account.id ? account : a,
          ),
        },
        account,
      }
    }
  }

  const byIdentity = findAccountByIdentity(store.accounts, input)
  if (byIdentity) return { store, account: byIdentity }

  const account = createAccount(input)
  return {
    store: { ...store, accounts: [...store.accounts, account] },
    account,
  }
}

/**
 * Add a named bank account by IBAN (for assigning imports without a new CSV).
 * Returns unchanged store if IBAN is invalid or already present.
 */
export function addAccountByIban(
  store: AppStore,
  input: { name: string; iban: string; bank?: string },
): { store: AppStore; account: Account | null; error?: string } {
  const iban = normalizeIban(input.iban)
  if (!/^DE\d{20}$/.test(iban)) {
    return {
      store,
      account: null,
      error: 'Enter a valid German IBAN (DE + 20 digits).',
    }
  }
  const existing = findAccountByIdentity(store.accounts, { iban })
  if (existing) {
    return { store, account: existing, error: 'This IBAN already exists.' }
  }
  const name = input.name.trim() || `DKB · ${iban.slice(-4)}`
  const base = withoutSampleDataset(store)
  const { store: next, account } = upsertAccount(base, {
    name,
    bank: (input.bank ?? 'DKB').trim() || 'DKB',
    iban,
  })
  return { store: { ...next, isDemo: false }, account }
}

/**
 * Repair: dual DKB CSVs were both attached to DE17…; the larger import is the
 * Gemeinschaftskonto (DE47…) that receives the recurring transfers from DE17….
 */
function repairGemeinschaftskontoAccount(store: AppStore): AppStore {
  const JOINT_IBAN = 'DE47120300001087097687'
  const JOINT_IMPORT_ID = 'imp_legacy_183591b0'
  const hasImport = (store.imports ?? []).some((i) => i.id === JOINT_IMPORT_ID)
  if (!hasImport) return store

  let next = store
  const existing = findAccountByIdentity(next.accounts, { iban: JOINT_IBAN })
  if (!existing) {
    const { store: withAccount } = upsertAccount(next, {
      id: 'acc_dkb_gemeinschaft',
      name: 'Gemeinschaftskonto',
      bank: 'DKB',
      iban: JOINT_IBAN,
    })
    next = withAccount
  }

  const jointId =
    findAccountByIdentity(next.accounts, { iban: JOINT_IBAN })?.id
  if (!jointId) return next

  const batch = (next.imports ?? []).find((i) => i.id === JOINT_IMPORT_ID)
  if (!batch || batch.accountId === jointId) {
    // Still fix txs if batch is correct but rows drifted
    const drifted = next.transactions.some(
      (t) => t.importId === JOINT_IMPORT_ID && t.accountId !== jointId,
    )
    if (!drifted) return next
  }

  return reassignImport(next, JOINT_IMPORT_ID, jointId)
}

export type CsvFormat = ImportSource

export type DetectedCsvFormat = ImportSource | 'unknown'

/** Detect which known bank export a CSV text belongs to. */
export function detectCsvFormat(text: string): DetectedCsvFormat {
  if (isTradeRepublicCsv(text)) return 'trade_republic'
  if (isGermanBankCsv(text)) {
    const meta = extractDkbAccountMeta(text)
    return detectBankName(text, meta) === 'DKB' ? 'dkb' : 'generic'
  }
  return 'unknown'
}

export async function peekCsvImport(file: File): Promise<{
  format: CsvFormat
  suggestedName: string
  suggestedBank: string
  meta: { label: string | null; iban: string | null }
}> {
  const text = await readFileAsText(file)
  if (isTradeRepublicCsv(text)) {
    return {
      format: 'trade_republic',
      suggestedName: suggestTradeRepublicAccountName(),
      suggestedBank: 'Trade Republic',
      meta: { label: 'Trade Republic', iban: null },
    }
  }
  const meta = extractDkbAccountMeta(text)
  const bank = detectBankName(text, meta)
  return {
    format: bank === 'DKB' ? 'dkb' : 'generic',
    suggestedName: suggestAccountName(meta, bank),
    suggestedBank: bank,
    meta,
  }
}

/** @deprecated use peekCsvImport */
export async function peekDkbImport(file: File) {
  return peekCsvImport(file)
}

export function withoutSampleDataset(store: AppStore): AppStore {
  if (!hasUserOwnedData(store)) return emptyStore()
  return omitDemoData(store)
}

export async function importCsvFile(
  file: File,
  store: AppStore,
): Promise<{ store: AppStore; result: ImportResult & { created: boolean } }> {
  const baseStore = withoutSampleDataset(store)
  const text = await readFileAsText(file)
  const format: ImportSource = isTradeRepublicCsv(text)
    ? 'trade_republic'
    : isGermanBankCsv(text)
      ? detectBankName(text, extractDkbAccountMeta(text)) === 'DKB'
        ? 'dkb'
        : 'generic'
      : 'generic'

  let bank: string
  let defaultName: string
  let iban: string | null = null
  let fingerprint: string | null = null

  if (format === 'trade_republic') {
    bank = 'Trade Republic'
    defaultName = suggestTradeRepublicAccountName()
    fingerprint = 'broker:trade_republic'
  } else {
    const meta = extractDkbAccountMeta(text)
    bank = detectBankName(text, meta)
    defaultName = suggestAccountName(meta, bank)
    iban = meta.iban
  }

  const {
    store: withAccount,
    account,
    created,
  } = resolveAccountForImport(baseStore, {
    bank,
    defaultName,
    iban,
    fingerprint,
  })

  const importId = createImportId()
  const importedAt = new Date().toISOString()

  const parsed =
    format === 'trade_republic'
      ? parseTradeRepublicCsv(text, account.id, withAccount.rules)
      : parseDkbCsv(text, account.id)

  const categorized =
    format === 'trade_republic'
      ? parsed
      : categorizeAll(parsed, withAccount.rules)

  const stamped = categorized.map((t) => ({
    ...t,
    importId,
    importedAt,
  }))

  const result = mergeTransactions(withAccount.transactions, stamped)
  const transactions = categorizeAll(result.transactions, withAccount.rules)

  const batch: ImportBatch = {
    id: importId,
    accountId: account.id,
    source: format,
    fileName: file.name || 'import.csv',
    importedAt,
    addedCount: result.added,
    duplicateCount: result.duplicates,
    rawCsv: text,
  }

  return {
    store: {
      ...withAccount,
      isDemo: false,
      transactions,
      imports: [batch, ...(withAccount.imports ?? [])],
      lastImportedAt: importedAt,
    },
    result: {
      ...result,
      accountId: account.id,
      transactions,
      created,
      importId,
    },
  }
}

/** @deprecated use importCsvFile */
export async function importDkbFile(file: File, store: AppStore) {
  return importCsvFile(file, store)
}

export interface GenericImportInput {
  fileName: string
  /** Raw CSV text (already decoded). */
  text: string
  mapping: ColumnMapping
  /** Existing account to import into (wins over accountName). */
  accountId?: string | null
  /** Name for a new account when no accountId is given. */
  accountName?: string | null
}

/** Import an unknown-bank CSV using a user-provided column mapping. */
export function importGenericCsv(
  input: GenericImportInput,
  store: AppStore,
): { store: AppStore; result: ImportResult & { created: boolean } } {
  const baseStore = withoutSampleDataset(store)

  const analysis = analyzeCsv(input.text)
  if (!analysis) throw new Error('error.unreadableCsv')

  const { rows } = mapCsvRows(analysis.rows, input.mapping)
  if (rows.length === 0) throw new Error('error.noMappedRows')

  let withAccount: AppStore
  let account: Account
  let created = false

  const existing = input.accountId
    ? baseStore.accounts.find((a) => a.id === input.accountId)
    : undefined
  if (existing) {
    withAccount = baseStore
    account = existing
  } else {
    const fileBase = input.fileName.replace(/\.[^.]+$/, '').trim()
    const name = input.accountName?.trim() || fileBase || 'CSV Import'
    const fingerprint = `csv:${name.toLowerCase().replace(/\s+/g, '_')}`
    const resolved = resolveAccountForImport(baseStore, {
      bank: 'CSV',
      defaultName: name,
      fingerprint,
    })
    withAccount = resolved.store
    account = resolved.account
    created = resolved.created
  }

  const importId = createImportId()
  const importedAt = new Date().toISOString()

  const parsed = buildGenericTransactions(rows, account.id)
  const stamped = categorizeAll(parsed, withAccount.rules).map((t) => ({
    ...t,
    importId,
    importedAt,
  }))

  const result = mergeTransactions(withAccount.transactions, stamped)
  const transactions = categorizeAll(result.transactions, withAccount.rules)

  const batch: ImportBatch = {
    id: importId,
    accountId: account.id,
    source: 'generic',
    fileName: input.fileName || 'import.csv',
    importedAt,
    addedCount: result.added,
    duplicateCount: result.duplicates,
    rawCsv: input.text,
  }

  return {
    store: {
      ...withAccount,
      isDemo: false,
      transactions,
      imports: [batch, ...(withAccount.imports ?? [])],
      lastImportedAt: importedAt,
    },
    result: {
      ...result,
      accountId: account.id,
      transactions,
      created,
      importId,
    },
  }
}

function sameSenderAndAmount(
  a: Pick<Transaction, 'counterparty' | 'amount'>,
  b: Pick<Transaction, 'counterparty' | 'amount'>,
): boolean {
  return (
    a.counterparty.trim().toLowerCase() ===
      b.counterparty.trim().toLowerCase() && a.amount === b.amount
  )
}

export function setTransactionCategory(
  store: AppStore,
  transactionId: string,
  categoryId: CategoryId,
  createMerchantRule = false,
): AppStore {
  const tx = store.transactions.find((t) => t.id === transactionId)
  if (!tx) return store

  // Excluded is scoped to sender + amount (recurring same booking),
  // not every payment from that merchant.
  const excludeSimilar = categoryId === 'excluded' && Boolean(tx.counterparty.trim())

  let rules = store.rules
  if (createMerchantRule && tx.counterparty.trim()) {
    const pattern = tx.counterparty.trim()
    const already = rules.some((r) => {
      if (r.source !== 'user' || r.isRegex) return false
      if (r.pattern.toLowerCase() !== pattern.toLowerCase()) return false
      if (excludeSimilar) return r.amount === tx.amount
      return r.amount == null
    })
    if (!already) {
      const newRule: CategoryRule = {
        id: `user_${Date.now()}`,
        categoryId,
        pattern,
        isRegex: false,
        source: 'user',
        ...(excludeSimilar ? { amount: tx.amount } : {}),
      }
      rules = [newRule, ...rules]
    }
  }

  const transactions = store.transactions.map((t) => {
    if (t.id === transactionId) {
      return { ...t, categoryId, categoryOverride: true }
    }
    if (excludeSimilar && sameSenderAndAmount(t, tx)) {
      return { ...t, categoryId, categoryOverride: true }
    }
    return t
  })

  const next = createMerchantRule
    ? categorizeAll(transactions, rules).map((t) => {
        if (t.id === transactionId) {
          return { ...t, categoryId, categoryOverride: true }
        }
        if (excludeSimilar && sameSenderAndAmount(t, tx)) {
          return { ...t, categoryId, categoryOverride: true }
        }
        return t
      })
    : transactions

  return { ...store, transactions: next, rules }
}

/** Confirm AI suggestions using the same remember-merchant logic as the category picker. */
export function applyLlmSuggestions(
  store: AppStore,
  suggestions: Array<{
    id: string
    categoryId: CategoryId
    memberIds?: string[]
    tx: Pick<Transaction, 'counterparty'>
  }>,
): AppStore {
  let next = store
  for (const suggestion of suggestions) {
    const remember = Boolean(suggestion.tx.counterparty.trim())
    next = setTransactionCategory(
      next,
      suggestion.id,
      suggestion.categoryId,
      remember,
    )
    const leftover = (suggestion.memberIds ?? [suggestion.id]).filter((id) => {
      const tx = next.transactions.find((item) => item.id === id)
      return tx != null && tx.categoryId !== suggestion.categoryId
    })
    if (leftover.length === 0) continue
    const leftoverSet = new Set(leftover)
    next = {
      ...next,
      transactions: next.transactions.map((tx) =>
        leftoverSet.has(tx.id)
          ? {
              ...tx,
              categoryId: suggestion.categoryId,
              categoryOverride: true,
            }
          : tx,
      ),
    }
  }
  return next
}

export function addUserRule(
  store: AppStore,
  rule: Omit<CategoryRule, 'id' | 'source'>,
): AppStore {
  const newRule: CategoryRule = {
    ...rule,
    id: `user_${Date.now()}`,
    source: 'user',
  }
  const rules = [newRule, ...store.rules]
  return {
    ...store,
    rules,
    transactions: categorizeAll(store.transactions, rules),
  }
}

function withCategories(store: AppStore, categories: Category[]): AppStore {
  syncCategoryRegistry(categories)
  const categoryIds = new Set(categories.map((c) => c.id))
  const userRules = store.rules.filter((r) => r.source === 'user')
  const defaultRules = DEFAULT_RULES.filter((r) =>
    categoryIds.has(r.categoryId),
  )
  const rules = [...userRules, ...defaultRules]
  return {
    ...store,
    categories,
    rules,
    transactions: categorizeAll(store.transactions, rules),
  }
}

export function addCategory(
  store: AppStore,
  input: CategoryInput,
): AppStore {
  const label = input.label.trim()
  if (!label) return store
  const categories = store.categories ?? cloneDefaultCategories()
  const id = uniqueCategoryId(
    label,
    categories.map((c) => c.id),
  )
  const created: Category = applyCategoryKind(
    {
      id,
      label,
      color: input.color,
    },
    input.kind,
  )
  return withCategories(store, [...categories, created])
}

export function updateCategoryDefinition(
  store: AppStore,
  categoryId: CategoryId,
  input: CategoryInput,
): AppStore {
  const categories = store.categories ?? cloneDefaultCategories()
  const idx = categories.findIndex((c) => c.id === categoryId)
  if (idx < 0) return store

  const label = input.label.trim()
  if (!label) return store

  const prev = categories[idx]
  if (!prev) return store
  const builtinIds = new Set(cloneDefaultCategories().map((c) => c.id))
  const isBuiltin = builtinIds.has(categoryId)

  const next: Category = applyCategoryKind(
    {
      ...prev,
      color: input.color,
    },
    input.kind,
  )

  if (isBuiltin) {
    const def = cloneDefaultCategories().find((c) => c.id === categoryId)
    if (def) next.label = def.label
    if (input.labelOverride === null || input.labelOverride === '') {
      delete next.labelOverride
    } else {
      next.labelOverride = (input.labelOverride ?? label).trim()
    }
  } else {
    next.label = label
    delete next.labelOverride
  }

  const list = categories.map((c, i) => (i === idx ? next : c))
  return withCategories(store, list)
}

export function deleteCategory(
  store: AppStore,
  categoryId: CategoryId,
  reassignTo: CategoryId = 'uncategorized',
): AppStore {
  if (!canDeleteCategory(categoryId)) return store
  const categories = (store.categories ?? cloneDefaultCategories()).filter(
    (c) => c.id !== categoryId,
  )
  if (!categories.some((c) => c.id === reassignTo)) {
    reassignTo = 'uncategorized'
  }

  const transactions = store.transactions.map((t) =>
    t.categoryId === categoryId
      ? { ...t, categoryId: reassignTo, categoryOverride: true }
      : t,
  )
  const userRules = store.rules
    .filter((r) => r.source === 'user')
    .map((r) =>
      r.categoryId === categoryId ? { ...r, categoryId: reassignTo } : r,
    )

  syncCategoryRegistry(categories)
  const categoryIds = new Set(categories.map((c) => c.id))
  const defaultRules = DEFAULT_RULES.filter((r) =>
    categoryIds.has(r.categoryId),
  )
  const rules = [...userRules, ...defaultRules]

  return {
    ...store,
    categories,
    rules,
    transactions: categorizeAll(transactions, rules),
  }
}

export function resetCategories(store: AppStore): AppStore {
  const categories = cloneDefaultCategories()
  const allowed = new Set(categories.map((c) => c.id))
  const transactions = store.transactions.map((t) =>
    allowed.has(t.categoryId)
      ? t
      : { ...t, categoryId: 'uncategorized' as CategoryId, categoryOverride: true },
  )
  const userRules = store.rules
    .filter((r) => r.source === 'user')
    .map((r) =>
      allowed.has(r.categoryId)
        ? r
        : { ...r, categoryId: 'uncategorized' as CategoryId },
    )
  return withCategories({ ...store, transactions, rules: userRules }, categories)
}

export function filterTransactionsByAccount(
  transactions: Transaction[],
  accountIds: string[] | string | 'all',
): Transaction[] {
  if (accountIds === 'all') return transactions
  const ids = typeof accountIds === 'string' ? [accountIds] : accountIds
  if (ids.length === 0) return []
  const selected = new Set(ids)
  // Manual reserves always stay in the household view alongside the selected accounts
  return transactions.filter(
    (t) => selected.has(t.accountId) || t.origin === 'manual',
  )
}

export function formatIban(iban?: string | null): string {
  if (!iban) return ''
  const compact = iban.replace(/\s+/g, '').toUpperCase()
  return compact.replace(/(.{4})/g, '$1 ').trim()
}

/** Display label for an account — prefers IBAN so own accounts are unambiguous. */
export function accountLabel(
  accounts: Account[],
  accountId: string,
): string {
  const account = accounts.find((a) => a.id === accountId)
  if (!account) return accountId
  if (account.iban) return formatIban(account.iban)
  return account.name
}

/** Select / list option text: name plus IBAN when known. */
export function accountOptionLabel(account: Account): string {
  if (account.iban) {
    return `${account.name} · ${formatIban(account.iban)}`
  }
  return account.name
}

function ensureManualAccount(store: AppStore): AppStore {
  if (store.accounts.some((a) => a.id === MANUAL_ACCOUNT_ID)) return store
  return {
    ...store,
    accounts: [
      ...store.accounts,
      createAccount({
        id: MANUAL_ACCOUNT_ID,
        name: 'Manuell / Rücklagen',
        bank: 'Manual',
      }),
    ],
  }
}

export interface ManualExpenseInput {
  /** YYYY-MM month the expense belongs to (start month if recurring) */
  month: string
  /** Absolute euro amount (will be stored negative) */
  amount: number
  label: string
  categoryId: CategoryId
  /** Day of month 1–28, default 1 */
  day?: number
  /**
   * Optional end month (YYYY-MM, inclusive). When set and after `month`,
   * creates one booking per month from start through end.
   */
  endMonth?: string
}

function monthsInclusive(start: string, end: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) {
    return start ? [start] : []
  }
  if (end < start) return [start]

  const months: string[] = []
  let [y, m] = start.split('-').map(Number)
  const [endY, endM] = end.split('-').map(Number)
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
    // Safety cap: 10 years
    if (months.length > 120) break
  }
  return months
}

export function addManualExpense(
  store: AppStore,
  input: ManualExpenseInput,
): AppStore {
  const amountAbs = Math.abs(input.amount)
  if (!amountAbs || !input.month) return store

  const withAccount = ensureManualAccount(withoutSampleDataset(store))
  const day = Math.min(28, Math.max(1, input.day ?? 1))
  const label = input.label.trim() || 'Rücklage'
  const now = new Date().toISOString()
  const amount = -amountAbs
  const monthList = monthsInclusive(
    input.month,
    input.endMonth?.trim() || input.month,
  )
  const recurring = monthList.length > 1
  const purpose = recurring
    ? 'Manuelle Ausgabe / Rücklage (wiederkehrend)'
    : 'Manuelle Ausgabe / Rücklage'
  const stamp = Date.now().toString(36)

  const created: Transaction[] = monthList.map((month, i) => {
    const date = `${month}-${String(day).padStart(2, '0')}`
    return {
      id: `manual_${stamp}_${i.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      accountId: MANUAL_ACCOUNT_ID,
      date,
      valueDate: date,
      status: 'Manuell',
      counterparty: label,
      purpose,
      type: 'Ausgang',
      iban: '',
      amount,
      categoryId: input.categoryId,
      origin: 'manual',
      categoryOverride: true,
      importedAt: now,
    }
  })

  return {
    ...withAccount,
    isDemo: false,
    transactions: [...created, ...withAccount.transactions].sort((a, b) =>
      b.date.localeCompare(a.date),
    ),
  }
}

export function deleteTransaction(
  store: AppStore,
  transactionId: string,
): AppStore {
  return {
    ...store,
    transactions: store.transactions.filter((t) => t.id !== transactionId),
  }
}

/** Remove a CSV import batch and all transactions created by it. */
export function deleteImport(
  store: AppStore,
  importId: string,
): AppStore {
  return {
    ...store,
    imports: (store.imports ?? []).filter((i) => i.id !== importId),
    transactions: store.transactions.filter((t) => t.importId !== importId),
  }
}

/** Move an import batch (and its transactions) to a different account. */
export function reassignImport(
  store: AppStore,
  importId: string,
  accountId: string,
): AppStore {
  if (accountId === MANUAL_ACCOUNT_ID) return store
  if (!store.accounts.some((a) => a.id === accountId)) return store

  const batch = (store.imports ?? []).find((i) => i.id === importId)
  if (!batch || batch.accountId === accountId) return store

  return {
    ...store,
    imports: (store.imports ?? []).map((i) =>
      i.id === importId ? { ...i, accountId } : i,
    ),
    transactions: store.transactions.map((t) =>
      t.importId === importId ? { ...t, accountId } : t,
    ),
  }
}
