import type { CategoryId, CategoryRule, Transaction } from './types'
import { getCategoryMap } from './categories'

function matchesRule(text: string, rule: CategoryRule): boolean {
  const haystack = text.toLowerCase()
  if (rule.isRegex) {
    try {
      return new RegExp(rule.pattern, 'i').test(text)
    } catch {
      return false
    }
  }
  return haystack.includes(rule.pattern.toLowerCase())
}

const SECURITIES_TYPES = new Set([
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
])

const DIVIDEND_TYPES = new Set([
  'DIVIDEND',
  'INTEREST',
  'INTEREST_PAYMENT',
  'LENDING',
])

/** Trade Republic cash movements between own accounts / external bank. */
const CASH_TRANSFER_TYPES = new Set([
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
])

/**
 * Detect stock / ETF / warrant trades (buys & sells).
 * Dividends and interest are NOT securities trades — they stay income.
 */
export function isSecuritiesTrade(
  tx: Pick<Transaction, 'type' | 'purpose' | 'counterparty'>,
): boolean {
  const type = tx.type.trim().toUpperCase()
  if (DIVIDEND_TYPES.has(type)) return false

  const text = `${tx.purpose} ${tx.counterparty}`
  const lower = text.toLowerCase()

  // Cash income from holdings — keep as investments, not trades
  if (
    /cash dividend|dividende|ausschüttung|zinszahlung|interest payment/.test(
      lower,
    )
  ) {
    return false
  }

  if (SECURITIES_TYPES.has(type)) return true

  if (/\b(buy|sell)\s+trade\b/.test(lower)) return true
  if (/·\s*(buy|sell)\s*·/.test(lower)) return true
  if (/savings plan execution/.test(lower)) return true
  if (/warrant exercise/.test(lower)) return true
  if (/wertpapier(kauf|verkauf|abrechnung|geschäft)/.test(lower)) return true
  if (/\bisin\b/i.test(text) && /trading|savings.?plan|quantity:/.test(lower)) {
    return true
  }

  return false
}

/** True for TR (and similar) cash transfer booking types. */
export function isCashTransfer(
  tx: Pick<Transaction, 'type' | 'purpose'>,
): boolean {
  const type = tx.type.trim().toUpperCase()
  if (CASH_TRANSFER_TYPES.has(type)) return true
  // Purpose often embeds the TR type when counterparty is a person name
  const purpose = tx.purpose.toUpperCase()
  return (
    /\bTRANSFER_OUTBOUND\b/.test(purpose) ||
    /\bTRANSFER_INBOUND\b/.test(purpose) ||
    /\bTRANSFER_INSTANT_OUTBOUND\b/.test(purpose) ||
    /\bTRANSFER_INSTANT_INBOUND\b/.test(purpose)
  )
}

/**
 * Apply category rules. User rules are checked before default rules.
 * Existing manual overrides are preserved.
 * Positive "Eingang"/dividend-style rows without a match default toward income categories.
 */
export function categorizeTransaction(
  tx: Transaction,
  rules: CategoryRule[],
): CategoryId {
  if (tx.categoryOverride && tx.categoryId !== 'uncategorized') {
    return tx.categoryId
  }

  // Portfolio movements before merchant keyword rules (avoids false matches)
  if (isSecuritiesTrade(tx)) {
    return 'securities'
  }

  // Own-account / SEPA transfers before name-based salary rules
  if (isCashTransfer(tx)) {
    return 'transfer'
  }

  const sorted = [...rules].sort((a, b) => {
    if (a.source === b.source) return 0
    return a.source === 'user' ? -1 : 1
  })

  const text = `${tx.counterparty} ${tx.purpose}`
  for (const rule of sorted) {
    if (rule.amount != null && rule.amount !== tx.amount) continue
    if (!matchesRule(text, rule)) continue
    // Income rules must not tag outflows (e.g. "Felippe…" → salary on transfers)
    if (getCategoryMap()[rule.categoryId]?.isIncome && tx.amount < 0) continue
    return rule.categoryId
  }

  // Direction-based fallback so income/expense stay distinguishable
  const type = `${tx.type} ${tx.purpose}`.toLowerCase()
  if (tx.amount > 0) {
    if (
      /dividend|zins|interest|dividende|ausschüttung/.test(type) ||
      /investments?/.test(text.toLowerCase())
    ) {
      return 'investments'
    }
    if (/gehalt|lohn|salary|eingang|inbound|inpayment/.test(type + text.toLowerCase())) {
      return 'salary'
    }
  }

  return 'uncategorized'
}

export function categorizeAll(
  transactions: Transaction[],
  rules: CategoryRule[],
): Transaction[] {
  return transactions.map((tx) => {
    if (tx.categoryOverride) {
      // Re-tag auto-overridden broker trades that were stored as transfer
      if (
        tx.categoryId === 'transfer' &&
        isSecuritiesTrade(tx) &&
        tx.origin === 'bank'
      ) {
        return { ...tx, categoryId: 'securities' }
      }
      // Re-tag TR cash transfers that were auto-mapped then overridden by rules
      // before transfer types were recognized (e.g. salary via name match).
      if (
        tx.origin === 'bank' &&
        isCashTransfer(tx) &&
        (tx.categoryId === 'salary' || tx.categoryId === 'uncategorized')
      ) {
        return { ...tx, categoryId: 'transfer', categoryOverride: true }
      }
      return tx
    }
    return { ...tx, categoryId: categorizeTransaction(tx, rules) }
  })
}

export function isExpenseCategory(categoryId: CategoryId): boolean {
  const cat = getCategoryMap()[categoryId]
  return !cat?.isIncome && !cat?.excludeFromTotals
}

export function isIncomeCategory(categoryId: CategoryId): boolean {
  return Boolean(getCategoryMap()[categoryId]?.isIncome)
}

export function countsTowardTotals(categoryId: CategoryId): boolean {
  return !getCategoryMap()[categoryId]?.excludeFromTotals
}

export type TransactionFlow = 'income' | 'expense' | 'transfer'

/**
 * Classify a booking for UI filters / badges.
 * Categories with excludeFromTotals (transfer, securities, excluded) are neutral.
 */
export function transactionFlow(tx: Transaction): TransactionFlow {
  const map = getCategoryMap()
  if (map[tx.categoryId]?.excludeFromTotals) return 'transfer'
  if (map[tx.categoryId]?.isIncome) {
    return tx.amount >= 0 ? 'income' : 'expense'
  }
  if (tx.amount > 0) return 'income' // refunds / unexpected credits
  return 'expense'
}
