import { useEffect, useRef } from 'react'
import { Check, X } from '@phosphor-icons/react'
import { format, parseISO } from 'date-fns'
import type { CategoryId } from '../lib/types'
import { suggestionMemberCount, type LlmSuggestion } from '../lib/llmCategorize'
import { useLocale } from '../hooks/useLocale'
import { CategoryIcon } from './CategoryIcon'
import { transactionFlow } from '../lib/categorize'
import { groupedCategories } from '../lib/categories'

interface Props {
  open: boolean
  suggestions: LlmSuggestion[]
  onChangeCategory: (id: string, categoryId: CategoryId) => void
  onAccept: (id: string) => void
  onSkip: (id: string) => void
  onApplyAll: () => void
  onDismiss: () => void
}

export function LlmCategoryReviewDialog({
  open,
  suggestions,
  onChangeCategory,
  onAccept,
  onSkip,
  onApplyAll,
  onDismiss,
}: Props) {
  const { t, categories, categoryLabel, formatEur } = useLocale()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  }, [open])

  const selectable = categories.filter((c) => c.id !== 'uncategorized')
  const bookingCount = suggestions.reduce(
    (n, item) => n + suggestionMemberCount(item),
    0,
  )
  const byKind = groupedCategories(selectable)

  const optionsForAmount = (amount: number, currentId: CategoryId) => {
    const catchAll = byKind.expenses.filter((c) => c.id === 'other')
    const list =
      amount >= 0
        ? [...byKind.income, ...catchAll, ...byKind.excluded]
        : [...byKind.expenses, ...byKind.excluded]
    if (list.some((c) => c.id === currentId)) return list
    const current = categories.find((c) => c.id === currentId)
    return current ? [current, ...list] : list
  }

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog llm-review-dialog"
      onClose={onDismiss}
    >
      <div className="settings-dialog-inner">
        <header className="settings-dialog-header">
          <div className="settings-dialog-heading">
            <h2>{t('tx.review.title')}</h2>
            <span className="muted small">
              {t('tx.review.count', { count: suggestions.length })}
            </span>
          </div>
          <button type="button" className="linkish" onClick={onDismiss}>
            {t('tx.review.dismiss')}
          </button>
        </header>

        <p className="muted settings-intro">{t('tx.review.intro')}</p>

        <ul className="llm-review-list">
          {suggestions.map((item) => {
            const flow = transactionFlow(item.tx)
            return (
              <li key={item.id} className="llm-review-row">
                <div className="llm-review-meta">
                  <span className="llm-review-date">
                    {format(parseISO(item.tx.date), 'dd.MM.yy')}
                  </span>
                  <div className="llm-review-copy">
                    <div className="merchant">
                      {item.tx.counterparty || t('tx.transaction')}
                      {suggestionMemberCount(item) > 1 ? (
                        <span className="llm-review-similar">
                          {t('tx.review.similar', {
                            count: suggestionMemberCount(item),
                          })}
                        </span>
                      ) : null}
                    </div>
                    {item.tx.purpose ? (
                      <div className="purpose truncate" title={item.tx.purpose}>
                        {item.tx.purpose}
                      </div>
                    ) : null}
                  </div>
                  <span
                    className={`num nowrap ${flow === 'income' ? 'income' : flow === 'expense' ? 'expense' : 'muted'}`}
                  >
                    {formatEur(item.tx.amount)}
                  </span>
                </div>
                <div className="llm-review-actions">
                  <label className="llm-review-cat">
                    <span className="sr-only">{t('tx.col.category')}</span>
                    <CategoryIcon categoryId={item.categoryId} size={14} />
                    <select
                      value={item.categoryId}
                      aria-label={t('tx.categoryAria', {
                        name: item.tx.counterparty || t('tx.transaction'),
                      })}
                      onChange={(e) =>
                        onChangeCategory(item.id, e.target.value as CategoryId)
                      }
                    >
                      {optionsForAmount(item.tx.amount, item.categoryId).map((c) => (
                        <option key={c.id} value={c.id}>
                          {categoryLabel(c.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn-primary llm-review-accept"
                    onClick={() => onAccept(item.id)}
                  >
                    <Check size={14} weight="bold" aria-hidden />
                    {t('tx.review.accept')}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary llm-review-skip"
                    onClick={() => onSkip(item.id)}
                  >
                    <X size={14} weight="bold" aria-hidden />
                    {t('tx.review.skip')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="manual-dialog-actions">
          <button type="button" className="btn-secondary" onClick={onDismiss}>
            {t('tx.review.discard')}
          </button>
          <button type="button" className="btn-primary" onClick={onApplyAll}>
            {t('tx.review.applyAll', { count: bookingCount })}
          </button>
        </div>
      </div>
    </dialog>
  )
}
