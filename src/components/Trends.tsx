import { useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LabelList,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
} from 'recharts'
import type { MouseHandlerDataParam } from 'recharts'
import { parseISO, format } from 'date-fns'
import type { Account, CategoryId, Transaction } from '../lib/types'
import {
  buildCategoryTrendData,
  buildTrendData,
  filterByMonth,
  selectableMonths,
  summarizeMonth,
  transactionsForCategory,
} from '../lib/analytics'
import { getCategoryMap } from '../lib/categories'
import { transactionFlow } from '../lib/categorize'
import { Dashboard, MONTH_TX_LIST_ID } from './Dashboard'
import { ManualExpenses } from './ManualExpenses'
import { TransactionTable } from './TransactionTable'
import { CategoryIcon } from './CategoryIcon'
import type { ManualExpenseInput } from '../lib/store'
import { useLocale } from '../hooks/useLocale'
import type { TranslateFn } from '../lib/i18n'

interface Props {
  transactions: Transaction[]
  accounts: Account[]
  selectedMonth: string
  onSelectMonth: (month: string) => void
  onAddManual: (input: ManualExpenseInput) => void
  onDeleteManual: (transactionId: string) => void
  onUpdateCategory: (
    transactionId: string,
    categoryId: CategoryId,
    createMerchantRule?: boolean,
  ) => void
}

function monthFromChartClick(
  state: MouseHandlerDataParam,
  data: { month: string; label: string }[],
): string | null {
  const raw = state.activeTooltipIndex ?? state.activeIndex
  const index = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(index) || index < 0 || index >= data.length) {
    if (typeof state.activeLabel === 'string') {
      const hit = data.find((d) => d.label === state.activeLabel)
      return hit?.month ?? null
    }
    return null
  }
  return data[index]?.month ?? null
}

interface TooltipEntry {
  name?: string
  value?: number | string
  color?: string
  dataKey?: string | number
}

function TrendTooltip({
  active,
  payload,
  label,
  t,
  formatEur,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string
  t: TranslateFn
  formatEur: (n: number) => string
}) {
  if (!active || !payload?.length) return null
  const rows = payload.filter(
    (p) => p.dataKey !== 'trend' && Number(p.value) > 0,
  )
  const total = rows.reduce((sum, p) => sum + Number(p.value ?? 0), 0)
  const trend = payload.find((p) => p.dataKey === 'trend')
  const pointAvg = (
    payload[0] as { payload?: { average?: number } } | undefined
  )?.payload?.average
  return (
    <div className="trend-tooltip">
      <strong>{label}</strong>
      <ul>
        {rows.map((p) => (
          <li key={String(p.dataKey ?? p.name)}>
            {typeof p.dataKey === 'string' && p.dataKey in getCategoryMap() ? (
              <CategoryIcon
                categoryId={p.dataKey as CategoryId}
                badge
                size={11}
              />
            ) : (
              <span className="cat-dot" style={{ background: p.color }} />
            )}
            {p.name}: {formatEur(Number(p.value))}
          </li>
        ))}
      </ul>
      {rows.length > 1 && (
        <div className="trend-tooltip-total">
          {t('trends.tooltip.total', { amount: formatEur(total) })}
        </div>
      )}
      {trend && (
        <div className="muted small">
          {t('trends.tooltip.trend', {
            amount: formatEur(Number(trend.value)),
          })}
        </div>
      )}
      {typeof pointAvg === 'number' && (
        <div className="muted small">
          {t('trends.tooltip.average', { amount: formatEur(pointAvg) })}
        </div>
      )}
      <div className="muted small">{t('trends.tooltip.click')}</div>
    </div>
  )
}

export function Trends({
  transactions,
  accounts,
  selectedMonth,
  onSelectMonth,
  onAddManual,
  onDeleteManual,
  onUpdateCategory,
}: Props) {
  const {
    t,
    categories,
    categoryLabel,
    formatMonthLabel,
    formatChartMonth,
    formatEur,
    formatCompactEur,
  } = useLocale()
  const [categoryFilter, setCategoryFilter] = useState<CategoryId | 'all'>(
    'all',
  )
  const [listScope, setListScope] = useState<'month' | 'all'>('all')

  const months = useMemo(
    () => selectableMonths(transactions, 6),
    [transactions],
  )
  const stacked = useMemo(
    () => buildTrendData(transactions, 6, formatChartMonth),
    [transactions, formatChartMonth],
  )
  const categoryTrend = useMemo(
    () =>
      categoryFilter === 'all'
        ? null
        : buildCategoryTrendData(
            transactions,
            categoryFilter,
            6,
            formatChartMonth,
          ),
    [transactions, categoryFilter, formatChartMonth],
  )

  const summary = useMemo(
    () =>
      selectedMonth ? summarizeMonth(transactions, selectedMonth) : null,
    [transactions, selectedMonth],
  )

  const monthTx = useMemo(
    () => (selectedMonth ? filterByMonth(transactions, selectedMonth) : []),
    [transactions, selectedMonth],
  )

  const categoryOptions = useMemo(() => {
    const used = new Set(stacked.categoryIds)
    for (const tx of transactions) {
      if (transactionFlow(tx) === 'expense') used.add(tx.categoryId)
    }
    return categories.filter(
      (c) =>
        used.has(c.id) &&
        !c.isIncome &&
        !c.excludeFromTotals &&
        c.id !== 'uncategorized',
    )
  }, [stacked.categoryIds, transactions, categories])

  const categoryTxs = useMemo(() => {
    if (categoryFilter === 'all') return []
    return transactionsForCategory(
      transactions,
      categoryFilter,
      listScope === 'month' ? selectedMonth || undefined : undefined,
      'expense',
    )
  }, [transactions, categoryFilter, listScope, selectedMonth])

  const categoryMonthSpend = useMemo(() => {
    if (categoryFilter === 'all') return null
    const monthRows = transactions.filter(
      (tx) =>
        tx.categoryId === categoryFilter &&
        transactionFlow(tx) === 'expense' &&
        (!selectedMonth || tx.date.startsWith(selectedMonth)),
    )
    return Math.round(
      monthRows.reduce((s, tx) => s + Math.abs(tx.amount), 0) * 100,
    ) / 100
  }, [categoryFilter, transactions, selectedMonth])

  if (stacked.data.length === 0 && !categoryTrend?.data.length) {
    return (
      <>
        <section className="card">
          <h2>{t('trends.overview')}</h2>
          <p className="muted">{t('trends.empty')}</p>
        </section>
        {selectedMonth && (
          <ManualExpenses month={selectedMonth} onAdd={onAddManual} />
        )}
      </>
    )
  }

  const selectedCatLabel =
    categoryFilter === 'all' ? null : categoryLabel(categoryFilter)
  const selectedCatColor =
    categoryFilter === 'all'
      ? null
      : (getCategoryMap()[categoryFilter]?.color ?? '#999')

  const chartLegend = (
    <Legend
      position="right"
      layout="vertical"
      wrapperStyle={{ paddingLeft: 12, fontSize: 12, zIndex: 1 }}
    />
  )

  const chartTooltip = (
    <Tooltip
      content={<TrendTooltip t={t} formatEur={formatEur} />}
      wrapperStyle={{ zIndex: 1000, outline: 'none' }}
      allowEscapeViewBox={{ x: true, y: true }}
    />
  )

  return (
    <>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>{t('trends.title')}</h2>
            <p className="muted" style={{ margin: '0.25rem 0 0' }}>
              {categoryFilter === 'all'
                ? t('trends.hintAll')
                : t('trends.hintCategory', {
                    category: selectedCatLabel ?? '',
                  })}
            </p>
          </div>
          <div className="toolbar" style={{ margin: 0 }}>
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
            <div className="cat-filter">
              {categoryFilter !== 'all' && (
                <CategoryIcon categoryId={categoryFilter} badge size={13} />
              )}
              <select
                value={categoryFilter}
                onChange={(e) =>
                  setCategoryFilter(e.target.value as CategoryId | 'all')
                }
                aria-label={t('trends.filterCategory')}
              >
                <option value="all">{t('trends.allExpenseCategories')}</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {categoryFilter === 'all' ? (
          <ResponsiveContainer width="100%" height={380}>
            <BarChart
              data={stacked.data}
              margin={{ top: 24, right: 16, left: 8, bottom: 8 }}
              style={{ cursor: 'pointer' }}
              onClick={(state) => {
                const month = monthFromChartClick(state, stacked.data)
                if (month) onSelectMonth(month)
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(v: number) => formatCompactEur(v)}
              />
              {chartTooltip}
              {chartLegend}
              {stacked.categoryIds.map((id, index) => (
                <Bar
                  key={id}
                  dataKey={id}
                  name={categoryLabel(id)}
                  stackId="spend"
                  fill={getCategoryMap()[id]?.color ?? '#999'}
                  cursor="pointer"
                  onClick={(item, barIndex) => {
                    const month =
                      (item?.payload as { month?: string } | undefined)?.month ??
                      stacked.data[barIndex]?.month
                    if (typeof month === 'string') onSelectMonth(month)
                  }}
                >
                  {stacked.data.map((entry) => (
                    <Cell
                      key={`${id}-${entry.month}`}
                      fill={getCategoryMap()[id]?.color ?? '#999'}
                      fillOpacity={
                        !selectedMonth || entry.month === selectedMonth
                          ? 1
                          : 0.35
                      }
                    />
                  ))}
                  {index === stacked.categoryIds.length - 1 && (
                    <LabelList
                      dataKey="total"
                      position="top"
                      formatter={(value) => {
                        const n = Number(value)
                        return n > 0 ? formatCompactEur(n) : ''
                      }}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        fill: '#374151',
                      }}
                    />
                  )}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <>
            <div className="stats-row">
              <div className="stat">
                <span className="stat-label">
                  {selectedMonth
                    ? formatMonthLabel(selectedMonth)
                    : t('trends.selectedMonth')}
                </span>
                <span className="stat-value expense">
                  {formatEur(categoryMonthSpend ?? 0)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t('trends.sixMonthAvg')}</span>
                <span className="stat-value">
                  {formatEur(categoryTrend?.average ?? 0)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t('trends.txShown')}</span>
                <span className="stat-value">{categoryTxs.length}</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart
                data={categoryTrend?.data ?? []}
                margin={{ top: 24, right: 16, left: 8, bottom: 8 }}
                style={{ cursor: 'pointer' }}
                onClick={(state) => {
                  const month = monthFromChartClick(
                    state,
                    categoryTrend?.data ?? [],
                  )
                  if (month) onSelectMonth(month)
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v: number) => formatCompactEur(v)}
                />
                {chartTooltip}
                {chartLegend}
                <ReferenceLine
                  y={categoryTrend?.average ?? 0}
                  stroke="#6b7280"
                  strokeDasharray="6 4"
                  label={{
                    value: t('trends.avg', {
                      amount: formatEur(categoryTrend?.average ?? 0),
                    }),
                    position: 'insideTopRight',
                    fill: '#6b7280',
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="amount"
                  name={selectedCatLabel ?? t('trends.spend')}
                  fill={selectedCatColor ?? '#999'}
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(item, barIndex) => {
                    const month =
                      (item?.payload as { month?: string } | undefined)?.month ??
                      categoryTrend?.data[barIndex]?.month
                    if (typeof month === 'string') onSelectMonth(month)
                  }}
                >
                  {(categoryTrend?.data ?? []).map((entry) => (
                    <Cell
                      key={entry.month}
                      fill={selectedCatColor ?? '#999'}
                      fillOpacity={
                        !selectedMonth || entry.month === selectedMonth
                          ? 1
                          : 0.35
                      }
                    />
                  ))}
                  <LabelList
                    dataKey="amount"
                    position="top"
                    formatter={(value) => {
                      const n = Number(value)
                      return n > 0 ? formatCompactEur(n) : ''
                    }}
                    style={{ fontSize: 12, fontWeight: 600, fill: '#374151' }}
                  />
                </Bar>
                <Line
                  type="linear"
                  dataKey="trend"
                  name={t('trends.trend')}
                  stroke="#111827"
                  strokeWidth={2}
                  dot={false}
                  legendType="line"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </>
        )}
      </section>

      {categoryFilter !== 'all' && (
        <section className="card">
          <div className="card-header">
            <h2>
              {t('trends.categoryTx', { category: selectedCatLabel ?? '' })}
              <span className="muted small" style={{ marginLeft: '0.5rem' }}>
                ({categoryTxs.length})
              </span>
            </h2>
            <div className="toolbar" style={{ margin: 0 }}>
              <select
                value={listScope}
                onChange={(e) =>
                  setListScope(e.target.value as 'month' | 'all')
                }
                aria-label={t('trends.listScope')}
              >
                <option value="all">{t('trends.allMonths')}</option>
                <option value="month">
                  {t('trends.monthOnly', {
                    month: selectedMonth
                      ? formatMonthLabel(selectedMonth)
                      : t('trends.selectedMonth'),
                  })}
                </option>
              </select>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('tx.col.date')}</th>
                  <th>{t('tx.col.counterparty')}</th>
                  <th>{t('tx.col.purpose')}</th>
                  <th className="num">{t('tx.col.amount')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {categoryTxs.map((tx) => (
                  <CategoryTxRow
                    key={tx.id}
                    tx={tx}
                    onDeleteManual={
                      tx.origin === 'manual' ? onDeleteManual : undefined
                    }
                    formatEur={formatEur}
                    deleteLabel={t('tx.delete')}
                  />
                ))}
                {categoryTxs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      {t('trends.noCategoryTx')}
                      {listScope === 'month' && selectedMonth
                        ? t('trends.forMonth', {
                            month: formatMonthLabel(selectedMonth),
                          })
                        : ''}
                      .
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {categoryFilter === 'all' && (
        <Dashboard
          months={months}
          selectedMonth={selectedMonth}
          onSelectMonth={onSelectMonth}
          summary={summary}
          transactions={transactions}
          accounts={accounts}
          onUpdateCategory={onUpdateCategory}
        />
      )}

      {selectedMonth && (
        <ManualExpenses month={selectedMonth} onAdd={onAddManual} />
      )}

      {categoryFilter === 'all' && selectedMonth && (
        <TransactionTable
          id={MONTH_TX_LIST_ID}
          title={t('trends.monthTx', {
            month: formatMonthLabel(selectedMonth),
          })}
          transactions={monthTx}
          accounts={accounts}
          onUpdateCategory={onUpdateCategory}
          onDeleteManual={onDeleteManual}
        />
      )}

      {categoryFilter !== 'all' && (
        <section className="card">
          <div className="card-header">
            <h2>{t('trends.selectedMonth')}</h2>
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
          <p className="muted" style={{ margin: 0 }}>
            {selectedCatLabel}{' '}
            {selectedMonth ? formatMonthLabel(selectedMonth) : '—'}:{' '}
            <strong className="expense">
              {formatEur(categoryMonthSpend ?? 0)}
            </strong>
          </p>
        </section>
      )}
    </>
  )
}

function CategoryTxRow({
  tx,
  onDeleteManual,
  formatEur,
  deleteLabel,
}: {
  tx: Transaction
  onDeleteManual?: (transactionId: string) => void
  formatEur: (n: number) => string
  deleteLabel: string
}) {
  return (
    <tr>
      <td className="nowrap">{format(parseISO(tx.date), 'dd.MM.yyyy')}</td>
      <td>
        <div className="merchant">{tx.counterparty || '—'}</div>
      </td>
      <td>
        <div className="purpose truncate" title={tx.purpose}>
          {tx.purpose || '—'}
        </div>
      </td>
      <td className={`num nowrap ${tx.amount < 0 ? 'expense' : 'income'}`}>
        {formatEur(tx.amount)}
      </td>
      <td>
        {onDeleteManual && (
          <button
            type="button"
            className="linkish"
            onClick={() => onDeleteManual(tx.id)}
          >
            {deleteLabel}
          </button>
        )}
      </td>
    </tr>
  )
}
