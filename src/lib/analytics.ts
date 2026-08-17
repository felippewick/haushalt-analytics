import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  isWithinInterval,
  subMonths,
  addMonths,
} from 'date-fns'
import type { Account, CategoryId, Transaction } from './types'
import { getCategories, getCategoryMap } from './categories'
import {
  countsTowardTotals,
  transactionFlow,
  type TransactionFlow,
} from './categorize'
import {
  accountLabel,
  accountOptionLabel,
  MANUAL_ACCOUNT_ID,
} from './store'

export interface MonthRange {
  from: string
  to: string
}

export type FlowFilter = 'all' | TransactionFlow

export type CategoryFilterValue = CategoryId[] | 'all'

export interface TransactionFilterOptions {
  query?: string
  categoryIds?: CategoryFilterValue
  flow?: FlowFilter
  /** Used so search can match account display names. */
  accounts?: Account[]
}

export function matchesCategoryFilter(
  categoryId: CategoryId,
  filter: CategoryFilterValue = 'all',
): boolean {
  if (filter === 'all') return true
  return filter.includes(categoryId)
}

function accountSearchText(accounts: Account[], accountId: string): string {
  const account = accounts.find((a) => a.id === accountId)
  if (!account) return accountId
  return `${accountOptionLabel(account)} ${accountLabel(accounts, accountId)}`
}

/** Filter by category, flow, and free-text search (merchant, purpose, IBAN, account, amount). */
export function filterTransactions(
  transactions: Transaction[],
  {
    query = '',
    categoryIds = 'all',
    flow = 'all',
    accounts = [],
  }: TransactionFilterOptions = {},
): Transaction[] {
  const q = query.trim().toLowerCase()
  return transactions.filter((t) => {
    if (!matchesCategoryFilter(t.categoryId, categoryIds)) return false
    if (flow !== 'all' && transactionFlow(t) !== flow) return false
    if (!q) return true
    const accName = accountSearchText(accounts, t.accountId).toLowerCase()
    return (
      t.counterparty.toLowerCase().includes(q) ||
      t.purpose.toLowerCase().includes(q) ||
      t.iban.toLowerCase().includes(q) ||
      accName.includes(q) ||
      amountMatchesSearch(t.amount, q)
    )
  })
}

export function pickTopExpenses(
  transactions: Transaction[],
  limit = 10,
): Transaction[] {
  return transactions
    .filter(
      (t) =>
        countsTowardTotals(t.categoryId) && transactionFlow(t) === 'expense',
    )
    .sort((a, b) => a.amount - b.amount)
    .slice(0, limit)
}

export function pickTopIncome(
  transactions: Transaction[],
  limit = 10,
): Transaction[] {
  return transactions
    .filter(
      (t) =>
        countsTowardTotals(t.categoryId) && transactionFlow(t) === 'income',
    )
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
}

export function monthKey(dateIso: string): string {
  return dateIso.slice(0, 7)
}

export function formatMonthLabel(yyyyMm: string): string {
  const d = parseISO(`${yyyyMm}-01`)
  return format(d, 'MMMM yyyy')
}

export function formatEur(amount: number, locale = 'de-DE'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
  }).format(amount)
}

/**
 * Parse a search amount that may use `,` / `.` as thousand or decimal separators.
 * `1100`, `1.100`, and `1,100` all resolve to 1100; `12,34` / `12.34` → 12.34.
 */
export function parseSearchAmount(raw: string): number | null {
  let s = raw.trim().replace(/\s/g, '').replace(/€/g, '')
  if (!s) return null
  const negative = s.startsWith('-')
  if (negative) s = s.slice(1)
  if (!/^[\d.,]+$/.test(s)) return null

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')

  if (hasComma && hasDot) {
    // Last separator is the decimal: 1.100,50 or 1,100.50
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (hasComma || hasDot) {
    const sep = hasComma ? ',' : '.'
    const parts = s.split(sep)
    if (parts.length === 2) {
      const frac = parts[1]!
      // Exactly 3 digits after a single separator → thousand grouping (1.100 / 1,100)
      if (frac.length === 3) {
        s = parts[0]! + frac
      } else {
        // 1–2 (or other) fraction digits → decimal (12,34 / 12.34)
        s = `${parts[0]!}.${frac}`
      }
    } else {
      // Multiple grouping separators: 1.100.000
      s = parts.join('')
    }
  }

  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

/** True when the search query looks like an amount (digits + optional separators). */
export function looksLikeAmountQuery(q: string): boolean {
  const s = q.trim()
  return /^-?[\d\s.,€]+$/.test(s) && /\d/.test(s)
}

/** Match transaction amount against a search query, ignoring comma/dot/no separator. */
export function amountMatchesSearch(amount: number, q: string): boolean {
  if (!looksLikeAmountQuery(q)) return false
  const parsed = parseSearchAmount(q)
  if (parsed === null) return false
  return Math.abs(Math.abs(amount) - Math.abs(parsed)) < 0.005
}

export function availableMonths(transactions: Transaction[]): string[] {
  const set = new Set(transactions.map((t) => monthKey(t.date)))
  return [...set].sort().reverse()
}

export function compareMonths(a: string, b: string): number {
  return a.localeCompare(b)
}

/** Contiguous ascending YYYY-MM months from `from` through `to` inclusive. */
export function monthsInRange(from: string, to: string): string[] {
  if (compareMonths(from, to) > 0) return []
  const months: string[] = []
  let cur = parseISO(`${from}-01`)
  const end = parseISO(`${to}-01`)
  while (cur <= end) {
    months.push(format(cur, 'yyyy-MM'))
    cur = addMonths(cur, 1)
  }
  return months
}

/** Earliest and latest month keys present in the transactions (by booking date). */
export function dataMonthSpan(
  transactions: Transaction[],
): MonthRange | null {
  const months = availableMonths(transactions)
  if (months.length === 0) return null
  return { from: months[months.length - 1]!, to: months[0]! }
}

export function rangesOverlap(a: MonthRange, b: MonthRange): boolean {
  return (
    compareMonths(a.from, b.to) <= 0 && compareMonths(b.from, a.to) <= 0
  )
}

/**
 * Default chart window ending at the latest data month:
 * last 12 months if history spans ≥12, else 9, else 6, else the full span.
 */
export function defaultMonthRange(
  transactions: Transaction[],
): MonthRange | null {
  const span = dataMonthSpan(transactions)
  if (!span) return null
  const spanLen = monthsInRange(span.from, span.to).length
  const window =
    spanLen >= 12 ? 12 : spanLen >= 9 ? 9 : spanLen >= 6 ? 6 : spanLen
  const from = format(
    subMonths(parseISO(`${span.to}-01`), window - 1),
    'yyyy-MM',
  )
  return {
    from: compareMonths(from, span.from) < 0 ? span.from : from,
    to: span.to,
  }
}

/** Clamp a range into the data span; swaps inverted from/to. */
export function clampRangeToData(
  range: MonthRange,
  transactions: Transaction[],
): MonthRange | null {
  const span = dataMonthSpan(transactions)
  if (!span) return null
  let from = range.from
  let to = range.to
  if (compareMonths(from, to) > 0) {
    ;[from, to] = [to, from]
  }
  if (compareMonths(from, span.from) < 0) from = span.from
  if (compareMonths(to, span.to) > 0) to = span.to
  if (compareMonths(from, to) > 0) return span
  return { from, to }
}

/** Contiguous months from data min→max, oldest first — for month pickers. */
export function selectableMonths(transactions: Transaction[]): string[] {
  const span = dataMonthSpan(transactions)
  if (!span) return []
  return monthsInRange(span.from, span.to)
}

/** Months shown in the trends chart window (always contiguous). */
export function trendWindowMonths(range: MonthRange): string[] {
  return monthsInRange(range.from, range.to)
}

export function filterByMonth(
  transactions: Transaction[],
  yyyyMm: string,
): Transaction[] {
  const start = startOfMonth(parseISO(`${yyyyMm}-01`))
  const end = endOfMonth(start)
  return transactions.filter((t) =>
    isWithinInterval(parseISO(t.date), { start, end }),
  )
}

export interface MonthCoverage {
  month: string
  hasAnyTx: boolean
  missingAccountIds: string[]
  gap: boolean
}

/**
 * Per-month account coverage inside a range.
 * Manual account is ignored; only bank accounts in `accounts` that appear in
 * `transactions` (already account-filtered) are checked.
 */
export function accountCoverageGaps(
  transactions: Transaction[],
  accounts: Account[],
  range: MonthRange,
): MonthCoverage[] {
  const bankIds = accounts
    .filter((a) => a.id !== MANUAL_ACCOUNT_ID)
    .map((a) => a.id)
  const present = new Set(
    transactions
      .filter((t) => t.origin !== 'manual')
      .map((t) => t.accountId),
  )
  const relevant = bankIds.filter((id) => present.has(id))
  const months = monthsInRange(range.from, range.to)
  if (relevant.length === 0) {
    return months.map((month) => ({
      month,
      hasAnyTx: filterByMonth(transactions, month).length > 0,
      missingAccountIds: [],
      gap: false,
    }))
  }

  const byAccountMonth = new Set<string>()
  for (const tx of transactions) {
    if (tx.origin === 'manual') continue
    if (!relevant.includes(tx.accountId)) continue
    byAccountMonth.add(`${tx.accountId}:${monthKey(tx.date)}`)
  }

  return months.map((month) => {
    const missingAccountIds = relevant.filter(
      (id) => !byAccountMonth.has(`${id}:${month}`),
    )
    const hasAnyTx = relevant.some((id) =>
      byAccountMonth.has(`${id}:${month}`),
    )
    return {
      month,
      hasAnyTx,
      missingAccountIds,
      gap: missingAccountIds.length > 0,
    }
  })
}

export interface MonthSummary {
  month: string
  income: number
  expenses: number
  net: number
  byCategory: {
    categoryId: CategoryId
    label: string
    color: string
    total: number
  }[]
  /** Income categories only (salary, investments, …) */
  byIncomeCategory: {
    categoryId: CategoryId
    label: string
    color: string
    total: number
  }[]
  topExpenses: Transaction[]
  topIncome: Transaction[]
  transactionCount: number
  expenseCount: number
  incomeCount: number
}

/**
 * Income and expenses stay gross (no per-category netting).
 * Outflows → expenses; inflows (salary, investments, …) → income.
 * Only `net` (saldo) subtracts them. Transfers / excluded categories ignored.
 * Matches the trends chart expense total for the same month.
 */
export function summarizeMonth(
  transactions: Transaction[],
  yyyyMm: string,
): MonthSummary {
  const monthTx = filterByMonth(transactions, yyyyMm)
  let income = 0
  let expenses = 0
  const catTotals = new Map<CategoryId, number>()
  const incomeTotals = new Map<CategoryId, number>()

  for (const tx of monthTx) {
    if (!countsTowardTotals(tx.categoryId)) continue

    if (tx.amount < 0) {
      expenses += -tx.amount
      const prev = catTotals.get(tx.categoryId) ?? 0
      catTotals.set(tx.categoryId, prev + tx.amount)
    } else if (tx.amount > 0) {
      income += tx.amount
      const prev = incomeTotals.get(tx.categoryId) ?? 0
      incomeTotals.set(tx.categoryId, prev + tx.amount)
    }
  }

  income = Math.round(income * 100) / 100
  expenses = Math.round(expenses * 100) / 100

  const map = getCategoryMap()
  const byCategory = [...catTotals.entries()]
    .map(([categoryId, total]) => ({
      categoryId,
      label: map[categoryId]?.label ?? categoryId,
      color: map[categoryId]?.color ?? '#999',
      total: Math.round(total * 100) / 100,
    }))
    .filter((c) => c.total !== 0)
    .sort((a, b) => a.total - b.total)

  const byIncomeCategory = [...incomeTotals.entries()]
    .map(([categoryId, total]) => ({
      categoryId,
      label: map[categoryId]?.label ?? categoryId,
      color: map[categoryId]?.color ?? '#999',
      total: Math.round(total * 100) / 100,
    }))
    .filter((c) => c.total !== 0)
    .sort((a, b) => b.total - a.total)

  const counted = monthTx.filter((t) => countsTowardTotals(t.categoryId))

  return {
    month: yyyyMm,
    income,
    expenses,
    net: Math.round((income - expenses) * 100) / 100,
    byCategory,
    byIncomeCategory,
    topExpenses: pickTopExpenses(monthTx),
    topIncome: pickTopIncome(monthTx),
    transactionCount: monthTx.length,
    expenseCount: counted.filter((t) => transactionFlow(t) === 'expense').length,
    incomeCount: counted.filter((t) => transactionFlow(t) === 'income').length,
  }
}

export interface TrendPoint {
  month: string
  label: string
  total: number
  /** 1 when at least one bank account has no txs this month */
  gap: number
  missingAccountNames: string
  [categoryId: string]: string | number
}

export function buildTrendData(
  transactions: Transaction[],
  range: MonthRange,
  formatLabel: (yyyyMm: string) => string = (m) =>
    format(parseISO(`${m}-01`), 'MMM yy'),
  coverage?: MonthCoverage[],
  accountName?: (accountId: string) => string,
  onlyCategoryIds?: CategoryId[],
): { data: TrendPoint[]; categoryIds: CategoryId[] } {
  // Trends chart is expenses-only (no income / transfers)
  const expenseTxs = transactions.filter((t) => transactionFlow(t) === 'expense')
  const months = monthsInRange(range.from, range.to)
  if (months.length === 0) return { data: [], categoryIds: [] }

  const coverageByMonth = new Map(
    (coverage ?? []).map((c) => [c.month, c]),
  )

  const map = getCategoryMap()
  const allow = onlyCategoryIds ? new Set(onlyCategoryIds) : null
  const used = new Set<CategoryId>()
  const data: TrendPoint[] = months.map((m) => {
    const monthTx = filterByMonth(expenseTxs, m)
    const catTotals = new Map<CategoryId, number>()
    for (const tx of monthTx) {
      if (allow && !allow.has(tx.categoryId)) continue
      if (!countsTowardTotals(tx.categoryId)) continue
      if (map[tx.categoryId]?.isIncome) continue
      const prev = catTotals.get(tx.categoryId) ?? 0
      // Absolute expense contribution (positive amount in chart)
      catTotals.set(tx.categoryId, prev + Math.abs(tx.amount))
    }

    let total = 0
    const cov = coverageByMonth.get(m)
    const missingIds = cov?.missingAccountIds ?? []
    const point: TrendPoint = {
      month: m,
      label: formatLabel(m),
      total: 0,
      gap: cov?.gap ? 1 : 0,
      missingAccountNames: missingIds
        .map((id) => (accountName ? accountName(id) : id))
        .join(', '),
    }
    for (const [categoryId, spent] of catTotals) {
      const rounded = Math.round(spent * 100) / 100
      if (rounded > 0) {
        point[categoryId] = rounded
        total += rounded
        used.add(categoryId)
      }
    }
    point.total = Math.round(total * 100) / 100
    return point
  })

  for (const point of data) {
    for (const id of used) {
      if (!(id in point)) point[id] = 0
    }
  }

  const categoryIds = getCategories()
    .map((c) => c.id)
    .filter(
      (id) =>
        used.has(id) &&
        !map[id]?.isIncome &&
        !map[id]?.excludeFromTotals &&
        (!allow || allow.has(id)),
    )
  // Include orphaned ids still present on transactions
  for (const id of used) {
    if (!categoryIds.includes(id)) categoryIds.push(id)
  }
  return { data, categoryIds }
}

export interface CategoryTrendPoint {
  month: string
  label: string
  amount: number
  average: number
  trend: number
  gap: number
  missingAccountNames: string
}

/** Monthly expense total for one or more categories + average and linear trend line. */
export function buildCategoryTrendData(
  transactions: Transaction[],
  categoryId: CategoryId | CategoryId[],
  range: MonthRange,
  formatLabel: (yyyyMm: string) => string = (m) =>
    format(parseISO(`${m}-01`), 'MMM yy'),
  coverage?: MonthCoverage[],
  accountName?: (accountId: string) => string,
): { data: CategoryTrendPoint[]; average: number } {
  const ids = new Set(Array.isArray(categoryId) ? categoryId : [categoryId])
  const expenseTxs = transactions.filter(
    (t) =>
      transactionFlow(t) === 'expense' && ids.has(t.categoryId),
  )
  const months = monthsInRange(range.from, range.to)
  if (months.length === 0) return { data: [], average: 0 }

  const coverageByMonth = new Map(
    (coverage ?? []).map((c) => [c.month, c]),
  )

  const amounts = months.map((m) => {
    const monthTx = filterByMonth(expenseTxs, m)
    const spent = monthTx.reduce((s, t) => s + Math.abs(t.amount), 0)
    return Math.round(spent * 100) / 100
  })

  const average =
    amounts.length === 0
      ? 0
      : Math.round(
          (amounts.reduce((s, n) => s + n, 0) / amounts.length) * 100,
        ) / 100

  const n = amounts.length
  let trendValues = amounts.map(() => average)
  if (n >= 2) {
    const xMean = (n - 1) / 2
    const yMean = average
    let num = 0
    let den = 0
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (amounts[i]! - yMean)
      den += (i - xMean) ** 2
    }
    const slope = den === 0 ? 0 : num / den
    const intercept = yMean - slope * xMean
    trendValues = amounts.map((_, i) =>
      Math.max(0, Math.round((intercept + slope * i) * 100) / 100),
    )
  }

  const data: CategoryTrendPoint[] = months.map((m, i) => {
    const cov = coverageByMonth.get(m)
    const missingIds = cov?.missingAccountIds ?? []
    return {
      month: m,
      label: formatLabel(m),
      amount: amounts[i]!,
      average,
      trend: trendValues[i]!,
      gap: cov?.gap ? 1 : 0,
      missingAccountNames: missingIds
        .map((id) => (accountName ? accountName(id) : id))
        .join(', '),
    }
  })

  return { data, average }
}

export function transactionsForCategory(
  transactions: Transaction[],
  categoryId: CategoryId | CategoryId[],
  yyyyMm?: string,
  flow: 'expense' | 'income' | 'all' = 'all',
): Transaction[] {
  const ids = new Set(Array.isArray(categoryId) ? categoryId : [categoryId])
  return transactions
    .filter((t) => {
      if (!ids.has(t.categoryId)) return false
      if (yyyyMm && monthKey(t.date) !== yyyyMm) return false
      if (flow !== 'all' && transactionFlow(t) !== flow) return false
      return true
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}
