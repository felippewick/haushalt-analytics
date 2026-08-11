import { useEffect, useRef, useState } from 'react'
import type { Account } from '../lib/types'
import { useLocale } from '../hooks/useLocale'

export type AccountFilterValue = string[] | 'all'

interface Props {
  accounts: Account[]
  value: AccountFilterValue
  onChange: (value: AccountFilterValue) => void
}

export function AccountFilter({ accounts, value, onChange }: Props) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (accounts.length === 0) return null

  const allSelected = value === 'all'
  const selectedIds = allSelected ? [] : value
  const selected = new Set(selectedIds)

  const label = (() => {
    if (allSelected) return t('accountFilter.all')
    if (selectedIds.length === 0) return t('accountFilter.none')
    if (selectedIds.length === 1) {
      return (
        accounts.find((a) => a.id === selectedIds[0])?.name ??
        t('accountFilter.none')
      )
    }
    return t('accountFilter.selected', { count: selectedIds.length })
  })()

  const toggleAll = () => onChange(allSelected ? [] : 'all')

  const toggleAccount = (id: string) => {
    if (allSelected) {
      onChange(accounts.map((a) => a.id).filter((aid) => aid !== id))
      return
    }
    if (selected.has(id)) {
      onChange(selectedIds.filter((v) => v !== id))
      return
    }
    const next = [...selectedIds, id]
    onChange(next.length >= accounts.length ? 'all' : next)
  }

  const isChecked = (id: string) => allSelected || selected.has(id)

  return (
    <div className="account-filter" ref={rootRef}>
      <button
        type="button"
        className="account-filter-trigger"
        aria-label={t('accountFilter.aria')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="account-filter-label">{label}</span>
        <span className="account-filter-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="account-filter-menu" role="listbox" aria-multiselectable>
          <label className="account-filter-option">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
            />
            <span>{t('accountFilter.all')}</span>
          </label>
          <div className="account-filter-divider" />
          {accounts.map((a) => (
            <label key={a.id} className="account-filter-option">
              <input
                type="checkbox"
                checked={isChecked(a.id)}
                onChange={() => toggleAccount(a.id)}
              />
              <span>{a.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
