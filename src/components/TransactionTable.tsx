import { useMemo, useRef, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowsLeftRight,
  CircleNotch,
  Sparkle,
  type Icon,
} from '@phosphor-icons/react'
import { llmSupported, suggestionMemberCount, type AutoCategorizePreview, type LlmProgress, type LlmSuggestion } from '../lib/llmCategorize'
import type { Account, CategoryId, Transaction } from '../lib/types'
import {
  filterTransactions,
  type FlowFilter,
} from '../lib/analytics'
import { accountLabel } from '../lib/store'
import {
  transactionFlow,
  type TransactionFlow,
} from '../lib/categorize'
import { parseISO, format } from 'date-fns'
import { CategorySelect } from './CategorySelect'
import { CategoryFilter, type CategoryFilterValue } from './CategoryFilter'
import { LlmCategoryReviewDialog } from './LlmCategoryReviewDialog'
import { LlmProgressBar } from './LlmProgressBar'
import { useLocale } from '../hooks/useLocale'

const FLOW_ICONS: Record<TransactionFlow, Icon> = {
  expense: ArrowDownLeft,
  income: ArrowUpRight,
  transfer: ArrowsLeftRight,
}

interface Props {
  transactions: Transaction[]
  accounts: Account[]
  onUpdateCategory: (
    transactionId: string,
    categoryId: CategoryId,
    createMerchantRule?: boolean,
  ) => void
  /** Delete a manual transaction (only shown for origin === 'manual'). */
  onDeleteManual?: (transactionId: string) => void
  /** Optional heading; defaults to translated "Transactions". */
  title?: string
  /** DOM id for deep-linking / scroll targets. */
  id?: string
  /** On-device AI for uncategorized rows (Buchungen tab). */
  onAutoCategorize?: (txs: Transaction[]) => Promise<AutoCategorizePreview>
  onApplySuggestions?: (suggestions: LlmSuggestion[]) => void
  llmBusy?: boolean
  llmProgress?: LlmProgress | null
}

/** Share / unit quantity embedded in Trade Republic purpose text. */
function parseTransferredVolume(purpose: string): number | null {
  const m = purpose.match(/quantity:\s*([0-9]+(?:[.,][0-9]+)?)/i)
  if (!m) return null
  const n = Number(m[1]!.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function formatVolume(quantity: number, localeTag: string): string {
  return new Intl.NumberFormat(localeTag, {
    maximumFractionDigits: 6,
  }).format(quantity)
}

/** Compact account label: first 4 + last 4 chars (spaces ignored). */
function abbreviateAccount(label: string): string {
  const compact = label.replace(/\s+/g, '')
  if (compact.length <= 8) return compact
  return `${compact.slice(0, 4)}…${compact.slice(-4)}`
}

export function TransactionTable({
  transactions,
  accounts,
  onUpdateCategory,
  onDeleteManual,
  title,
  id,
  onAutoCategorize,
  onApplySuggestions,
  llmBusy = false,
  llmProgress = null,
}: Props) {
  const { t, categories, formatEur, locale } = useLocale()
  const localeTag = locale === 'de' ? 'de-DE' : 'en-US'
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] =
    useState<CategoryFilterValue>('all')
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('all')
  const [uncategorizedFirst, setUncategorizedFirst] = useState(true)
  const [aiStatus, setAiStatus] = useState<
    { kind: 'ok'; count: number } | { kind: 'error' } | null
  >(null)
  const [review, setReview] = useState<LlmSuggestion[] | null>(null)
  const appliedThisRun = useRef(0)
  const showAi =
    Boolean(onAutoCategorize && onApplySuggestions) && llmSupported()
  const uncategorizedCount = useMemo(
    () =>
      transactions.filter(
        (tx) => !tx.categoryOverride && tx.categoryId === 'uncategorized',
      ).length,
    [transactions],
  )

  const flowLabel: Record<TransactionFlow, string> = {
    expense: t('flow.expense'),
    income: t('flow.income'),
    transfer: t('flow.transfer'),
  }

  const filtered = useMemo(() => {
    const list = filterTransactions(transactions, {
      query,
      categoryIds: categoryFilter,
      flow: flowFilter,
      accounts,
    })

    return [...list].sort((a, b) => {
      if (uncategorizedFirst) {
        const au = a.categoryId === 'uncategorized' ? 0 : 1
        const bu = b.categoryId === 'uncategorized' ? 0 : 1
        if (au !== bu) return au - bu
      }
      return b.date.localeCompare(a.date)
    })
  }, [
    transactions,
    query,
    categoryFilter,
    flowFilter,
    uncategorizedFirst,
    accounts,
  ])

  const showAccountCol = accounts.length > 1

  const counts = useMemo(() => {
    let expense = 0
    let income = 0
    let transfer = 0
    for (const t of transactions) {
      const f = transactionFlow(t)
      if (f === 'expense') expense++
      else if (f === 'income') income++
      else transfer++
    }
    return { expense, income, transfer }
  }, [transactions])

  const closeReview = (applied: number) => {
    appliedThisRun.current = applied
    setReview(null)
    if (applied > 0) {
      setAiStatus({ kind: 'ok', count: applied })
    }
  }

  const acceptOne = (id: string) => {
    if (!onApplySuggestions || !review) return
    const item = review.find((s) => s.id === id)
    if (!item) return
    onApplySuggestions([item])
    const applied = appliedThisRun.current + suggestionMemberCount(item)
    appliedThisRun.current = applied
    const remaining = review.filter((s) => s.id !== id)
    if (remaining.length === 0) closeReview(applied)
    else setReview(remaining)
  }

  const skipOne = (id: string) => {
    if (!review) return
    const remaining = review.filter((s) => s.id !== id)
    if (remaining.length === 0) closeReview(appliedThisRun.current)
    else setReview(remaining)
  }

  const applyAll = () => {
    if (!onApplySuggestions || !review || review.length === 0) return
    onApplySuggestions(review)
    closeReview(
      appliedThisRun.current +
        review.reduce((n, item) => n + suggestionMemberCount(item), 0),
    )
  }

  return (
    <section className="card" id={id}>
      <div className="card-header">
        <h2>{title ?? t('tx.title')}</h2>
        <span className="muted small">
          {filtered.length} / {transactions.length}
        </span>
      </div>

      <div className="flow-tabs">
        {(
          [
            ['all', t('flow.all', { count: transactions.length })],
            ['expense', t('flow.expenses', { count: counts.expense })],
            ['income', t('flow.incomes', { count: counts.income })],
            ['transfer', t('flow.excluded', { count: counts.transfer })],
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
        <CategoryFilter
          categories={categories}
          value={categoryFilter}
          onChange={setCategoryFilter}
          grouped
          allLabel={t('tx.allCategories')}
          ariaLabel={t('categoryFilter.aria')}
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={uncategorizedFirst}
            onChange={(e) => setUncategorizedFirst(e.target.checked)}
          />
          {t('tx.uncategorizedFirst')}
        </label>
        {showAi && onAutoCategorize && onApplySuggestions && (
          <div className="toolbar-ai">
            {aiStatus?.kind === 'ok' && (
              <span className="toolbar-ai-status" role="status">
                {aiStatus.count > 0
                  ? t('tx.autoCategorizeDone', { count: aiStatus.count })
                  : t('tx.autoCategorizeNone')}
              </span>
            )}
            {aiStatus?.kind === 'error' && (
              <span className="toolbar-ai-status toolbar-ai-status--fail" role="status">
                {t('tx.autoCategorizeError')}
              </span>
            )}
            <button
              type="button"
              className="btn-secondary btn-ai"
              disabled={llmBusy || uncategorizedCount === 0 || review !== null}
              title={t('tx.autoCategorizeTitle')}
              aria-busy={llmBusy}
              onClick={() => {
                setAiStatus(null)
                appliedThisRun.current = 0
                void onAutoCategorize(transactions)
                  .then((result) => {
                    if (result.suggestions.length === 0) {
                      setAiStatus({ kind: 'ok', count: 0 })
                      return
                    }
                    setReview(result.suggestions)
                  })
                  .catch(() => {
                    setAiStatus({ kind: 'error' })
                  })
              }}
            >
              {llmBusy ? (
                <CircleNotch
                  size={14}
                  weight="bold"
                  className="btn-ai-spin"
                  aria-hidden
                />
              ) : (
                <Sparkle size={14} weight="fill" aria-hidden />
              )}
              {llmBusy
                ? t('tx.autoCategorizeBusy')
                : uncategorizedCount > 0
                  ? t('tx.autoCategorizeCount', { count: uncategorizedCount })
                  : t('tx.autoCategorize')}
            </button>
            {llmBusy && llmProgress && llmProgress.total > 0 ? (
              <LlmProgressBar
                done={llmProgress.done}
                total={llmProgress.total}
                label={t('tx.autoCategorizeProgress', {
                  done: llmProgress.done,
                  total: llmProgress.total,
                })}
              />
            ) : null}
          </div>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="col-date">{t('tx.col.date')}</th>
              <th className="col-type" title={t('tx.col.type')}>
                {t('tx.col.type')}
              </th>
              {showAccountCol && (
                <th className="col-account">{t('tx.col.account')}</th>
              )}
              <th>{t('tx.col.counterparty')}</th>
              <th className="col-purpose">{t('tx.col.purpose')}</th>
              <th>{t('tx.col.category')}</th>
              <th className="num">{t('tx.col.amount')}</th>
              <th className="num">{t('tx.col.volume')}</th>
              {onDeleteManual && <th />}
            </tr>
          </thead>
          <tbody>
            {filtered.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                accountName={accountLabel(accounts, tx.accountId)}
                showAccountCol={showAccountCol}
                onUpdateCategory={onUpdateCategory}
                onDeleteManual={onDeleteManual}
                flowLabel={flowLabel}
                formatEur={formatEur}
                formatVolume={(q) => formatVolume(q, localeTag)}
                t={t}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={
                    (showAccountCol ? 8 : 7) + (onDeleteManual ? 1 : 0)
                  }
                  className="muted"
                >
                  {t('tx.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {onApplySuggestions && (
        <LlmCategoryReviewDialog
          open={review !== null && review.length > 0}
          suggestions={review ?? []}
          onChangeCategory={(id, categoryId) => {
            setReview((prev) =>
              prev
                ? prev.map((s) => (s.id === id ? { ...s, categoryId } : s))
                : prev,
            )
          }}
          onAccept={acceptOne}
          onSkip={skipOne}
          onApplyAll={applyAll}
          onDismiss={() => closeReview(appliedThisRun.current)}
        />
      )}
    </section>
  )
}

function buildTxHoverInfo({
  tx,
  accountName,
  showAccountCol,
  flowLabel,
  formatEur,
  formatVolume,
  volume,
  t,
}: {
  tx: Transaction
  accountName: string
  showAccountCol: boolean
  flowLabel: string
  formatEur: (n: number) => string
  formatVolume: (n: number) => string
  volume: number | null
  t: (
    key:
      | 'tx.col.date'
      | 'tx.col.type'
      | 'tx.col.account'
      | 'tx.col.counterparty'
      | 'tx.col.purpose'
      | 'tx.col.amount'
      | 'tx.col.volume'
      | 'tx.col.iban'
      | 'tx.col.bookingType',
  ) => string
}): string {
  const lines = [
    `${t('tx.col.date')}: ${format(parseISO(tx.date), 'dd.MM.yyyy')}`,
    `${t('tx.col.type')}: ${flowLabel}`,
  ]
  if (showAccountCol) {
    lines.push(`${t('tx.col.account')}: ${accountName}`)
  }
  lines.push(
    `${t('tx.col.counterparty')}: ${tx.counterparty || '—'}`,
    `${t('tx.col.purpose')}: ${tx.purpose || '—'}`,
  )
  if (tx.iban) lines.push(`${t('tx.col.iban')}: ${tx.iban}`)
  if (tx.type) lines.push(`${t('tx.col.bookingType')}: ${tx.type}`)
  lines.push(`${t('tx.col.amount')}: ${formatEur(tx.amount)}`)
  if (volume != null) {
    lines.push(`${t('tx.col.volume')}: ${formatVolume(volume)}`)
  }
  return lines.join('\n')
}

function TransactionRow({
  tx,
  accountName,
  showAccountCol,
  onUpdateCategory,
  onDeleteManual,
  flowLabel,
  formatEur,
  formatVolume,
  t,
}: {
  tx: Transaction
  accountName: string
  showAccountCol: boolean
  onUpdateCategory: Props['onUpdateCategory']
  onDeleteManual?: Props['onDeleteManual']
  flowLabel: Record<TransactionFlow, string>
  formatEur: (n: number) => string
  formatVolume: (n: number) => string
  t: (
    key:
      | 'tx.delete'
      | 'tx.categoryAria'
      | 'tx.transaction'
      | 'tx.col.date'
      | 'tx.col.type'
      | 'tx.col.account'
      | 'tx.col.counterparty'
      | 'tx.col.purpose'
      | 'tx.col.amount'
      | 'tx.col.volume'
      | 'tx.col.iban'
      | 'tx.col.bookingType',
    params?: Record<string, string | number>,
  ) => string
}) {
  const flow = transactionFlow(tx)
  const volume = parseTransferredVolume(tx.purpose)
  const canDelete = Boolean(onDeleteManual && tx.origin === 'manual')
  const FlowIcon = FLOW_ICONS[flow]
  const hoverInfo = buildTxHoverInfo({
    tx,
    accountName,
    showAccountCol,
    flowLabel: flowLabel[flow],
    formatEur,
    formatVolume,
    volume,
    t,
  })

  return (
    <tr
      className={`${tx.categoryId === 'uncategorized' ? 'uncategorized' : ''} flow-row-${flow}`}
      title={hoverInfo}
    >
      <td className="col-date nowrap">
        {format(parseISO(tx.date), 'dd.MM.yy')}
      </td>
      <td className="col-type">
        <span
          className={`flow-badge icon-only ${flow}`}
          aria-label={flowLabel[flow]}
        >
          <FlowIcon size={13} weight="bold" aria-hidden />
        </span>
      </td>
      {showAccountCol && (
        <td className="col-account">
          <span className="muted account-abbr">{abbreviateAccount(accountName)}</span>
        </td>
      )}
      <td>
        <div className="merchant">{tx.counterparty || '—'}</div>
      </td>
      <td className="col-purpose">
        <div className="purpose truncate">{tx.purpose || '—'}</div>
      </td>
      <td>
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
      </td>
      <td className={`num nowrap ${flow === 'income' ? 'income' : flow === 'expense' ? 'expense' : 'muted'}`}>
        {formatEur(tx.amount)}
      </td>
      <td className="num nowrap muted">
        {volume != null ? formatVolume(volume) : '—'}
      </td>
      {onDeleteManual && (
        <td>
          {canDelete && (
            <button
              type="button"
              className="linkish"
              onClick={() => onDeleteManual(tx.id)}
            >
              {t('tx.delete')}
            </button>
          )}
        </td>
      )}
    </tr>
  )
}
