import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Category, CategoryId, Transaction } from './types'
import { buildLlmSystemPrompt, llmCategorySpecs, type LlmCashflow } from './llmHints'
import { categoryFitsCashflow } from './categorize'
import {
  collapseToSuggestions,
  expandSimilarAssignments,
  seedFromSimilar,
  uniqueRepresentatives,
} from './similarTransactions'

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

export interface LlmProgress {
  done: number
  total: number
}

export interface LlmSuggestion {
  id: string
  categoryId: CategoryId
  tx: Transaction
  /** All pending bookings that share this merchant / similar key. */
  memberIds: string[]
}

export interface AutoCategorizePreview {
  suggestions: LlmSuggestion[]
  attempted: number
  provider?: 'apple' | 'bundled'
}

interface LlmTransactionInput {
  id: string
  counterparty: string
  purpose: string
  amount: number
  bookingType: string
}

export function suggestionMemberCount(suggestion: LlmSuggestion): number {
  return suggestion.memberIds.length > 0 ? suggestion.memberIds.length : 1
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

/** Keep IPC + llama.cpp batches bounded so a large CSV cannot stall the UI. */
const LLM_CHUNK_SIZE = 48

export interface CategorizeWithLlmOptions {
  /** Already-categorized bookings used to skip repeating the same merchant. */
  knownTransactions?: Transaction[]
  onProgress?: (progress: LlmProgress) => void
}

/**
 * Ask on-device AI to categorize transactions (Apple FM preferred, else GGUF).
 * Repeats one merchant only once, then copies the answer onto similar bookings.
 */
export async function categorizeWithLlm(
  transactions: Transaction[],
  categories: Category[],
  options: CategorizeWithLlmOptions = {},
): Promise<CategorizeWithLlmResult> {
  if (!isTauri() || transactions.length === 0) {
    return { assignments: [], provider: 'bundled' }
  }

  const assignableIds = new Set(
    categories.filter((c) => c.id !== 'uncategorized').map((c) => c.id),
  )

  const seeded = options.knownTransactions
    ? seedFromSimilar(transactions, options.knownTransactions, assignableIds)
    : []
  const seededIds = new Set(seeded.map((a) => a.id))
  const remaining = transactions.filter((tx) => !seededIds.has(tx.id))

  const batches: { cashflow: LlmCashflow; reps: Transaction[] }[] = [
    {
      cashflow: 'out',
      reps: uniqueRepresentatives(remaining.filter((tx) => tx.amount < 0)),
    },
    {
      cashflow: 'in',
      reps: uniqueRepresentatives(remaining.filter((tx) => tx.amount >= 0)),
    },
  ]
  const total = batches.reduce((n, batch) => n + batch.reps.length, 0)
  const llmIds = new Set(
    batches.flatMap((batch) =>
      llmCategorySpecs(categories, batch.cashflow).map((s) => s.id),
    ),
  )

  options.onProgress?.({ done: 0, total })

  const llmAssignments: LlmCategoryAssignment[] = []
  let provider: CategorizeWithLlmResult['provider'] = 'bundled'

  if (total > 0) {
    let unlisten: (() => void) | undefined
    try {
      unlisten = await listen<LlmProgress>('llm-progress', (event) => {
        options.onProgress?.(event.payload)
      })
    } catch {
      // Events are desktop-only; invoke still works if listen is unavailable.
    }

    try {
      let offset = 0
      for (const batch of batches) {
        const specs = llmCategorySpecs(categories, batch.cashflow)
        if (batch.reps.length === 0 || specs.length === 0) {
          offset += batch.reps.length
          continue
        }
        const categoryIds = specs.map((s) => s.id)
        const allowed = new Set(categoryIds)
        const systemPrompt = buildLlmSystemPrompt(specs, batch.cashflow)
        const payload: LlmTransactionInput[] = batch.reps.map((tx) => ({
          id: tx.id,
          counterparty: tx.counterparty,
          purpose: tx.purpose,
          amount: tx.amount,
          bookingType: tx.type,
        }))

        for (let i = 0; i < payload.length; i += LLM_CHUNK_SIZE) {
          const chunk = payload.slice(i, i + LLM_CHUNK_SIZE)
          try {
            const result = await invoke<CategorizeWithLlmResult>(
              'categorize_with_llm',
              {
                transactions: chunk,
                categoryIds,
                systemPrompt,
                progressOffset: offset + i,
                progressTotal: total,
              },
            )
            llmAssignments.push(
              ...result.assignments.filter((a) => allowed.has(a.categoryId)),
            )
            provider = result.provider
          } catch (e) {
            console.warn('Local LLM chunk failed:', e)
            break
          }
        }
        offset += payload.length
      }
    } finally {
      unlisten?.()
    }
  }

  const expanded = [
    ...expandSimilarAssignments(seeded, transactions, assignableIds),
    ...expandSimilarAssignments(llmAssignments, remaining, llmIds),
  ].filter((a) => {
    if (a.categoryId === 'excluded') return true
    const tx = transactions.find((item) => item.id === a.id)
    return tx != null && categoryFitsCashflow(a.categoryId, tx.amount)
  })

  if (total > 0) {
    options.onProgress?.({ done: total, total })
  }

  return { assignments: expanded, provider }
}

export type LlmDebugProvider = 'apple' | 'bundled'

export interface LlmDebugResult {
  provider: string
  prompt: string
  raw: string
  categoryId: string | null
  error: string | null
  elapsedMs: number
}

export async function categorizeLlmDebug(input: {
  counterparty: string
  purpose: string
  bookingType: string
  amount: number
  categories: Category[]
  systemPrompt: string
  provider: LlmDebugProvider
}): Promise<LlmDebugResult> {
  if (!isTauri()) {
    return {
      provider: input.provider,
      prompt: '',
      raw: '',
      categoryId: null,
      error: 'AI lab only runs in the desktop app',
      elapsedMs: 0,
    }
  }

  return invoke<LlmDebugResult>('categorize_llm_debug', {
    transaction: {
      id: 'lab',
      counterparty: input.counterparty,
      purpose: input.purpose,
      amount: input.amount,
      bookingType: input.bookingType,
    },
    categoryIds: llmCategorySpecs(
      input.categories,
      input.amount >= 0 ? 'in' : 'out',
    ).map((s) => s.id),
    systemPrompt: input.systemPrompt,
    provider: input.provider,
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
    if (
      categoryId !== 'excluded' &&
      !categoryFitsCashflow(categoryId, tx.amount)
    ) {
      return tx
    }
    assigned += 1
    return { ...tx, categoryId }
  })
  return { transactions: next, assigned }
}

/** Validated suggestions for a review step (does not write categories). */
export function buildLlmSuggestions(
  transactions: Transaction[],
  assignments: LlmCategoryAssignment[],
  validIds: Set<string>,
): LlmSuggestion[] {
  const pending = transactions.filter(
    (tx) => !tx.categoryOverride && tx.categoryId === 'uncategorized',
  )
  return collapseToSuggestions(pending, assignments, validIds)
}
