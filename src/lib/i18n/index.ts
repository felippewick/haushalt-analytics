import { de } from './de'
import { en, type MessageKey } from './en'
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from './types'

export type { Locale, MessageKey }
export { DEFAULT_LOCALE, LOCALES, LOCALE_STORAGE_KEY, isLocale } from './types'
export { categoryLabel, CATEGORY_LABELS } from './categories'

const catalogs: Record<Locale, Record<MessageKey, string>> = {
  en,
  de,
}

export type TranslateFn = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string

export function createTranslator(locale: Locale): TranslateFn {
  const catalog = catalogs[locale] ?? catalogs.en
  return (key, params) => {
    let text = catalog[key] ?? catalogs.en[key] ?? key
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}

export function loadStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isLocale(raw)) return raw
  } catch {
    // ignore (SSR / privacy mode)
  }
  return DEFAULT_LOCALE
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // ignore
  }
}

/** Intl / date-fns BCP 47 tag for the UI locale. */
export function localeTag(locale: Locale): string {
  return locale === 'de' ? 'de-DE' : 'en-US'
}

export function translateError(
  t: TranslateFn,
  error: unknown,
  fallbackKey: MessageKey = 'error.importFailed',
): string {
  if (error instanceof Error) {
    const key = error.message
    if (key in catalogs.en) return t(key as MessageKey)
    return error.message
  }
  return t(fallbackKey)
}
