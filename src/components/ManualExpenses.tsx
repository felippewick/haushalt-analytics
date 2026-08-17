import { useEffect, useRef, useState, type FormEvent } from 'react'
import { addMonths, format, parseISO } from 'date-fns'
import type { CategoryId } from '../lib/types'
import type { ManualExpenseInput } from '../lib/store'
import { useLocale } from '../hooks/useLocale'
import { CategorySelect } from './CategorySelect'

interface Props {
  month: string
  onAdd: (input: ManualExpenseInput) => void
}

function defaultEndMonth(start: string): string {
  try {
    return format(addMonths(parseISO(`${start}-01`), 11), 'yyyy-MM')
  } catch {
    return start
  }
}

export function ManualExpenses({ month, onAdd }: Props) {
  const { t, formatMonthLabel } = useLocale()
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<CategoryId>('reserves')
  const [day, setDay] = useState('1')
  const [recurring, setRecurring] = useState(false)
  const [endMonth, setEndMonth] = useState('')

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setLabel('')
    setAmount('')
    setCategoryId('reserves')
    setDay('1')
    setRecurring(false)
    setEndMonth(defaultEndMonth(month))
  }, [open, month])

  const close = () => setOpen(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = Number(amount.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return

    const input: ManualExpenseInput = {
      month,
      amount: n,
      label: label.trim() || t('manual.defaultLabel'),
      categoryId,
      day: Number(day) || 1,
    }
    if (recurring && endMonth && endMonth >= month) {
      input.endMonth = endMonth
    }

    onAdd(input)
    close()
  }

  if (!month) return null

  const bookingText =
    recurring && endMonth && endMonth >= month
      ? t('manual.bookingUntil', {
          month: formatMonthLabel(month),
          end: formatMonthLabel(endMonth),
        })
      : `${t('manual.booking', { month: formatMonthLabel(month) })}.`

  return (
    <div className="manual-add-bar">
      <button
        type="button"
        className="btn-primary"
        onClick={() => setOpen(true)}
      >
        {t('manual.add')}
      </button>

      <dialog
        ref={dialogRef}
        className="settings-dialog manual-expense-dialog"
        onClose={close}
      >
        <form className="settings-dialog-inner" onSubmit={submit}>
          <header className="settings-dialog-header">
            <h2>{t('manual.title')}</h2>
            <button type="button" className="linkish" onClick={close}>
              {t('manual.close')}
            </button>
          </header>

          <p className="muted settings-intro">{bookingText}</p>

          <div className="manual-dialog-form">
            <label className="manual-field">
              <span>{t('manual.label')}</span>
              <input
                type="text"
                placeholder={t('manual.labelPlaceholder')}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoFocus
              />
            </label>

            <label className="manual-field">
              <span>{t('manual.amount')}</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </label>

            <label className="manual-field">
              <span>{t('manual.category')}</span>
              <CategorySelect
                value={categoryId}
                amount={-1}
                onChange={(id) => setCategoryId(id)}
              />
            </label>

            <label className="manual-field">
              <span>{t('manual.day')}</span>
              <select value={day} onChange={(e) => setDay(e.target.value)}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}.
                  </option>
                ))}
              </select>
            </label>

            <label className="manual-check">
              <input
                type="checkbox"
                checked={recurring}
                onChange={(e) => {
                  const on = e.target.checked
                  setRecurring(on)
                  if (on && (!endMonth || endMonth < month)) {
                    setEndMonth(defaultEndMonth(month))
                  }
                }}
              />
              <span>{t('manual.recurring')}</span>
            </label>

            {recurring && (
              <label className="manual-field">
                <span>{t('manual.endMonth')}</span>
                <input
                  type="month"
                  value={endMonth}
                  min={month}
                  onChange={(e) => setEndMonth(e.target.value)}
                  required
                />
              </label>
            )}
          </div>

          <div className="manual-dialog-actions">
            <button type="button" className="btn-secondary" onClick={close}>
              {t('manual.cancel')}
            </button>
            <button type="submit" className="btn-primary">
              {recurring ? t('manual.submitSeries') : t('manual.submit')}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
