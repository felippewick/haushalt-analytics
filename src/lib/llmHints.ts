import { CATEGORY_LABELS } from './i18n/categories'
import type { Category } from './types'
import { categoryKind } from './categories'

export interface LlmCategorySpec {
  id: string
  label: string
}

export type LlmCashflow = 'in' | 'out'

/**
 * Uncategorized is never offered to the model.
 * Sonstiges (`other`) is allowed for both income and expenses.
 */
const LLM_SKIP_CATEGORY_IDS = new Set(['uncategorized'])

export function llmCategorySpecs(
  categories: Category[],
  cashflow?: LlmCashflow,
): LlmCategorySpec[] {
  return categories
    .filter((c) => !LLM_SKIP_CATEGORY_IDS.has(c.id))
    .filter((c) => {
      if (!cashflow) return categoryKind(c) !== 'excluded'
      if (c.id === 'other') return true
      if (cashflow === 'in') return categoryKind(c) === 'income'
      return categoryKind(c) === 'expense'
    })
    .map((c) => {
      const label =
        c.labelOverride?.trim() ||
        (CATEGORY_LABELS.de as Record<string, string | undefined>)[c.id] ||
        (CATEGORY_LABELS.en as Record<string, string | undefined>)[c.id] ||
        c.label
      return { id: c.id, label }
    })
}

/** Taxonomy only — no merchant keyword lists. The model must infer the rest. */
export function buildLlmSystemPrompt(
  specs: LlmCategorySpec[],
  cashflow?: LlmCashflow,
): string {
  const lines = specs.map((s) => `- ${s.id} (${s.label})`)
  const scope =
    cashflow === 'in'
      ? 'This booking is income (positive amount). Pick only an income category.'
      : cashflow === 'out'
        ? 'This booking is an expense (negative amount). Pick only an expense category.'
        : 'Use the counterparty, purpose, booking type, and amount. Infer what the merchant is.'
  return `You categorize German household bank transactions.
${scope}
Reply with ONLY one category id from this list. No punctuation, no explanation.

Categories:
${lines.join('\n')}`
}

export function buildLlmUserPrompt(input: {
  counterparty: string
  purpose: string
  bookingType: string
  amount: number
}): string {
  return `Counterparty: ${input.counterparty.trim() || '—'}
Purpose: ${input.purpose.trim() || '—'}
Type: ${input.bookingType.trim() || '—'}
Amount EUR: ${input.amount.toFixed(2)}

Category id:`
}
