import type { CategoryId, Transaction } from './types'
import type { LlmCategoryAssignment, LlmSuggestion } from './llmCategorize'
import { categoryFitsCashflow } from './categorize'

/**
 * Same grouping as manual “Apply to others”: one key per merchant + cash
 * direction. Purpose is only used when the counterparty is empty.
 */
export function similarTransactionKey(
  tx: Pick<Transaction, 'counterparty' | 'purpose' | 'amount' | 'id'>,
): string {
  const merchant = normalizeLabel(tx.counterparty)
  const direction = tx.amount >= 0 ? 'in' : 'out'
  if (merchant) return `m:${merchant}|${direction}`
  const purpose = normalizeLabel(tx.purpose)
  if (purpose) return `p:${purpose}|${direction}`
  return `id:${tx.id}`
}

export function sameSenderAndAmount(
  a: Pick<Transaction, 'counterparty' | 'amount'>,
  b: Pick<Transaction, 'counterparty' | 'amount'>,
): boolean {
  return (
    normalizeLabel(a.counterparty) === normalizeLabel(b.counterparty) &&
    a.amount === b.amount
  )
}

export function groupBySimilar(
  transactions: Transaction[],
): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>()
  for (const tx of transactions) {
    const key = similarTransactionKey(tx)
    const list = groups.get(key)
    if (list) list.push(tx)
    else groups.set(key, [tx])
  }
  return groups
}

/** Prefer the row with the most purpose text so the model has more signal. */
export function pickRepresentative(group: Transaction[]): Transaction {
  return group.reduce((best, tx) =>
    tx.purpose.trim().length > best.purpose.trim().length ? tx : best,
  )
}

export function uniqueRepresentatives(transactions: Transaction[]): Transaction[] {
  return [...groupBySimilar(transactions).values()].map(pickRepresentative)
}

/**
 * Copy a category from already-categorized bookings that share the merchant
 * key, but only when they all agree. Excluded stays scoped to sender + amount.
 */
export function seedFromSimilar(
  pending: Transaction[],
  catalog: Transaction[],
  validIds: Set<string>,
): LlmCategoryAssignment[] {
  const agreed = new Map<string, CategoryId>()
  const mixed = new Set<string>()
  const excludedExact = new Set<string>()

  for (const tx of catalog) {
    if (!validIds.has(tx.categoryId)) continue
    if (tx.categoryId === 'uncategorized') continue
    if (tx.categoryId === 'excluded') {
      excludedExact.add(excludedKey(tx))
      continue
    }
    const key = similarTransactionKey(tx)
    if (mixed.has(key)) continue
    const existing = agreed.get(key)
    if (!existing) {
      agreed.set(key, tx.categoryId)
    } else if (existing !== tx.categoryId) {
      agreed.delete(key)
      mixed.add(key)
    }
  }

  const out: LlmCategoryAssignment[] = []
  for (const tx of pending) {
    if (excludedExact.has(excludedKey(tx))) {
      out.push({ id: tx.id, categoryId: 'excluded' })
      continue
    }
    const categoryId = agreed.get(similarTransactionKey(tx))
    if (!categoryId) continue
    if (!categoryFitsCashflow(categoryId, tx.amount)) continue
    out.push({ id: tx.id, categoryId })
  }
  return out
}

/** Spread one assignment onto every pending booking in the same similar group. */
export function expandSimilarAssignments(
  assignments: LlmCategoryAssignment[],
  pending: Transaction[],
  validIds: Set<string>,
): LlmCategoryAssignment[] {
  const byId = new Map(pending.map((tx) => [tx.id, tx]))
  const out: LlmCategoryAssignment[] = []
  const seen = new Set<string>()

  for (const assignment of assignments) {
    if (
      !validIds.has(assignment.categoryId) ||
      assignment.categoryId === 'uncategorized'
    ) {
      continue
    }
    const src = byId.get(assignment.id)
    if (!src) continue
    const members =
      assignment.categoryId === 'excluded'
        ? pending.filter((tx) => sameSenderAndAmount(tx, src))
        : pending.filter(
            (tx) => similarTransactionKey(tx) === similarTransactionKey(src),
          )
    for (const tx of members) {
      if (seen.has(tx.id)) continue
      seen.add(tx.id)
      out.push({ id: tx.id, categoryId: assignment.categoryId })
    }
  }
  return out
}

/** One review row per similar group (same as remembering a merchant). */
export function collapseToSuggestions(
  pending: Transaction[],
  assignments: LlmCategoryAssignment[],
  validIds: Set<string>,
): LlmSuggestion[] {
  const expanded = expandSimilarAssignments(assignments, pending, validIds)
  const byId = new Map(pending.map((tx) => [tx.id, tx]))
  const groups = new Map<string, { categoryId: CategoryId; txs: Transaction[] }>()

  for (const assignment of expanded) {
    const tx = byId.get(assignment.id)
    if (!tx) continue
    const categoryId = assignment.categoryId as CategoryId
    const key =
      categoryId === 'excluded'
        ? `ex:${excludedKey(tx)}`
        : similarTransactionKey(tx)
    const existing = groups.get(key)
    if (existing) existing.txs.push(tx)
    else groups.set(key, { categoryId, txs: [tx] })
  }

  const suggestions: LlmSuggestion[] = []
  for (const group of groups.values()) {
    const tx = pickRepresentative(group.txs)
    suggestions.push({
      id: tx.id,
      categoryId: group.categoryId,
      tx,
      memberIds: group.txs.map((item) => item.id),
    })
  }
  return suggestions
}

function excludedKey(tx: Pick<Transaction, 'counterparty' | 'amount'>): string {
  return `${normalizeLabel(tx.counterparty)}|${tx.amount}`
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
