export type Locale = 'en' | 'de'

/** Explicit language, or follow the device/OS language. */
export type LocalePreference = 'system' | Locale

export const LOCALES: Locale[] = ['en', 'de']

export const LOCALE_STORAGE_KEY = 'haushalt-locale'

/** Fallback when the device language is unsupported. */
export const DEFAULT_LOCALE: Locale = 'en'

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'de'
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'system' || isLocale(value)
}
