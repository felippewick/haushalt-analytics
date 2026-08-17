import { useMemo } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts'
import type { CategoryId, Transaction } from '../lib/types'
import type { MonthSummary } from '../lib/analytics'
import {
  filterByMonth,
  pickTopExpenses,
  pickTopIncome,
} from '../lib/analytics'
import { CategorySelect } from './CategorySelect'
import { MonthNav } from './MonthNav'
import { useLocale } from '../hooks/useLocale'
import { CHART_THEMES, useTheme } from '../hooks/useTheme'

export const MONTH_TX_LIST_ID = 'month-transactions'

interface Props {
  months: string[]
  selectedMonth: string
  onSelectMonth: (month: string) => void
  summary: MonthSummary | null
  transactions: Transaction[]
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
  onUpdateCategory,
}: Props) {
  const { t, categoryLabel, formatEur } = useLocale()
  const { resolved } = useTheme()
  const chart = CHART_THEMES[resolved]
  const pieTooltipStyle = {
    background: chart.tooltipBg,
    border: `1px solid ${chart.tooltipBorder}`,
    borderRadius: 8,
    fontSize: 12,
    color: chart.tooltipText,
  }
  const pieLegendProps = {
    layout: 'vertical' as const,
    align: 'right' as const,
    verticalAlign: 'middle' as const,
    iconType: 'circle' as const,
    iconSize: 8,
    wrapperStyle: {
      fontSize: 12,
      color: chart.legend,
      lineHeight: '20px',
      maxHeight: 220,
      overflow: 'auto',
    },
  }
  const monthTx = useMemo(
    () => (selectedMonth ? filterByMonth(transactions, selectedMonth) : []),
    [transactions, selectedMonth],
  )

  const topExpenses = useMemo(() => pickTopExpenses(monthTx), [monthTx])
  const topIncome = useMemo(() => pickTopIncome(monthTx), [monthTx])

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
      <div className="card-header card-header--month">
        <h2>{t('dashboard.title')}</h2>
        <MonthNav
          months={months}
          selectedMonth={selectedMonth}
          onSelectMonth={onSelectMonth}
        />
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
                  <PieChart accessibilityLayer={false}>
                    <Pie
                      data={expenseChart}
                      dataKey="value"
                      nameKey="name"
                      cx="38%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={2}
                      rootTabIndex={-1}
                    >
                      {expenseChart.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={entry.color}
                          stroke={chart.pieStroke}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) =>
                        formatEur(
                          typeof value === 'number' ? value : Number(value),
                        )
                      }
                      contentStyle={pieTooltipStyle}
                      itemStyle={{ color: chart.tooltipText }}
                    />
                    <Legend {...pieLegendProps} />
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
                  <PieChart accessibilityLayer={false}>
                    <Pie
                      data={incomeChart}
                      dataKey="value"
                      nameKey="name"
                      cx="38%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={2}
                      rootTabIndex={-1}
                    >
                      {incomeChart.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={entry.color}
                          stroke={chart.pieStroke}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) =>
                        formatEur(
                          typeof value === 'number' ? value : Number(value),
                        )
                      }
                      contentStyle={pieTooltipStyle}
                      itemStyle={{ color: chart.tooltipText }}
                    />
                    <Legend {...pieLegendProps} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="dashboard-grid" style={{ marginTop: '1rem' }}>
            <div>
              <h3>{t('dashboard.biggestExpenses')}</h3>
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
                  <li className="muted">{t('dashboard.noExpensesShort')}</li>
                )}
              </ul>
            </div>
            <div>
              <h3>{t('dashboard.topIncome')}</h3>
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
                  <li className="muted">{t('dashboard.noIncomeShort')}</li>
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
          amount={tx.amount}
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
