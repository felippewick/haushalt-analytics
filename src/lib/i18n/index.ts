import { de } from './de'
import { en, type MessageKey } from './en'
import {
  DEFAULT_LOCALE,
  isLocalePreference,
  LOCALE_STORAGE_KEY,
  type Locale,
  type LocalePreference,
} from './types'

export { CATEGORY_LABELS, categoryLabel } from './categories'
export {
  DEFAULT_LOCALE, isLocale,
  isLocalePreference, LOCALE_STORAGE_KEY, LOCALES
} from './types'
export type { Locale, LocalePreference, MessageKey }

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

/** Map the device language to a supported UI locale. */
export function detectSystemLocale(): Locale {
  const candidates: string[] = []
  try {
    if (typeof navigator !== 'undefined') {
      if (Array.isArray(navigator.languages)) {
        candidates.push(...navigator.languages)
      }
      if (navigator.language) candidates.push(navigator.language)
    }
  } catch {
    // ignore
  }

  for (const tag of candidates) {
    const primary = tag.trim().toLowerCase().split('-')[0]
    if (primary === 'de') return 'de'
    if (primary === 'en') return 'en'
  }
  return DEFAULT_LOCALE
}

export function resolveLocale(preference: LocalePreference): Locale {
  return preference === 'system' ? detectSystemLocale() : preference
}

export function loadStoredLocalePreference(): LocalePreference {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isLocalePreference(raw)) return raw
  } catch {
    // ignore (SSR / privacy mode)
  }
  return 'system'
}

export function persistLocalePreference(preference: LocalePreference): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, preference)
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
