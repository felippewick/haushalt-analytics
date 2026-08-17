import { useMemo, useRef, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
} from 'recharts'
import type { MouseHandlerDataParam } from 'recharts'
import { parseISO, format } from 'date-fns'
import type { Account, Category, CategoryId, Transaction } from '../lib/types'
import {
  accountCoverageGaps,
  buildCategoryTrendData,
  buildTrendData,
  compareMonths,
  filterByMonth,
  selectableMonths,
  summarizeMonth,
  transactionsForCategory,
  type MonthRange,
} from '../lib/analytics'
import { getCategoryMap } from '../lib/categories'
import { transactionFlow } from '../lib/categorize'
import { Dashboard, MONTH_TX_LIST_ID } from './Dashboard'
import { ManualExpenses } from './ManualExpenses'
import { TransactionTable } from './TransactionTable'
import { CategoryFilter, type CategoryFilterValue } from './CategoryFilter'
import { CategoryIcon } from './CategoryIcon'
import type { ManualExpenseInput } from '../lib/store'
import { useLocale } from '../hooks/useLocale'
import { CHART_THEMES, useTheme } from '../hooks/useTheme'
import type { TranslateFn } from '../lib/i18n'
import type { AutoCategorizePreview, LlmProgress, LlmSuggestion } from '../lib/llmCategorize'

interface Props {
  transactions: Transaction[]
  accounts: Account[]
  selectedMonth: string
  onSelectMonth: (month: string) => void
  periodRange: MonthRange
  onPeriodRangeChange: (range: MonthRange) => void
  onAddManual: (input: ManualExpenseInput) => void
  onDeleteManual: (transactionId: string) => void
  onUpdateCategory: (
    transactionId: string,
    categoryId: CategoryId,
    createMerchantRule?: boolean,
  ) => void
  onAutoCategorize?: (txs: Transaction[]) => Promise<AutoCategorizePreview>
  onApplySuggestions?: (suggestions: LlmSuggestion[]) => void
  llmBusy?: boolean
  llmProgress?: LlmProgress | null
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
  hoveredCategoryId,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string
  t: TranslateFn
  formatEur: (n: number) => string
  hoveredCategoryId?: CategoryId | null
}) {
  if (!active || !payload?.length) return null
  const rows = payload.filter(
    (p) =>
      p.dataKey !== 'trend' &&
      p.dataKey !== 'total' &&
      p.dataKey !== BAR_LABEL_STACK &&
      Number(p.value) > 0,
  )
  const total = rows.reduce((sum, p) => sum + Number(p.value ?? 0), 0)
  const trend = payload.find((p) => p.dataKey === 'trend')
  const point = (
    payload[0] as
      | {
          payload?: {
            average?: number
            gap?: number
            missingAccountNames?: string
          }
        }
      | undefined
  )?.payload
  const pointAvg = point?.average
  const missing = point?.missingAccountNames
  return (
    <div
      className={`trend-tooltip${hoveredCategoryId ? ' has-hover' : ''}`}
    >
      <strong>{label}</strong>
      <ul>
        {rows.map((p) => (
          <li
            key={String(p.dataKey ?? p.name)}
            className={
              hoveredCategoryId && p.dataKey === hoveredCategoryId
                ? 'is-hovered'
                : undefined
            }
          >
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
      {point?.gap === 1 && missing && (
        <div className="trend-tooltip-gap">
          {t('trends.tooltip.missingAccounts', { accounts: missing })}
        </div>
      )}
      <div className="muted small">{t('trends.tooltip.click')}</div>
      <div className="muted small">{t('trends.tooltip.dblclick')}</div>
    </div>
  )
}

/** Tiny stack slice so sum labels sit on top of the bar, not in a grouped column. */
const BAR_LABEL_STACK = '__barLabel'

function barCenterX(x?: number | string, width?: number | string) {
  return Number(x ?? 0) + Number(width ?? 0) / 2
}

function barSumLabel(
  formatCompactEur: (n: number) => string,
  fill: string,
  props: {
    x?: unknown
    y?: unknown
    width?: unknown
    value?: unknown
  },
) {
  const n = Number(props.value)
  if (!(n > 0)) return null
  return (
    <text
      x={barCenterX(
        props.x as number | string | undefined,
        props.width as number | string | undefined,
      )}
      y={Number(props.y ?? 0) - 6}
      textAnchor="middle"
      dominantBaseline="auto"
      fontSize={12}
      fontWeight={600}
      fill={fill}
    >
      {formatCompactEur(n)}
    </text>
  )
}

function makeGapMarkerLabel(data: { gap: number }[]) {
  return function GapMarkerLabel(props: {
    x?: number | string
    y?: number | string
    width?: number | string
    index?: number
  }) {
    const entry = data[props.index ?? -1]
    if (!entry || entry.gap !== 1) return null
    const x = barCenterX(props.x, props.width)
    const y = Number(props.y ?? 0) - 4
    return (
      <g className="trend-gap-marker" aria-hidden>
        <circle cx={x} cy={y} r={3.5} fill="var(--gap-marker, #c9a227)" />
      </g>
    )
  }
}

function barOpacity(selectedMonth: string, entryMonth: string, gap: number) {
  const base = !selectedMonth || entryMonth === selectedMonth ? 1 : 0.35
  return gap === 1 ? base * 0.55 : base
}

function sliceOpacity(
  selectedMonth: string,
  entryMonth: string,
  gap: number,
  dimmed: boolean,
) {
  const base = barOpacity(selectedMonth, entryMonth, gap)
  return dimmed ? base * 0.38 : base
}

interface HoveredSlice {
  categoryId: CategoryId
  index: number
  x: number
  width: number
}

function readBarGeom(item: unknown): Pick<HoveredSlice, 'x' | 'width'> | null {
  if (!item || typeof item !== 'object') return null
  const o = item as { x?: unknown; width?: unknown }
  const x = Number(o.x)
  const width = Number(o.width)
  if (![x, width].every(Number.isFinite)) return null
  return { x, width }
}

function tooltipAnchor(slice: HoveredSlice, plotWidth: number) {
  const gap = 24
  const cardW = 228
  const legendW = plotWidth > 0 ? Math.min(160, plotWidth * 0.22) : 140
  const rightX = slice.x + slice.width + gap
  const overflowRight = plotWidth > 0 && rightX + cardW > plotWidth - legendW
  return {
    x: overflowRight ? Math.max(8, slice.x - cardW - gap) : rightX,
    y: 8,
  }
}

function TrendCategoryLegend({
  items,
  categoryFilter,
  hoveredId,
  onPick,
  labelFor,
  ariaLabel,
  showOnlyTitle,
  showAllTitle,
}: {
  items: Category[]
  categoryFilter: CategoryFilterValue
  hoveredId?: CategoryId | null
  onPick: (id: CategoryId) => void
  labelFor: (id: CategoryId) => string
  ariaLabel: string
  showOnlyTitle: (category: string) => string
  showAllTitle: string
}) {
  if (items.length === 0) return null
  const isolated =
    categoryFilter !== 'all' && categoryFilter.length === 1
      ? categoryFilter[0]
      : null
  const selected =
    categoryFilter === 'all' ? null : new Set(categoryFilter)

  return (
    <ul className="trend-legend" aria-label={ariaLabel}>
      {items.map((c) => {
        const on =
          selected === null || selected.has(c.id)
        const isIsolated = isolated === c.id
        const hovered = hoveredId === c.id
        return (
          <li key={c.id}>
            <button
              type="button"
              className={`trend-legend-item${on ? '' : ' is-off'}${
                isIsolated || hovered ? ' is-on' : ''
              }`}
              title={
                isIsolated
                  ? showAllTitle
                  : showOnlyTitle(labelFor(c.id))
              }
              onClick={() => onPick(c.id)}
            >
              <CategoryIcon categoryId={c.id} badge size={11} />
              <span>{labelFor(c.id)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function Trends({
  transactions,
  accounts,
  selectedMonth,
  onSelectMonth,
  periodRange,
  onPeriodRangeChange,
  onAddManual,
  onDeleteManual,
  onUpdateCategory,
  onAutoCategorize,
  onApplySuggestions,
  llmBusy = false,
  llmProgress = null,
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
  const { resolved } = useTheme()
  const chart = CHART_THEMES[resolved]
  const [categoryFilter, setCategoryFilter] =
    useState<CategoryFilterValue>('all')
  const [listScope, setListScope] = useState<'month' | 'all'>('all')
  const [hoveredSlice, setHoveredSlice] = useState<HoveredSlice | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const hoveredSliceRef = useRef<HoveredSlice | null>(null)
  const monthClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCategoryToggleAt = useRef(0)
  hoveredSliceRef.current = hoveredSlice

  const accountName = useMemo(() => {
    const map = new Map(accounts.map((a) => [a.id, a.name]))
    return (id: string) => map.get(id) ?? id
  }, [accounts])

  const months = useMemo(() => selectableMonths(transactions), [transactions])

  const coverage = useMemo(
    () => accountCoverageGaps(transactions, accounts, periodRange),
    [transactions, accounts, periodRange],
  )

  const stacked = useMemo(
    () =>
      buildTrendData(
        transactions,
        periodRange,
        formatChartMonth,
        coverage,
        accountName,
        categoryFilter === 'all' || categoryFilter.length === 1
          ? undefined
          : categoryFilter,
      ),
    [
      transactions,
      periodRange,
      formatChartMonth,
      coverage,
      accountName,
      categoryFilter,
    ],
  )
  const categoryTrend = useMemo(() => {
    if (categoryFilter === 'all' || categoryFilter.length === 0) return null
    return buildCategoryTrendData(
      transactions,
      categoryFilter,
      periodRange,
      formatChartMonth,
      coverage,
      accountName,
    )
  }, [
    transactions,
    categoryFilter,
    periodRange,
    formatChartMonth,
    coverage,
    accountName,
  ])

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
    const used = new Set<CategoryId>()
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
  }, [transactions, categories])

  const categoryTxs = useMemo(() => {
    if (categoryFilter === 'all' || categoryFilter.length === 0) return []
    return transactionsForCategory(
      transactions,
      categoryFilter,
      listScope === 'month' ? selectedMonth || undefined : undefined,
      'expense',
    )
  }, [transactions, categoryFilter, listScope, selectedMonth])

  const categoryMonthSpend = useMemo(() => {
    if (categoryFilter === 'all' || categoryFilter.length === 0) return null
    const ids = new Set(categoryFilter)
    const monthRows = transactions.filter(
      (tx) =>
        ids.has(tx.categoryId) &&
        transactionFlow(tx) === 'expense' &&
        (!selectedMonth || tx.date.startsWith(selectedMonth)),
    )
    return Math.round(
      monthRows.reduce((s, tx) => s + Math.abs(tx.amount), 0) * 100,
    ) / 100
  }, [categoryFilter, transactions, selectedMonth])

  const hasGaps = useMemo(
    () =>
      stacked.data.some((d) => d.gap === 1) ||
      (categoryTrend?.data.some((d) => d.gap === 1) ?? false),
    [stacked.data, categoryTrend],
  )

  const rangeTitle = t('trends.title', {
    from: formatChartMonth(periodRange.from),
    to: formatChartMonth(periodRange.to),
  })

  const setRangeBound = (bound: 'from' | 'to', value: string) => {
    let from = bound === 'from' ? value : periodRange.from
    let to = bound === 'to' ? value : periodRange.to
    if (compareMonths(from, to) > 0) {
      if (bound === 'from') to = from
      else from = to
    }
    onPeriodRangeChange({ from, to })
  }

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

  const selectedIds =
    categoryFilter === 'all' ? [] : categoryFilter
  const showAllCategories = categoryFilter === 'all'
  const showSingleTrend = selectedIds.length === 1

  const selectMonthSoon = (month: string) => {
    if (monthClickTimer.current) clearTimeout(monthClickTimer.current)
    monthClickTimer.current = setTimeout(() => {
      monthClickTimer.current = null
      onSelectMonth(month)
    }, 280)
  }

  const toggleCategoryFromChart = (id: CategoryId) => {
    if (monthClickTimer.current) {
      clearTimeout(monthClickTimer.current)
      monthClickTimer.current = null
    }
    setHoveredSlice(null)
    setCategoryFilter(
      categoryFilter !== 'all' &&
        categoryFilter.length === 1 &&
        categoryFilter[0] === id
        ? 'all'
        : [id],
    )
  }

  const toggleCategoryOnce = (id: CategoryId) => {
    const now = Date.now()
    if (now - lastCategoryToggleAt.current < 400) return
    lastCategoryToggleAt.current = now
    toggleCategoryFromChart(id)
  }

  const onBarActivate =
    (
      categoryId: CategoryId,
      monthAtIndex: (index: number) => string | undefined,
    ) =>
    (
      item: { payload?: { month?: string } } | undefined,
      barIndex: number,
      event?: { detail?: number },
    ) => {
      if ((event?.detail ?? 1) >= 2) {
        toggleCategoryOnce(categoryId)
        return
      }
      const month = item?.payload?.month ?? monthAtIndex(barIndex)
      if (typeof month === 'string') selectMonthSoon(month)
    }

  const onPlotDoubleClick = () => {
    const id = hoveredSliceRef.current?.categoryId
    if (id) toggleCategoryOnce(id)
  }

  const slicePointerHandlers = (categoryId: CategoryId) => ({
    onMouseEnter: (item: unknown, index: number) => {
      const geom = readBarGeom(item)
      setHoveredSlice({
        categoryId,
        index,
        x: geom?.x ?? 0,
        width: geom?.width ?? 0,
      })
    },
  })

  const selectedCatLabel = (() => {
    if (showAllCategories) return null
    if (selectedIds.length === 0) return t('categoryFilter.none')
    if (selectedIds.length <= 2) {
      return selectedIds.map((id) => categoryLabel(id)).join(', ')
    }
    return t('categoryFilter.selected', { count: selectedIds.length })
  })()
  const selectedCatColor = showSingleTrend
    ? (getCategoryMap()[selectedIds[0] ?? '']?.color ?? '#999')
    : null

  const categoryLegend = (
    <TrendCategoryLegend
      items={categoryOptions}
      categoryFilter={categoryFilter}
      hoveredId={hoveredSlice?.categoryId}
      onPick={toggleCategoryFromChart}
      labelFor={categoryLabel}
      ariaLabel={t('trends.legendAria')}
      showOnlyTitle={(category) =>
        t('trends.legendShowOnly', { category })
      }
      showAllTitle={t('trends.legendShowAll')}
    />
  )

  const tooltipPosition = hoveredSlice
    ? tooltipAnchor(hoveredSlice, plotRef.current?.clientWidth ?? 0)
    : undefined

  const chartTooltip = (
    <Tooltip
      content={
        <TrendTooltip
          t={t}
          formatEur={formatEur}
          hoveredCategoryId={hoveredSlice?.categoryId}
        />
      }
      position={tooltipPosition}
      isAnimationActive={false}
      wrapperStyle={{ zIndex: 30, outline: 'none', pointerEvents: 'none' }}
    />
  )

  const rangeControls = (
    <fieldset className="period-range">
      <legend className="sr-only">{t('trends.period')}</legend>
      <label className="period-range-field">
        <span className="muted small">{t('trends.from')}</span>
        <select
          value={periodRange.from}
          onChange={(e) => setRangeBound('from', e.target.value)}
          aria-label={t('trends.from')}
        >
          {months.map((m) => (
            <option key={`from-${m}`} value={m}>
              {formatMonthLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="period-range-field">
        <span className="muted small">{t('trends.to')}</span>
        <select
          value={periodRange.to}
          onChange={(e) => setRangeBound('to', e.target.value)}
          aria-label={t('trends.to')}
        >
          {months.map((m) => (
            <option key={`to-${m}`} value={m}>
              {formatMonthLabel(m)}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  )

  const categoryControl = (
    <div className="period-range-field">
      <span className="muted small">{t('trends.category')}</span>
      <CategoryFilter
        categories={categoryOptions}
        value={categoryFilter}
        onChange={setCategoryFilter}
        allLabel={t('trends.allExpenseCategories')}
        ariaLabel={t('trends.filterCategory')}
      />
    </div>
  )

  return (
    <>
      <section className="card card--chart">
        <div className="card-header card-header--chart">
          <div>
            <h2>{rangeTitle}</h2>
            <p className="muted" style={{ margin: '0.25rem 0 0' }}>
              {showAllCategories
                ? t('trends.hintAll')
                : showSingleTrend
                  ? t('trends.hintCategory', {
                      category: selectedCatLabel ?? '',
                    })
                  : t('trends.hintCategories', {
                      categories: selectedCatLabel ?? '',
                    })}
            </p>
          </div>
          <div className="trends-controls">
            {rangeControls}
            {categoryControl}
          </div>
        </div>

        {showSingleTrend ? (
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
                <span className="stat-label">{t('trends.periodAvg')}</span>
                <span className="stat-value">
                  {formatEur(categoryTrend?.average ?? 0)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">{t('trends.txShown')}</span>
                <span className="stat-value">{categoryTxs.length}</span>
              </div>
            </div>
            <div className="trend-plot-row">
            <div
              ref={plotRef}
              className="trend-plot"
              onDoubleClick={onPlotDoubleClick}
            >
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart
                data={categoryTrend?.data ?? []}
                margin={{ top: 28, right: 16, left: 8, bottom: 8 }}
                style={{ cursor: 'pointer' }}
                accessibilityLayer={false}
                onMouseLeave={() => setHoveredSlice(null)}
                onClick={(state) => {
                  const month = monthFromChartClick(
                    state,
                    categoryTrend?.data ?? [],
                  )
                  if (month) selectMonthSoon(month)
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: chart.tick }}
                  axisLine={{ stroke: chart.axis }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: chart.tick }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => formatCompactEur(v)}
                />
                {chartTooltip}
                <ReferenceLine
                  y={categoryTrend?.average ?? 0}
                  stroke={chart.reference}
                  strokeDasharray="6 4"
                  label={{
                    value: t('trends.avg', {
                      amount: formatEur(categoryTrend?.average ?? 0),
                    }),
                    position: 'insideTopRight',
                    fill: chart.reference,
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="amount"
                  name={selectedCatLabel ?? t('trends.spend')}
                  fill={selectedCatColor ?? '#999'}
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  isAnimationActive={false}
                  {...(selectedIds[0]
                    ? slicePointerHandlers(selectedIds[0])
                    : {})}
                  onClick={onBarActivate(
                    selectedIds[0] ?? 'uncategorized',
                    (barIndex) => categoryTrend?.data[barIndex]?.month,
                  )}
                >
                  {(categoryTrend?.data ?? []).map((entry) => (
                    <Cell
                      key={entry.month}
                      fill={selectedCatColor ?? '#999'}
                      fillOpacity={barOpacity(
                        selectedMonth,
                        entry.month,
                        entry.gap,
                      )}
                      stroke={
                        entry.gap === 1 ? 'var(--gap-marker, #c9a227)' : undefined
                      }
                      strokeWidth={entry.gap === 1 ? 1 : 0}
                      strokeDasharray={entry.gap === 1 ? '3 2' : undefined}
                    />
                  ))}
                  <LabelList
                    dataKey="amount"
                    content={(props) =>
                      barSumLabel(formatCompactEur, chart.label, props)
                    }
                  />
                  <LabelList
                    dataKey="amount"
                    content={makeGapMarkerLabel(categoryTrend?.data ?? [])}
                  />
                </Bar>
                <Line
                  type="linear"
                  dataKey="trend"
                  name={t('trends.trend')}
                  stroke={chart.line}
                  strokeWidth={2}
                  dot={false}
                  legendType="none"
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
            </div>
            {categoryLegend}
            </div>
          </>
        ) : (
          <>
            {!showAllCategories && (
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
                  <span className="stat-label">{t('trends.periodAvg')}</span>
                  <span className="stat-value">
                    {formatEur(categoryTrend?.average ?? 0)}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">{t('trends.txShown')}</span>
                  <span className="stat-value">{categoryTxs.length}</span>
                </div>
              </div>
            )}
            <div className="trend-plot-row">
            <div
              ref={plotRef}
              className="trend-plot"
              onDoubleClick={onPlotDoubleClick}
            >
            <ResponsiveContainer width="100%" height={380}>
              <BarChart
                data={stacked.data.map((d) => ({
                  ...d,
                  [BAR_LABEL_STACK]: 0.01,
                }))}
                margin={{ top: 28, right: 16, left: 8, bottom: 8 }}
                style={{ cursor: 'pointer' }}
                accessibilityLayer={false}
                onMouseLeave={() => setHoveredSlice(null)}
                onClick={(state) => {
                  const month = monthFromChartClick(state, stacked.data)
                  if (month) selectMonthSoon(month)
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: chart.tick }}
                  axisLine={{ stroke: chart.axis }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: chart.tick }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => formatCompactEur(v)}
                />
                {chartTooltip}
                {stacked.categoryIds.map((id) => (
                  <Bar
                    key={id}
                    dataKey={id}
                    name={categoryLabel(id)}
                    stackId="spend"
                    fill={getCategoryMap()[id]?.color ?? '#999'}
                    cursor="pointer"
                    isAnimationActive={false}
                    {...slicePointerHandlers(id)}
                    onClick={onBarActivate(
                      id,
                      (barIndex) => stacked.data[barIndex]?.month,
                    )}
                  >
                    {stacked.data.map((entry, index) => (
                      <Cell
                        key={`${id}-${entry.month}`}
                        fill={getCategoryMap()[id]?.color ?? '#999'}
                        fillOpacity={sliceOpacity(
                          selectedMonth,
                          entry.month,
                          entry.gap,
                          Boolean(
                            hoveredSlice &&
                              (hoveredSlice.categoryId !== id ||
                                hoveredSlice.index !== index),
                          ),
                        )}
                        stroke={
                          entry.gap === 1
                            ? 'var(--gap-marker, #c9a227)'
                            : undefined
                        }
                        strokeWidth={entry.gap === 1 ? 1 : 0}
                        strokeDasharray={entry.gap === 1 ? '3 2' : undefined}
                      />
                    ))}
                  </Bar>
                ))}
                <Bar
                  dataKey={BAR_LABEL_STACK}
                  stackId="spend"
                  legendType="none"
                  tooltipType="none"
                  fill="transparent"
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="total"
                    content={(props) =>
                      barSumLabel(formatCompactEur, chart.label, props)
                    }
                  />
                  <LabelList
                    dataKey="total"
                    content={makeGapMarkerLabel(stacked.data)}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
            {categoryLegend}
            </div>
          </>
        )}

        {hasGaps && (
          <p className="trend-gap-legend muted small">
            <span className="trend-gap-swatch" aria-hidden />
            {t('trends.gapLegend')}
          </p>
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
          onAutoCategorize={onAutoCategorize}
          onApplySuggestions={onApplySuggestions}
          llmBusy={llmBusy}
          llmProgress={llmProgress}
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
        <div className="purpose truncate" title={tx.purpose || undefined}>
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
