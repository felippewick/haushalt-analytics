import { CATEGORIES, CATEGORY_MAP as DEFAULT_CATEGORY_MAP } from './defaultRules'
import type { Category, CategoryId } from './types'

/** System category that cannot be deleted (fallback for unassigned txs). */
export const PROTECTED_CATEGORY_IDS = new Set<CategoryId>(['uncategorized'])

/** Removed builtins → replacement. Applied on hydrate so old stores keep working. */
const RETIRED_CATEGORY_IDS: Record<string, CategoryId> = {
  transfer: 'excluded',
  refunds: 'other',
  sales: 'other',
}

export function remapRetiredCategoryId(id: CategoryId): CategoryId {
  return RETIRED_CATEGORY_IDS[id] ?? id
}

export const BUILTIN_CATEGORY_IDS = new Set<CategoryId>(
  CATEGORIES.map((c) => c.id),
)

export const CATEGORY_COLOR_PRESETS = [
  '#22c55e',
  '#f97316',
  '#8b5cf6',
  '#ec4899',
  '#3b82f6',
  '#06b6d4',
  '#14b8a6',
  '#eab308',
  '#a855f7',
  '#f43f5e',
  '#84cc16',
  '#0ea5e9',
  '#7c3aed',
  '#059669',
  '#78716c',
  '#6b7280',
] as const

let activeCategories: Category[] = CATEGORIES.map((c) => ({ ...c }))
let activeMap: Record<string, Category> = { ...DEFAULT_CATEGORY_MAP }

/** Keep lib helpers (categorize / analytics) in sync with the store list. */
export function syncCategoryRegistry(categories: Category[] | undefined | null): void {
  activeCategories =
    categories && categories.length > 0
      ? categories.map((c) => ({ ...c }))
      : CATEGORIES.map((c) => ({ ...c }))
  activeMap = Object.fromEntries(activeCategories.map((c) => [c.id, c]))
}

export function getCategories(): Category[] {
  return activeCategories
}

export function getCategoryMap(): Record<string, Category> {
  return activeMap
}

export function getCategory(id: CategoryId): Category | undefined {
  return activeMap[id]
}

export function cloneDefaultCategories(): Category[] {
  return CATEGORIES.map((c) => ({ ...c }))
}

export function normalizeCategories(
  raw: Category[] | undefined | null,
): Category[] {
  if (!Array.isArray(raw) || raw.length === 0) return cloneDefaultCategories()

  const seen = new Set<string>()
  const normalized: Category[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id || seen.has(id)) continue
    if (id in RETIRED_CATEGORY_IDS) continue
    seen.add(id)

    const label =
      typeof item.label === 'string' && item.label.trim()
        ? item.label.trim()
        : id
    const color =
      typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color)
        ? item.color
        : '#6b7280'

    const cat: Category = { id, label, color }
    if (item.isIncome) cat.isIncome = true
    if (item.excludeFromTotals) cat.excludeFromTotals = true
    if (
      typeof item.labelOverride === 'string' &&
      item.labelOverride.trim()
    ) {
      cat.labelOverride = item.labelOverride.trim()
    }
    normalized.push(cat)
  }

  if (!seen.has('other')) {
    const fallback = CATEGORIES.find((c) => c.id === 'other')
    if (fallback) {
      seen.add('other')
      normalized.push({ ...fallback })
    }
  }

  if (!seen.has('excluded')) {
    const fallback = CATEGORIES.find((c) => c.id === 'excluded')
    if (fallback) {
      seen.add('excluded')
      normalized.push({ ...fallback })
    }
  }

  if (!seen.has('uncategorized')) {
    const fallback = CATEGORIES.find((c) => c.id === 'uncategorized')!
    normalized.push({ ...fallback })
  }

  return normalized.length > 0 ? normalized : cloneDefaultCategories()
}

export function categoriesEqual(a: Category[], b: Category[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.id !== y.id ||
      x.label !== y.label ||
      x.color !== y.color ||
      Boolean(x.isIncome) !== Boolean(y.isIncome) ||
      Boolean(x.excludeFromTotals) !== Boolean(y.excludeFromTotals) ||
      (x.labelOverride ?? '') !== (y.labelOverride ?? '')
    ) {
      return false
    }
  }
  return true
}

export function isBuiltinCategory(id: CategoryId): boolean {
  return BUILTIN_CATEGORY_IDS.has(id)
}

export function canDeleteCategory(id: CategoryId): boolean {
  return !PROTECTED_CATEGORY_IDS.has(id)
}

export function slugifyCategoryId(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
  return base || 'category'
}

export function uniqueCategoryId(
  name: string,
  existing: Iterable<CategoryId>,
): CategoryId {
  const taken = new Set(existing)
  const base = slugifyCategoryId(name)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

export type CategoryKind = 'expense' | 'income' | 'excluded'

export function categoryKind(cat: Category): CategoryKind {
  if (cat.excludeFromTotals) return 'excluded'
  if (cat.isIncome) return 'income'
  return 'expense'
}

/** Picker / filter columns. Expense includes Sonstige and Unkategorisiert. */
export function groupedCategories(categories: Category[]): {
  expenses: Category[]
  income: Category[]
  excluded: Category[]
} {
  return {
    expenses: categories.filter((c) => categoryKind(c) === 'expense'),
    income: categories.filter((c) => categoryKind(c) === 'income'),
    excluded: categories.filter((c) => categoryKind(c) === 'excluded'),
  }
}

export function applyCategoryKind(
  cat: Category,
  kind: CategoryKind,
): Category {
  const next = { ...cat }
  delete next.isIncome
  delete next.excludeFromTotals
  if (kind === 'income') next.isIncome = true
  if (kind === 'excluded') next.excludeFromTotals = true
  return next
}

export interface CategoryInput {
  label: string
  color: string
  kind: CategoryKind
  /** When editing a builtin, empty string clears the override (back to i18n). */
  labelOverride?: string | null
}
