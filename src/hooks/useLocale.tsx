import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { de as dateFnsDe } from 'date-fns/locale/de'
import { enUS as dateFnsEn } from 'date-fns/locale/en-US'
import { format, parseISO } from 'date-fns'
import type { Category, CategoryId } from '../lib/types'
import { CATEGORIES } from '../lib/defaultRules'
import { isBuiltinCategory } from '../lib/categories'
import {
  categoryLabel as i18nCategoryLabel,
  createTranslator,
  loadStoredLocale,
  localeTag,
  persistLocale,
  type Locale,
  type MessageKey,
  type TranslateFn,
} from '../lib/i18n'

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: TranslateFn
  categoryLabel: (id: CategoryId) => string
  categories: Category[]
  formatMonthLabel: (yyyyMm: string) => string
  formatChartMonth: (yyyyMm: string) => string
  formatEur: (amount: number) => string
  formatCompactEur: (amount: number) => string
  dateLocale: typeof dateFnsEn
}

const LocaleContext = createContext<LocaleContextValue | null>(null)
const SetCategoriesContext = createContext<(cats: Category[]) => void>(
  () => undefined,
)

function resolveCategoryLabel(
  cat: Category | undefined,
  id: CategoryId,
  locale: Locale,
): string {
  if (cat?.labelOverride?.trim()) return cat.labelOverride.trim()
  if (isBuiltinCategory(id)) return i18nCategoryLabel(id, locale)
  return cat?.label?.trim() || id
}

function localizedCategories(
  source: Category[],
  locale: Locale,
): Category[] {
  return source.map((c) => ({
    ...c,
    label: resolveCategoryLabel(c, c.id, locale),
  }))
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => loadStoredLocale())
  const [storeCategories, setStoreCategories] = useState<Category[] | null>(
    null,
  )

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    persistLocale(next)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale === 'de' ? 'de' : 'en'
  }, [locale])

  const value = useMemo<LocaleContextValue>(() => {
    const t = createTranslator(locale)
    const tag = localeTag(locale)
    const dateLocale = locale === 'de' ? dateFnsDe : dateFnsEn
    const source = storeCategories?.length ? storeCategories : CATEGORIES
    const categories = localizedCategories(source, locale)
    const byId = new Map(source.map((c) => [c.id, c]))

    return {
      locale,
      setLocale,
      t,
      categoryLabel: (id) => resolveCategoryLabel(byId.get(id), id, locale),
      categories,
      formatMonthLabel: (yyyyMm) => {
        try {
          return format(parseISO(`${yyyyMm}-01`), 'MMMM yyyy', {
            locale: dateLocale,
          })
        } catch {
          return yyyyMm
        }
      },
      formatChartMonth: (yyyyMm) => {
        try {
          return format(parseISO(`${yyyyMm}-01`), 'MMM yy', {
            locale: dateLocale,
          })
        } catch {
          return yyyyMm
        }
      },
      formatEur: (amount) =>
        new Intl.NumberFormat(tag, {
          style: 'currency',
          currency: 'EUR',
        }).format(amount),
      formatCompactEur: (amount) =>
        new Intl.NumberFormat(tag, {
          notation: 'compact',
          style: 'currency',
          currency: 'EUR',
          maximumFractionDigits: 0,
        }).format(amount),
      dateLocale,
    }
  }, [locale, setLocale, storeCategories])

  return (
    <SetCategoriesContext.Provider value={setStoreCategories}>
      <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
    </SetCategoriesContext.Provider>
  )
}

/** Keep localized category labels in sync with the persisted store list. */
export function useSyncCategories(categories: Category[]): void {
  const setStoreCategories = useContext(SetCategoriesContext)
  useEffect(() => {
    setStoreCategories(categories)
  }, [categories, setStoreCategories])
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) {
    throw new Error('useLocale must be used within LocaleProvider')
  }
  return ctx
}

export type { MessageKey, Locale }
