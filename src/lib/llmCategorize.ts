import { invoke, isTauri } from '@tauri-apps/api/core'
import type { CategoryId, Transaction } from './types'

export interface LlmStatus {
  available: boolean
  model: string
  /** `apple` | `bundled` | `none` */
  provider: string
  loaded: boolean
  error: string | null
}

export interface LlmCategoryAssignment {
  id: string
  categoryId: string
}

export interface CategorizeWithLlmResult {
  assignments: LlmCategoryAssignment[]
  /** `apple` | `bundled` */
  provider: string
}

interface LlmTransactionInput {
  id: string
  counterparty: string
  purpose: string
  amount: number
  bookingType: string
}

/** True when running inside the desktop shell (bundled model available). */
export function llmSupported(): boolean {
  return isTauri()
}

export async function getLlmStatus(): Promise<LlmStatus | null> {
  if (!isTauri()) return null
  try {
    return await invoke<LlmStatus>('llm_status')
  } catch {
    return null
  }
}

/**
 * Ask on-device AI to categorize transactions (Apple FM preferred, else GGUF).
 * Returns only successfully validated assignments plus which provider ran.
 */
export async function categorizeWithLlm(
  transactions: Transaction[],
  categoryIds: CategoryId[],
): Promise<CategorizeWithLlmResult> {
  if (!isTauri() || transactions.length === 0) {
    return { assignments: [], provider: 'bundled' }
  }

  const payload: LlmTransactionInput[] = transactions.map((tx) => ({
    id: tx.id,
    counterparty: tx.counterparty,
    purpose: tx.purpose,
    amount: tx.amount,
    bookingType: tx.type,
  }))

  return invoke<CategorizeWithLlmResult>('categorize_with_llm', {
    transactions: payload,
    categoryIds,
  })
}

/** Apply LLM assignments onto a transaction list (no categoryOverride). */
export function applyLlmAssignments(
  transactions: Transaction[],
  assignments: LlmCategoryAssignment[],
  validIds: Set<string>,
): { transactions: Transaction[]; assigned: number } {
  if (assignments.length === 0) {
    return { transactions, assigned: 0 }
  }
  const byId = new Map(
    assignments
      .filter((a) => validIds.has(a.categoryId) && a.categoryId !== 'uncategorized')
      .map((a) => [a.id, a.categoryId as CategoryId]),
  )
  if (byId.size === 0) return { transactions, assigned: 0 }

  let assigned = 0
  const next = transactions.map((tx) => {
    if (tx.categoryOverride) return tx
    if (tx.categoryId !== 'uncategorized') return tx
    const categoryId = byId.get(tx.id)
    if (!categoryId) return tx
    assigned += 1
    return { ...tx, categoryId }
  })
  return { transactions: next, assigned }
}
