/**
 * Trade Republic CSV parser (app export: Profile → Statements → Export Transaction).
 *
 * Comma-delimited, ISO dates, decimal-point amounts.
 */

import Papa from 'papaparse'
import type { CategoryId, Transaction } from './types'
import { categorizeTransaction } from './categorize'
import type { CategoryRule } from './types'

export function isTradeRepublicCsv(rawText: string): boolean {
  const first = rawText.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
  return (
    first.includes('transaction_id') &&
    first.includes('datetime') &&
    (first.includes('account_type') || first.includes('asset_class'))
  )
}

function strip(value: string | undefined): string {
  return (value ?? '').trim().replace(/^"|"$/g, '')
}

function parseAmount(value: string): number | null {
  const cleaned = strip(value).replace(/\s/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function parseDate(value: string): string | null {
  const v = strip(value)
  // YYYY-MM-DD or ISO datetime
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1]! : null
}

/** Map TR type/category to a starting category before keyword rules. */
export function mapTradeRepublicType(
  type: string,
  category: string,
): CategoryId {
  const t = type.toUpperCase()
  const c = category.toUpperCase()

  if (
    c === 'TRADING' ||
    [
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
    ].includes(t)
  ) {
    // Portfolio movements — not household spend
    return 'securities'
  }

  if (
    [
      'DIVIDEND',
      'INTEREST',
      'INTEREST_PAYMENT',
      'LENDING',
      'CARD_CASHBACK',
    ].includes(t)
  ) {
    return 'investments'
  }

  if (
    [
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
    ].includes(t)
  ) {
    return 'excluded'
  }

  if (['TAX', 'TAX_CORRECTION', 'WITHHOLDING_TAX'].includes(t)) {
    return 'other'
  }

  // CARD / PAYMENT / CASH retail etc. → rules / uncategorized
  return 'uncategorized'
}

function pickCounterparty(row: Record<string, string>): string {
  return (
    strip(row.counterparty_name) ||
    strip(row.name) ||
    strip(row.description) ||
    strip(row.type) ||
    'Trade Republic'
  )
}

function pickPurpose(row: Record<string, string>): string {
  const parts = [
    strip(row.description),
    strip(row.payment_reference),
    strip(row.type),
    strip(row.symbol) ? `ISIN ${strip(row.symbol)}` : '',
    strip(row.category),
  ].filter(Boolean)
  // unique-ish join
  return [...new Set(parts)].join(' · ')
}

export function parseTradeRepublicCsv(
  rawText: string,
  accountId: string,
  rules: CategoryRule[] = [],
): Transaction[] {
  const text = rawText.replace(/^\uFEFF/, '')
  const parsed = Papa.parse<Record<string, string>>(text, {
    delimiter: ',',
    header: true,
    skipEmptyLines: true,
    quoteChar: '"',
  })

  if (!parsed.meta.fields?.includes('transaction_id')) {
    throw new Error(
      'Not a Trade Republic CSV (missing transaction_id column).',
    )
  }

  const now = new Date().toISOString()
  const transactions: Transaction[] = []

  for (const row of parsed.data) {
    const date = parseDate(row.date || row.datetime || '')
    const amount = parseAmount(row.amount || '')
    if (!date || amount === null || amount === 0) continue

    // Prefer EUR cash impact; skip pure non-EUR rows without amount
    const currency = strip(row.currency).toUpperCase()
    if (currency && currency !== 'EUR') {
      // Still keep if amount is present (TR usually converts)
    }

    const type = strip(row.type)
    const trCategory = strip(row.category)
    const txId = strip(row.transaction_id)
    const counterparty = pickCounterparty(row)
    const purpose = pickPurpose(row)

    const id = txId
      ? `tr_${accountId}_${txId}`
      : `tr_${accountId}_${date}_${amount.toFixed(2)}_${counterparty}`.replace(
          /\s+/g,
          '_',
        )

    const mapped = mapTradeRepublicType(type, trCategory)
    const draft: Transaction = {
      id,
      accountId,
      date,
      valueDate: date,
      status: 'Gebucht',
      counterparty,
      purpose,
      type: type || trCategory || 'TradeRepublic',
      iban: strip(row.counterparty_iban),
      amount,
      categoryId: mapped,
      origin: 'bank',
      categoryOverride: mapped !== 'uncategorized',
      importedAt: now,
    }

    // Card / payment rows: allow keyword rules to refine
    if (mapped === 'uncategorized') {
      draft.categoryOverride = false
      draft.categoryId = categorizeTransaction(draft, rules)
      if (draft.categoryId !== 'uncategorized') {
        // keep as rule-based, not hard override
        draft.categoryOverride = false
      }
    }

    transactions.push(draft)
  }

  return transactions
}

export function suggestTradeRepublicAccountName(
  accountType?: string | null,
): string {
  const t = (accountType || 'DEFAULT').trim()
  if (/card/i.test(t)) return 'Trade Republic Card'
  return 'Trade Republic'
}
