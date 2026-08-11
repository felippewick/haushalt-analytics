import { useMemo, useState } from 'react'
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
import { CategoryIcon } from './CategoryIcon'
import { useLocale } from '../hooks/useLocale'

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

export function TransactionTable({
  transactions,
  accounts,
  onUpdateCategory,
  onDeleteManual,
  title,
  id,
}: Props) {
  const { t, categories, formatEur, locale } = useLocale()
  const localeTag = locale === 'de' ? 'de-DE' : 'en-US'
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryId | 'all'>('all')
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('all')
  const [uncategorizedFirst, setUncategorizedFirst] = useState(true)

  const flowLabel: Record<TransactionFlow, string> = {
    expense: t('flow.expense'),
    income: t('flow.income'),
    transfer: t('flow.transfer'),
  }

  const filtered = useMemo(() => {
    const list = filterTransactions(transactions, {
      query,
      categoryId: categoryFilter,
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
        <div className="cat-filter">
          {categoryFilter !== 'all' && (
            <CategoryIcon categoryId={categoryFilter} badge size={13} />
          )}
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
        <label className="checkbox">
          <input
            type="checkbox"
            checked={uncategorizedFirst}
            onChange={(e) => setUncategorizedFirst(e.target.checked)}
          />
          {t('tx.uncategorizedFirst')}
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('tx.col.date')}</th>
              <th>{t('tx.col.type')}</th>
              {showAccountCol && <th>{t('tx.col.account')}</th>}
              <th>{t('tx.col.counterparty')}</th>
              <th>{t('tx.col.purpose')}</th>
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
    </section>
  )
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
  t: (key: 'tx.delete' | 'tx.categoryAria' | 'tx.transaction', params?: Record<string, string | number>) => string
}) {
  const flow = transactionFlow(tx)
  const volume = parseTransferredVolume(tx.purpose)
  const canDelete = Boolean(onDeleteManual && tx.origin === 'manual')

  return (
    <tr
      className={`${tx.categoryId === 'uncategorized' ? 'uncategorized' : ''} flow-row-${flow}`}
    >
      <td className="nowrap">{format(parseISO(tx.date), 'dd.MM.yyyy')}</td>
      <td>
        <span className={`flow-badge ${flow}`}>{flowLabel[flow]}</span>
      </td>
      {showAccountCol && (
        <td>
          <span className="muted small">{accountName}</span>
        </td>
      )}
      <td>
        <div className="merchant">{tx.counterparty || '—'}</div>
      </td>
      <td>
        <div className="purpose truncate" title={tx.purpose}>
          {tx.purpose || '—'}
        </div>
      </td>
      <td>
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
