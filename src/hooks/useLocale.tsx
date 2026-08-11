import { format, parseISO } from 'date-fns'
import { de as dateFnsDe } from 'date-fns/locale/de'
import { enUS as dateFnsEn } from 'date-fns/locale/en-US'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { isBuiltinCategory } from '../lib/categories'
import { CATEGORIES } from '../lib/defaultRules'
import {
  createTranslator,
  detectSystemLocale,
  categoryLabel as i18nCategoryLabel,
  loadStoredLocalePreference,
  type Locale,
  type LocalePreference,
  localeTag,
  type MessageKey,
  persistLocalePreference,
  resolveLocale,
  type TranslateFn,
} from '../lib/i18n'
import type { Category, CategoryId } from '../lib/types'

interface LocaleContextValue {
  /** Resolved UI language (never `system`). */
  locale: Locale
  /** Saved preference: follow device, or an explicit language. */
  preference: LocalePreference
  setLocale: (preference: LocalePreference) => void
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
  const [preference, setPreference] = useState<LocalePreference>(() =>
    loadStoredLocalePreference(),
  )
  const [systemLocale, setSystemLocale] = useState<Locale>(() =>
    detectSystemLocale(),
  )
  const [storeCategories, setStoreCategories] = useState<Category[] | null>(
    null,
  )

  useEffect(() => {
    const onLanguageChange = () => setSystemLocale(detectSystemLocale())
    window.addEventListener('languagechange', onLanguageChange)
    return () => window.removeEventListener('languagechange', onLanguageChange)
  }, [])

  const locale: Locale =
    preference === 'system' ? systemLocale : resolveLocale(preference)

  const setLocale = useCallback((next: LocalePreference) => {
    setPreference(next)
    persistLocalePreference(next)
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
      preference,
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
  }, [locale, preference, setLocale, storeCategories])

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

export type { Locale, LocalePreference, MessageKey }
