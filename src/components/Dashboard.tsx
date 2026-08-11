import { useMemo, useState } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts'
import type { Account, CategoryId, Transaction } from '../lib/types'
import type { MonthSummary } from '../lib/analytics'
import {
  filterByMonth,
  filterTransactions,
  pickTopExpenses,
  pickTopIncome,
  type FlowFilter,
} from '../lib/analytics'
import { transactionFlow } from '../lib/categorize'
import { CategorySelect } from './CategorySelect'
import { useLocale } from '../hooks/useLocale'

export const MONTH_TX_LIST_ID = 'month-transactions'

interface Props {
  months: string[]
  selectedMonth: string
  onSelectMonth: (month: string) => void
  summary: MonthSummary | null
  transactions: Transaction[]
  accounts: Account[]
  onUpdateCategory: (
    transactionId: string,
    categoryId: CategoryId,
    createMerchantRule?: boolean,
  ) => void
}

export function Dashboard({
  months,
  selectedMonth,
  onSelectMonth,
  summary,
  transactions,
  accounts,
  onUpdateCategory,
}: Props) {
  const {
    t,
    categories,
    categoryLabel,
    formatMonthLabel,
    formatEur,
  } = useLocale()
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryId | 'all'>('all')
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('all')

  const monthTx = useMemo(
    () => (selectedMonth ? filterByMonth(transactions, selectedMonth) : []),
    [transactions, selectedMonth],
  )

  const filtered = useMemo(
    () =>
      filterTransactions(monthTx, {
        query,
        categoryId: categoryFilter,
        flow: flowFilter,
        accounts,
      }),
    [monthTx, query, categoryFilter, flowFilter, accounts],
  )

  const topExpenses = useMemo(() => pickTopExpenses(filtered), [filtered])
  const topIncome = useMemo(() => pickTopIncome(filtered), [filtered])

  const flowCounts = useMemo(() => {
    let expense = 0
    let income = 0
    let transfer = 0
    for (const tx of monthTx) {
      const f = transactionFlow(tx)
      if (f === 'expense') expense++
      else if (f === 'income') income++
      else transfer++
    }
    return { expense, income, transfer }
  }, [monthTx])

  const filtersActive =
    query.trim() !== '' || categoryFilter !== 'all' || flowFilter !== 'all'

  const expenseCats = categories.filter(
    (c) =>
      !c.isIncome &&
      !c.excludeFromTotals &&
      c.id !== 'uncategorized' &&
      c.id !== 'other',
  )
  const incomeCats = categories.filter((c) => c.isIncome)
  const excludedCats = categories.filter((c) => c.excludeFromTotals)
  const otherCats = categories.filter(
    (c) => c.id === 'uncategorized' || c.id === 'other',
  )

  if (!months.length) {
    return (
      <section className="card">
        <h2>{t('dashboard.title')}</h2>
        <p className="muted">{t('dashboard.empty')}</p>
      </section>
    )
  }

  const expenseChart =
    summary?.byCategory
      .filter((c) => c.total < 0)
      .map((c) => ({
        name: categoryLabel(c.categoryId),
        value: Math.abs(c.total),
        color: c.color,
      })) ?? []

  const incomeChart =
    summary?.byIncomeCategory
      .filter((c) => c.total > 0)
      .map((c) => ({
        name: categoryLabel(c.categoryId),
        value: c.total,
        color: c.color,
      })) ?? []

  return (
    <section className="card">
      <div className="card-header">
        <h2>{t('dashboard.title')}</h2>
        <select
          value={selectedMonth}
          onChange={(e) => onSelectMonth(e.target.value)}
          aria-label={t('trends.selectMonth')}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonthLabel(m)}
            </option>
          ))}
        </select>
      </div>

      {summary && (
        <>
          <div className="stats-row">
            <div className="stat stat-income">
              <span className="stat-label">
                {t('dashboard.income')}
                <span className="muted small">
                  {' '}
                  {t('dashboard.bookings', { count: summary.incomeCount })}
                </span>
              </span>
              <span className="stat-value income">
                {formatEur(summary.income)}
              </span>
            </div>
            <div className="stat stat-expense">
              <span className="stat-label">
                {t('dashboard.expenses')}
                <span className="muted small">
                  {' '}
                  {t('dashboard.bookings', { count: summary.expenseCount })}
                </span>
              </span>
              <span className="stat-value expense">
                {formatEur(summary.expenses)}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">{t('dashboard.net')}</span>
              <span
                className={`stat-value ${summary.net >= 0 ? 'income' : 'expense'}`}
              >
                {formatEur(summary.net)}
              </span>
            </div>
            <button
              type="button"
              className="stat stat-button"
              onClick={() => {
                document
                  .getElementById(MONTH_TX_LIST_ID)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              title={t('dashboard.jumpTitle')}
            >
              <span className="stat-label">{t('dashboard.allTx')}</span>
              <span className="stat-value">{summary.transactionCount}</span>
              <span className="stat-hint muted small">
                {t('dashboard.jumpHint')}
              </span>
            </button>
          </div>

          <div className="flow-tabs">
            {(
              [
                ['all', t('flow.all', { count: monthTx.length })],
                ['expense', t('flow.expenses', { count: flowCounts.expense })],
                ['income', t('flow.incomes', { count: flowCounts.income })],
                ['transfer', t('flow.excluded', { count: flowCounts.transfer })],
              ] as const
            ).map(([tabId, label]) => (
              <button
                key={tabId}
                type="button"
                className={`flow-tab ${flowFilter === tabId ? 'active' : ''} ${tabId !== 'all' ? tabId : ''}`}
                onClick={() => setFlowFilter(tabId)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="toolbar">
            <input
              type="search"
              placeholder={t('tx.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="search"
            />
            <select
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value as CategoryId | 'all')
              }
            >
              <option value="all">{t('tx.allCategories')}</option>
              <optgroup label={t('catGroup.expenses')}>
                {expenseCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('catGroup.income')}>
                {incomeCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('catGroup.excluded')}>
                {excludedCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('catGroup.other')}>
                {otherCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="dashboard-grid">
            <div className="chart-wrap">
              <h3>
                <span className="flow-badge expense">{t('flow.expense')}</span>{' '}
                {t('dashboard.expensesByCat')}
              </h3>
              {expenseChart.length === 0 ? (
                <p className="muted">{t('dashboard.noExpenses')}</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={expenseChart}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {expenseChart.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) =>
                        formatEur(
                          typeof value === 'number' ? value : Number(value),
                        )
                      }
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="chart-wrap">
              <h3>
                <span className="flow-badge income">{t('flow.income')}</span>{' '}
                {t('dashboard.incomeByCat')}
              </h3>
              {incomeChart.length === 0 ? (
                <p className="muted">{t('dashboard.noIncome')}</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={incomeChart}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {incomeChart.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) =>
                        formatEur(
                          typeof value === 'number' ? value : Number(value),
                        )
                      }
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="dashboard-grid" style={{ marginTop: '1rem' }}>
            <div>
              <h3>
                {t('dashboard.biggestExpenses')}
                {filtersActive && (
                  <span className="muted small">
                    {' '}
                    {t('dashboard.filtered')}
                  </span>
                )}
              </h3>
              <ul className="top-list">
                {topExpenses.map((tx) => (
                  <TopListItem
                    key={tx.id}
                    tx={tx}
                    kind="expense"
                    onUpdateCategory={onUpdateCategory}
                    formatEur={formatEur}
                    t={t}
                  />
                ))}
                {topExpenses.length === 0 && (
                  <li className="muted">
                    {filtersActive
                      ? t('dashboard.noExpensesFiltered')
                      : t('dashboard.noExpensesShort')}
                  </li>
                )}
              </ul>
            </div>
            <div>
              <h3>
                {t('dashboard.topIncome')}
                {filtersActive && (
                  <span className="muted small">
                    {' '}
                    {t('dashboard.filtered')}
                  </span>
                )}
              </h3>
              <ul className="top-list">
                {topIncome.map((tx) => (
                  <TopListItem
                    key={tx.id}
                    tx={tx}
                    kind="income"
                    onUpdateCategory={onUpdateCategory}
                    formatEur={formatEur}
                    t={t}
                  />
                ))}
                {topIncome.length === 0 && (
                  <li className="muted">
                    {filtersActive
                      ? t('dashboard.noIncomeFiltered')
                      : t('dashboard.noIncomeShort')}
                  </li>
                )}
              </ul>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function TopListItem({
  tx,
  kind,
  onUpdateCategory,
  formatEur,
  t,
}: {
  tx: Transaction
  kind: 'expense' | 'income'
  onUpdateCategory: Props['onUpdateCategory']
  formatEur: (n: number) => string
  t: (
    key: 'tx.categoryAria' | 'tx.transaction',
    params?: Record<string, string | number>,
  ) => string
}) {
  return (
    <li>
      <div className="top-list-main">
        <div className="top-list-row">
          <strong>{tx.counterparty || '—'}</strong>
          <span className={kind}>{formatEur(tx.amount)}</span>
        </div>
        <div className="muted small truncate">{tx.purpose}</div>
        <CategorySelect
          value={tx.categoryId}
          counterparty={tx.counterparty}
          ariaLabel={t('tx.categoryAria', {
            name: tx.counterparty || t('tx.transaction'),
          })}
          onChange={(categoryId, createMerchantRule) =>
            onUpdateCategory(tx.id, categoryId, createMerchantRule)
          }
        />
      </div>
    </li>
  )
}
