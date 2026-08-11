import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { CaretDown, Check } from '@phosphor-icons/react'
import type { Category, CategoryId } from '../lib/types'
import { useLocale } from '../hooks/useLocale'
import { CategoryIcon } from './CategoryIcon'

interface Props {
  value: CategoryId
  counterparty?: string
  onChange: (categoryId: CategoryId, createMerchantRule: boolean) => void
  ariaLabel?: string
}

interface MenuPos {
  top: number
  left: number
}

const MENU_WIDTH = 520
const MENU_GAP = 8

export function CategorySelect({
  value,
  counterparty,
  onChange,
  ariaLabel,
}: Props) {
  const { t, categories, categoryLabel } = useLocale()
  const [remember, setRemember] = useState(true)
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const canRemember = Boolean(counterparty?.trim())
  const selectedLabel = categoryLabel(value)

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

  const updateMenuPos = () => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const menuHeight = menuRef.current?.offsetHeight ?? 360
    const width = Math.min(MENU_WIDTH, window.innerWidth - 16)

    let left = rect.right + MENU_GAP
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, rect.left - width - MENU_GAP)
    }
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8)
    }

    let top = rect.top
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - menuHeight - 8)
    }

    setMenuPos({ top, left })
  }

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null)
      return
    }
    updateMenuPos()
    // Re-measure after paint once menu height is known
    const id = requestAnimationFrame(updateMenuPos)
    const onScroll = () => updateMenuPos()
    window.addEventListener('resize', onScroll)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (id: CategoryId) => {
    onChange(id, canRemember && remember)
    setOpen(false)
  }

  return (
    <div className={`cat-select ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="cat-select-trigger"
        aria-label={ariaLabel ?? t('category.aria')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <CategoryIcon categoryId={value} badge size={13} />
        <span className="cat-select-label">{selectedLabel}</span>
        <CaretDown
          className="cat-select-chevron"
          size={12}
          weight="bold"
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="cat-select-menu"
          role="listbox"
          id={listId}
          tabIndex={-1}
          style={
            menuPos
              ? {
                  top: menuPos.top,
                  left: menuPos.left,
                  width: Math.min(MENU_WIDTH, window.innerWidth - 16),
                }
              : { visibility: 'hidden', top: 0, left: 0 }
          }
        >
          {canRemember && (
            <button
              type="button"
              className={`cat-select-remember ${remember ? 'on' : ''}`}
              aria-pressed={remember}
              aria-label={t('category.rememberAria')}
              title={t('category.rememberTitle')}
              onClick={() => setRemember((v) => !v)}
            >
              <span className="cat-select-remember-label">
                {t('category.remember')}
              </span>
              <span className="cat-select-remember-switch" aria-hidden="true">
                <span className="cat-select-remember-knob" />
              </span>
            </button>
          )}
          <OptionGroup
            label={t('catGroup.expenses')}
            options={expenseCats}
            value={value}
            onPick={pick}
            columns
          />
          <div className="cat-select-side-groups">
            <OptionGroup
              label={t('catGroup.income')}
              options={incomeCats}
              value={value}
              onPick={pick}
            />
            <OptionGroup
              label={t('catGroup.excluded')}
              options={excludedCats}
              value={value}
              onPick={pick}
            />
            <OptionGroup
              label={t('catGroup.other')}
              options={otherCats}
              value={value}
              onPick={pick}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function OptionGroup({
  label,
  options,
  value,
  onPick,
  columns = false,
}: {
  label: string
  options: Category[]
  value: CategoryId
  onPick: (id: CategoryId) => void
  columns?: boolean
}) {
  if (options.length === 0) return null
  return (
    <div
      className={`cat-select-group ${columns ? 'columns' : ''}`}
      role="group"
      aria-label={label}
    >
      <div className="cat-select-group-label">{label}</div>
      <div className={columns ? 'cat-select-options-grid' : undefined}>
        {options.map((c) => {
          const selected = c.id === value
          return (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={selected}
              className={`cat-select-option ${selected ? 'selected' : ''}`}
              onClick={() => onPick(c.id)}
            >
              <CategoryIcon categoryId={c.id} badge size={13} />
              <span className="cat-select-option-label">{c.label}</span>
              {selected && (
                <Check
                  className="cat-select-check"
                  size={14}
                  weight="bold"
                  aria-hidden="true"
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

