import { useEffect, useRef, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import type { Category, CategoryId } from '../lib/types'
import { groupedCategories } from '../lib/categories'
import { useLocale } from '../hooks/useLocale'
import { CategoryIcon } from './CategoryIcon'

export type CategoryFilterValue = CategoryId[] | 'all'

/** Same checkbox rules as the category picker. */
export function toggleCategoryFilter(
  current: CategoryFilterValue,
  id: CategoryId,
  allIds: CategoryId[],
): CategoryFilterValue {
  if (current === 'all') {
    return allIds.filter((cid) => cid !== id)
  }
  if (current.includes(id)) {
    return current.filter((cid) => cid !== id)
  }
  const next = [...current, id]
  return next.length >= allIds.length ? 'all' : next
}

interface Props {
  categories: Category[]
  value: CategoryFilterValue
  onChange: (value: CategoryFilterValue) => void
  /** Split the menu into expense / income / excluded. */
  grouped?: boolean
  allLabel: string
  ariaLabel: string
}

export function CategoryFilter({
  categories,
  value,
  onChange,
  grouped = false,
  allLabel,
  ariaLabel,
}: Props) {
  const { t, categoryLabel } = useLocale()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const allSelected = value === 'all'
  const selectedIds = allSelected ? [] : value
  const selected = new Set(selectedIds)

  const label = (() => {
    if (allSelected) return allLabel
    if (selectedIds.length === 0) return t('categoryFilter.none')
    if (selectedIds.length === 1) {
      return categoryLabel(selectedIds[0] ?? '')
    }
    return t('categoryFilter.selected', { count: selectedIds.length })
  })()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      setOpen(false)
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

  if (categories.length === 0) return null

  const toggleAll = () => onChange(allSelected ? [] : 'all')

  const toggleCategory = (id: CategoryId) => {
    onChange(toggleCategoryFilter(value, id, categories.map((c) => c.id)))
  }

  const isChecked = (id: CategoryId) => allSelected || selected.has(id)

  const previewIds = allSelected
    ? []
    : selectedIds.slice(0, 3)

  const byKind = groupedCategories(categories)
  const groups = grouped
    ? [
        {
          label: t('catGroup.expenses'),
          items: byKind.expenses,
        },
        {
          label: t('catGroup.income'),
          items: byKind.income,
        },
        {
          label: t('catGroup.excluded'),
          items: byKind.excluded,
        },
      ]
    : [{ label: null, items: categories }]

  return (
    <div className={`category-filter ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="category-filter-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {previewIds.length > 0 && (
          <span className="category-filter-icons" aria-hidden>
            {previewIds.map((id) => (
              <CategoryIcon key={id} categoryId={id} badge size={13} />
            ))}
          </span>
        )}
        <span className="category-filter-label">{label}</span>
        <CaretDown
          className={`category-filter-caret ${open ? 'open' : ''}`}
          size={12}
          weight="bold"
          aria-hidden
        />
      </button>
      {open && (
        <div
          className={`category-filter-menu ${grouped ? 'grouped' : ''}`}
          role="listbox"
          aria-multiselectable
        >
          <label className="category-filter-option">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
            />
            <span>{allLabel}</span>
          </label>
          <div className="category-filter-divider" />
          {groups.map((group) => {
            if (group.items.length === 0) return null
            return (
              <fieldset
                key={group.label ?? 'all'}
                className="category-filter-group"
              >
                {group.label && (
                  <legend className="category-filter-group-label">
                    {group.label}
                  </legend>
                )}
                {group.items.map((c) => (
                  <label key={c.id} className="category-filter-option">
                    <input
                      type="checkbox"
                      checked={isChecked(c.id)}
                      onChange={() => toggleCategory(c.id)}
                    />
                    <CategoryIcon categoryId={c.id} badge size={13} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </fieldset>
            )
          })}
        </div>
      )}
    </div>
  )
}
