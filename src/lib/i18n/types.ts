export type Locale = 'en' | 'de'

export const LOCALES: Locale[] = ['en', 'de']

export const LOCALE_STORAGE_KEY = 'haushalt-locale'

export const DEFAULT_LOCALE: Locale = 'en'

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'de'
}
