import { transactionContentKey } from './dkbParser'
import { categorizeAll } from './categorize'
import {
  extractTradeRepublicNativeId,
  findAccountByIdentity,
  hydrateStore,
  legacyImportId,
} from './store'
import type {
  Account,
  AppStore,
  Category,
  CategoryId,
  CategoryRule,
  ImportBatch,
  Transaction,
} from './types'
import {
  categoriesEqual,
  cloneDefaultCategories,
  normalizeCategories,
} from './categories'

const SAMPLE_LIMIT = 20

export interface AccountNameDiffSample {
  localId: string
  localName: string
  incomingName: string
}

export interface CategoryUpdateSample {
  transactionId: string
  counterparty: string
  date: string
  fromCategoryId: CategoryId
  toCategoryId: CategoryId
}

export interface StoreMergeSummary {
  accountsAdded: number
  accountsMatched: number
  accountNameDiffs: number
  identityFilled: number
  transactionsAdded: number
  transactionsSkippedSame: number
  transactionsCategoryUpdated: number
  transactionsConflictKeptLocal: number
  rulesAdded: number
  rulesSkipped: number
  rulesUpdated: number
  importsAdded: number
  importsSkipped: number
  categoriesAdded: number
  categoriesUpdated: number
}

export interface StoreMergePreview {
  merged: AppStore
  summary: StoreMergeSummary
  samples: {
    categoryUpdates: CategoryUpdateSample[]
    accountNameDiffs: AccountNameDiffSample[]
  }
  warnings: string[]
  hasChanges: boolean
}

function emptySummary(): StoreMergeSummary {
  return {
    accountsAdded: 0,
    accountsMatched: 0,
    accountNameDiffs: 0,
    identityFilled: 0,
    transactionsAdded: 0,
    transactionsSkippedSame: 0,
    transactionsCategoryUpdated: 0,
    transactionsConflictKeptLocal: 0,
    rulesAdded: 0,
    rulesSkipped: 0,
    rulesUpdated: 0,
    importsAdded: 0,
    importsSkipped: 0,
    categoriesAdded: 0,
    categoriesUpdated: 0,
  }
}

/** Persistable store shape (user rules only), matching saveStore. */
export function serializeStoreForFile(store: AppStore): AppStore {
  return {
    version: 2,
    accounts: store.accounts,
    transactions: store.transactions,
    rules: store.rules.filter((r) => r.source === 'user'),
    imports: store.imports ?? [],
    lastImportedAt: store.lastImportedAt,
    categories: store.categories ?? cloneDefaultCategories(),
  }
}

export function storeToDownloadJson(store: AppStore): string {
  return JSON.stringify(serializeStoreForFile(store), null, 2)
}

export function downloadStoreJson(store: AppStore, filename?: string): void {
  const json = storeToDownloadJson(store)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = filename ?? `store-${date}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function isLikelyAppStore(value: unknown): value is Partial<AppStore> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  // Accept empty-ish stores and v1/v2 as long as it looks like our document
  const hasKnownKey =
    'transactions' in obj ||
    'accounts' in obj ||
    'rules' in obj ||
    'version' in obj ||
    'imports' in obj ||
    'categories' in obj ||
    'lastImportedAt' in obj
  return hasKnownKey
}

/** Parse + hydrate an imported store.json. Throws on invalid input. */
export async function parseStoreFile(file: File): Promise<AppStore> {
  let text: string
  try {
    text = await file.text()
  } catch {
    throw new Error('error.couldNotReadFile')
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('error.invalidJson')
  }

  if (!isLikelyAppStore(raw)) {
    throw new Error('error.notStoreFile')
  }

  return hydrateStore(raw)
}

function ruleKey(rule: CategoryRule): string {
  const amountKey = rule.amount == null ? '' : `:amt=${rule.amount}`
  return `${rule.isRegex ? 're' : 'sub'}:${rule.pattern.toLowerCase()}${amountKey}`
}

function bankFieldsDiffer(a: Transaction, b: Transaction): boolean {
  return (
    a.date !== b.date ||
    a.amount !== b.amount ||
    a.counterparty !== b.counterparty ||
    a.purpose !== b.purpose ||
    a.valueDate !== b.valueDate ||
    a.type !== b.type ||
    a.iban !== b.iban
  )
}

function shouldTakeIncomingCategory(
  local: Transaction,
  incoming: Transaction,
): boolean {
  if (!incoming.categoryOverride) return false
  if (!local.categoryOverride) return true
  return local.categoryId !== incoming.categoryId
}

function laterTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

function mergeAccounts(
  local: Account[],
  incoming: Account[],
  summary: StoreMergeSummary,
  nameDiffSamples: AccountNameDiffSample[],
): { accounts: Account[]; accountIdMap: Map<string, string> } {
  const accounts = local.map((a) => ({ ...a }))
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const accountIdMap = new Map<string, string>()

  for (const inc of incoming) {
    const bySameId = byId.get(inc.id)
    const byIdentity =
      bySameId ??
      findAccountByIdentity(accounts, {
        iban: inc.iban,
        fingerprint: inc.fingerprint,
      })

    if (byIdentity) {
      summary.accountsMatched++
      accountIdMap.set(inc.id, byIdentity.id)

      if (inc.name.trim() && inc.name.trim() !== byIdentity.name.trim()) {
        summary.accountNameDiffs++
        if (nameDiffSamples.length < SAMPLE_LIMIT) {
          nameDiffSamples.push({
            localId: byIdentity.id,
            localName: byIdentity.name,
            incomingName: inc.name,
          })
        }
      }

      let filled = false
      const next: Account = { ...byIdentity }
      if (inc.iban && !byIdentity.iban) {
        next.iban = inc.iban
        filled = true
      }
      if (inc.fingerprint && !byIdentity.fingerprint) {
        next.fingerprint = inc.fingerprint
        filled = true
      }
      if (filled) {
        summary.identityFilled++
        const idx = accounts.findIndex((a) => a.id === byIdentity.id)
        if (idx >= 0) {
          accounts[idx] = next
          byId.set(next.id, next)
        }
      }
      continue
    }

    summary.accountsAdded++
    accountIdMap.set(inc.id, inc.id)
    const added = { ...inc }
    accounts.push(added)
    byId.set(added.id, added)
  }

  return { accounts, accountIdMap }
}

function mergeTransactions(
  local: Transaction[],
  incoming: Transaction[],
  accountIdMap: Map<string, string>,
  summary: StoreMergeSummary,
  categorySamples: CategoryUpdateSample[],
): Transaction[] {
  const byId = new Map(local.map((t) => [t.id, { ...t }]))
  const contentToId = new Map<string, string>()
  const nativeToId = new Map<string, string>()

  for (const t of byId.values()) {
    contentToId.set(
      transactionContentKey({
        date: t.date,
        amount: t.amount,
        counterparty: t.counterparty,
        purpose: t.purpose,
      }),
      t.id,
    )
    const native = extractTradeRepublicNativeId(t.id, t.accountId)
    if (native) nativeToId.set(native, t.id)
  }

  for (const raw of incoming) {
    const remappedAccountId =
      accountIdMap.get(raw.accountId) ?? raw.accountId
    let importId = raw.importId
    if (
      remappedAccountId !== raw.accountId &&
      importId?.startsWith('imp_legacy_')
    ) {
      importId = legacyImportId(remappedAccountId, raw.importedAt)
    }
    const inc: Transaction = {
      ...raw,
      accountId: remappedAccountId,
      importId,
    }

    const content = transactionContentKey({
      date: inc.date,
      amount: inc.amount,
      counterparty: inc.counterparty,
      purpose: inc.purpose,
    })
    const native = extractTradeRepublicNativeId(inc.id, inc.accountId)

    const matchId =
      (byId.has(inc.id) ? inc.id : undefined) ??
      contentToId.get(content) ??
      (native ? nativeToId.get(native) : undefined)

    if (matchId) {
      const localTx = byId.get(matchId)
      if (!localTx) continue
      let updated = { ...localTx }
      let changed = false
      const contentConflict =
        bankFieldsDiffer(localTx, inc) && localTx.id === inc.id

      if (contentConflict) {
        summary.transactionsConflictKeptLocal++
      }

      if (shouldTakeIncomingCategory(localTx, inc)) {
        if (
          localTx.categoryId !== inc.categoryId ||
          !localTx.categoryOverride
        ) {
          summary.transactionsCategoryUpdated++
          if (categorySamples.length < SAMPLE_LIMIT) {
            categorySamples.push({
              transactionId: localTx.id,
              counterparty: localTx.counterparty,
              date: localTx.date,
              fromCategoryId: localTx.categoryId,
              toCategoryId: inc.categoryId,
            })
          }
          updated = {
            ...updated,
            categoryId: inc.categoryId,
            categoryOverride: true,
          }
          changed = true
        }
      }

      if (!updated.importId && inc.importId) {
        updated = { ...updated, importId: inc.importId }
        changed = true
      }
      if (!updated.origin && inc.origin) {
        updated = { ...updated, origin: inc.origin }
        changed = true
      }

      if (changed) {
        byId.set(matchId, updated)
      } else if (!contentConflict) {
        summary.transactionsSkippedSame++
      }
      continue
    }

    // New transaction — if id already somehow reserved we shouldn't reach here
    byId.set(inc.id, inc)
    contentToId.set(content, inc.id)
    if (native) nativeToId.set(native, inc.id)
    summary.transactionsAdded++
  }

  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date))
}

function mergeRules(
  local: CategoryRule[],
  incoming: CategoryRule[],
  summary: StoreMergeSummary,
): CategoryRule[] {
  const localUser = local.filter((r) => r.source === 'user')
  const defaults = local.filter((r) => r.source === 'default')
  const incomingUser = incoming.filter((r) => r.source === 'user')

  const byId = new Map(localUser.map((r) => [r.id, { ...r }]))
  const byPattern = new Map(localUser.map((r) => [ruleKey(r), r.id]))

  for (const inc of incomingUser) {
    const existingId = byId.has(inc.id)
      ? inc.id
      : byPattern.get(ruleKey(inc))

    if (existingId) {
      const existing = byId.get(existingId)
      if (!existing) continue
      if (
        existing.categoryId !== inc.categoryId ||
        Boolean(existing.isRegex) !== Boolean(inc.isRegex) ||
        existing.pattern !== inc.pattern ||
        existing.amount !== inc.amount
      ) {
        byId.set(existingId, {
          ...existing,
          categoryId: inc.categoryId,
          pattern: inc.pattern,
          isRegex: inc.isRegex,
          amount: inc.amount,
          source: 'user',
        })
        // Keep pattern index in sync if pattern changed
        byPattern.delete(ruleKey(existing))
        byPattern.set(ruleKey(inc), existingId)
        summary.rulesUpdated++
      } else {
        summary.rulesSkipped++
      }
      continue
    }

    byId.set(inc.id, { ...inc, source: 'user' })
    byPattern.set(ruleKey(inc), inc.id)
    summary.rulesAdded++
  }

  return [...byId.values(), ...defaults]
}

function mergeImports(
  local: ImportBatch[],
  incoming: ImportBatch[],
  accountIdMap: Map<string, string>,
  summary: StoreMergeSummary,
): ImportBatch[] {
  const byId = new Map(local.map((b) => [b.id, { ...b }]))

  for (const raw of incoming) {
    const accountId = accountIdMap.get(raw.accountId) ?? raw.accountId
    let id = raw.id
    if (raw.id.startsWith('imp_legacy_') && accountId !== raw.accountId) {
      id = legacyImportId(accountId, raw.importedAt)
    }
    const remapped: ImportBatch = {
      ...raw,
      id,
      accountId,
    }
    const existing = byId.get(remapped.id)
    if (existing) {
      // Fill missing original CSV from incoming when local batch has none
      if (!existing.rawCsv && remapped.rawCsv) {
        byId.set(remapped.id, { ...existing, rawCsv: remapped.rawCsv })
      }
      summary.importsSkipped++
      continue
    }
    byId.set(remapped.id, remapped)
    summary.importsAdded++
  }

  return [...byId.values()].sort((a, b) =>
    b.importedAt.localeCompare(a.importedAt),
  )
}

/**
 * Prefer local category definitions; add missing incoming categories.
 * Incoming updates to shared ids are applied when local still matches defaults
 * for that id (so customizations on either side are preserved carefully).
 */
function mergeCategories(
  local: Category[],
  incoming: Category[],
  summary: StoreMergeSummary,
): Category[] {
  const localNorm = normalizeCategories(local)
  const incomingNorm = normalizeCategories(incoming)
  const defaults = cloneDefaultCategories()
  const defaultById = new Map(defaults.map((c) => [c.id, c]))

  const byId = new Map(localNorm.map((c) => [c.id, { ...c }]))
  const order = localNorm.map((c) => c.id)

  for (const inc of incomingNorm) {
    const existing = byId.get(inc.id)
    if (!existing) {
      byId.set(inc.id, { ...inc })
      order.push(inc.id)
      summary.categoriesAdded++
      continue
    }

    const def = defaultById.get(inc.id)
    const localIsDefault =
      def != null &&
      existing.color === def.color &&
      Boolean(existing.isIncome) === Boolean(def.isIncome) &&
      Boolean(existing.excludeFromTotals) === Boolean(def.excludeFromTotals) &&
      !existing.labelOverride &&
      existing.label === def.label

    if (!localIsDefault) continue

    const changed =
      existing.color !== inc.color ||
      Boolean(existing.isIncome) !== Boolean(inc.isIncome) ||
      Boolean(existing.excludeFromTotals) !== Boolean(inc.excludeFromTotals) ||
      (existing.labelOverride ?? '') !== (inc.labelOverride ?? '') ||
      existing.label !== inc.label

    if (changed) {
      byId.set(inc.id, { ...inc })
      summary.categoriesUpdated++
    }
  }

  return order.map((id) => byId.get(id)!).filter(Boolean)
}

export function previewStoreMerge(
  local: AppStore,
  incoming: AppStore,
): StoreMergePreview {
  const summary = emptySummary()
  const categoryUpdates: CategoryUpdateSample[] = []
  const accountNameDiffs: AccountNameDiffSample[] = []
  const warnings: string[] = []

  const incomingEmpty =
    incoming.accounts.length === 0 &&
    incoming.transactions.length === 0 &&
    incoming.rules.filter((r) => r.source === 'user').length === 0 &&
    (incoming.imports?.length ?? 0) === 0

  if (incomingEmpty) {
    warnings.push('merge.warn.empty')
  }

  const { accounts, accountIdMap } = mergeAccounts(
    local.accounts,
    incoming.accounts,
    summary,
    accountNameDiffs,
  )

  const transactions = mergeTransactions(
    local.transactions,
    incoming.transactions,
    accountIdMap,
    summary,
    categoryUpdates,
  )

  const rules = mergeRules(local.rules, incoming.rules, summary)
  const imports = mergeImports(
    local.imports ?? [],
    incoming.imports ?? [],
    accountIdMap,
    summary,
  )

  const categories = mergeCategories(
    local.categories ?? cloneDefaultCategories(),
    incoming.categories ?? cloneDefaultCategories(),
    summary,
  )

  const lastImportedAt = laterTimestamp(
    local.lastImportedAt,
    incoming.lastImportedAt,
  )

  // New / updated user rules should re-categorize non-overridden txs
  const finalTransactions =
    summary.rulesAdded > 0 || summary.rulesUpdated > 0
      ? categorizeAll(transactions, rules)
      : transactions

  const merged: AppStore = {
    version: 2,
    isDemo: false,
    accounts,
    transactions: finalTransactions,
    rules,
    imports,
    lastImportedAt,
    categories,
  }

  const hasChanges =
    summary.accountsAdded > 0 ||
    summary.identityFilled > 0 ||
    summary.transactionsAdded > 0 ||
    summary.transactionsCategoryUpdated > 0 ||
    summary.rulesAdded > 0 ||
    summary.rulesUpdated > 0 ||
    summary.importsAdded > 0 ||
    summary.categoriesAdded > 0 ||
    summary.categoriesUpdated > 0 ||
    lastImportedAt !== local.lastImportedAt ||
    !categoriesEqual(
      local.categories ?? cloneDefaultCategories(),
      categories,
    )

  if (
    !hasChanges &&
    !incomingEmpty &&
    summary.transactionsSkippedSame +
      summary.accountsMatched +
      summary.rulesSkipped +
      summary.importsSkipped >
      0
  ) {
    warnings.push('merge.warn.alreadyPresent')
  }

  return {
    merged,
    summary,
    samples: { categoryUpdates, accountNameDiffs },
    warnings,
    hasChanges,
  }
}

/** Parse a file and build a merge preview against the local store. */
export async function previewStoreFileMerge(
  local: AppStore,
  file: File,
): Promise<StoreMergePreview> {
  const incoming = await parseStoreFile(file)
  return previewStoreMerge(local, incoming)
}
