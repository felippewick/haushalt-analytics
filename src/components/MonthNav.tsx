import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { CaretDown, CaretLeft, CaretRight, Check } from '@phosphor-icons/react'
import { useLocale } from '../hooks/useLocale'

interface Props {
  months: string[]
  selectedMonth: string
  onSelectMonth: (month: string) => void
}

interface MenuPos {
  top: number
  left: number
  width: number
}

const MENU_MIN = 180
const MENU_GAP = 6

export function MonthNav({ months, selectedMonth, onSelectMonth }: Props) {
  const { t, formatMonthLabel } = useLocale()
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const listId = useId()

  const index = months.indexOf(selectedMonth)
  const older = index > 0 ? months[index - 1] : undefined
  const newer = index >= 0 ? months[index + 1] : undefined

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null)
      return
    }

    const updateMenuPos = () => {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const menuHeight = menuRef.current?.offsetHeight ?? 280
      const width = Math.max(
        MENU_MIN,
        Math.min(rect.width + 48, window.innerWidth - 16),
      )

      let left = rect.left
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8)
      }

      let top = rect.bottom + MENU_GAP
      if (top + menuHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuHeight - MENU_GAP)
      }

      setMenuPos({ top, left, width })
    }

    updateMenuPos()
    const id = requestAnimationFrame(updateMenuPos)
    window.addEventListener('resize', updateMenuPos)
    window.addEventListener('scroll', updateMenuPos, true)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', updateMenuPos)
      window.removeEventListener('scroll', updateMenuPos, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
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

  const pick = (month: string) => {
    onSelectMonth(month)
    setOpen(false)
  }

  return (
    <div className={`month-nav ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="month-nav-step"
        disabled={!older}
        onClick={() => older && onSelectMonth(older)}
        aria-label={t('dashboard.prevMonth')}
      >
        <CaretLeft size={16} weight="bold" aria-hidden="true" />
      </button>
      <button
        type="button"
        ref={triggerRef}
        className="month-nav-label"
        aria-label={t('trends.selectMonth')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{formatMonthLabel(selectedMonth)}</span>
        <CaretDown
          className="month-nav-chevron"
          size={12}
          weight="bold"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        className="month-nav-step"
        disabled={!newer}
        onClick={() => newer && onSelectMonth(newer)}
        aria-label={t('dashboard.nextMonth')}
      >
        <CaretRight size={16} weight="bold" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="month-nav-menu"
          role="listbox"
          id={listId}
          tabIndex={-1}
          aria-label={t('trends.selectMonth')}
          style={
            menuPos
              ? {
                  top: menuPos.top,
                  left: menuPos.left,
                  width: menuPos.width,
                }
              : { visibility: 'hidden', top: 0, left: 0 }
          }
        >
          {months.map((m) => {
            const selected = m === selectedMonth
            return (
              <button
                key={m}
                type="button"
                ref={selected ? selectedRef : undefined}
                role="option"
                aria-selected={selected}
                className={`month-nav-option ${selected ? 'selected' : ''}`}
                onClick={() => pick(m)}
              >
                <span>{formatMonthLabel(m)}</span>
                {selected && (
                  <Check size={14} weight="bold" aria-hidden="true" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
