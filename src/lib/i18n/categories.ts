import type { BuiltinCategoryId, CategoryId } from '../types'
import type { Locale } from './types'

export const CATEGORY_LABELS: Record<
  Locale,
  Record<BuiltinCategoryId, string>
> = {
  en: {
    groceries: 'Groceries',
    coffee_restaurants: 'Coffee & Restaurants',
    rent: 'Rent',
    clothing: 'Clothing',
    transport: 'Transport',
    subscriptions: 'Subscriptions',
    insurance: 'Insurance',
    health: 'Health',
    utilities: 'Utilities',
    shopping: 'Shopping',
    gifts: 'Gifts',
    entertainment: 'Entertainment',
    hobbies: 'Hobbies',
    kids: 'Kids',
    travel: 'Travel',
    reserves: 'Reserves (Rücklagen)',
    investments: 'Investments (dividends)',
    securities: 'Securities (buys/sells)',
    atm: 'ATM / Cash',
    salary: 'Salary',
    excluded: 'Excluded',
    other: 'Other',
    uncategorized: 'Uncategorized',
  },
  de: {
    groceries: 'Lebensmittel',
    coffee_restaurants: 'Café & Restaurants',
    rent: 'Miete',
    clothing: 'Kleidung',
    transport: 'Transport',
    subscriptions: 'Abos',
    insurance: 'Versicherung',
    health: 'Gesundheit',
    utilities: 'Nebenkosten',
    shopping: 'Shopping',
    gifts: 'Geschenke',
    entertainment: 'Freizeit',
    hobbies: 'Hobbys',
    kids: 'Kinder',
    travel: 'Reisen',
    reserves: 'Rücklagen',
    investments: 'Investitionen (Dividenden)',
    securities: 'Wertpapiere (Kauf/Verkauf)',
    atm: 'Geldautomat / Bargeld',
    salary: 'Gehalt',
    excluded: 'Ausgeschlossen',
    other: 'Sonstiges',
    uncategorized: 'Unkategorisiert',
  },
}

export function categoryLabel(id: CategoryId, locale: Locale): string {
  const labels = CATEGORY_LABELS[locale] as Record<string, string | undefined>
  const en = CATEGORY_LABELS.en as Record<string, string | undefined>
  return labels[id] ?? en[id] ?? id
}
