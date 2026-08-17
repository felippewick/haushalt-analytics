import {
  AirplaneTilt,
  Baby,
  Bank,
  Briefcase,
  Car,
  ChartLineUp,
  CircleDashed,
  Coffee,
  DotsThree,
  FilmSlate,
  Gift,
  Heartbeat,
  House,
  Lightning,
  Money,
  Palette,
  PiggyBank,
  Question,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Tag,
  TShirt,
  WifiHigh,
  type Icon,
} from '@phosphor-icons/react'
import type { CategoryId } from '../lib/types'
import { getCategoryMap } from '../lib/categories'
import { CATEGORY_MAP as DEFAULT_CATEGORY_MAP } from '../lib/defaultRules'
import type { BuiltinCategoryId } from '../lib/types'

const CATEGORY_ICONS: Partial<Record<CategoryId, Icon>> &
  Record<BuiltinCategoryId, Icon> = {
  groceries: ShoppingCart,
  coffee_restaurants: Coffee,
  rent: House,
  clothing: TShirt,
  transport: Car,
  subscriptions: WifiHigh,
  insurance: Shield,
  health: Heartbeat,
  utilities: Lightning,
  shopping: ShoppingBag,
  gifts: Gift,
  entertainment: FilmSlate,
  hobbies: Palette,
  kids: Baby,
  travel: AirplaneTilt,
  reserves: PiggyBank,
  investments: ChartLineUp,
  securities: Bank,
  atm: Money,
  salary: Briefcase,
  excluded: CircleDashed,
  other: DotsThree,
  uncategorized: Question,
}

interface Props {
  categoryId: CategoryId
  size?: number
  className?: string
  /** When true, wrap in a tinted badge using the category color. */
  badge?: boolean
}

export function CategoryIcon({
  categoryId,
  size = 14,
  className = '',
  badge = false,
}: Props) {
  const Icon = CATEGORY_ICONS[categoryId] ?? Tag
  const color =
    getCategoryMap()[categoryId]?.color ??
    DEFAULT_CATEGORY_MAP[categoryId as BuiltinCategoryId]?.color ??
    '#94a3b8'

  if (badge) {
    return (
      <span
        className={`cat-icon-badge ${className}`.trim()}
        style={{
          color,
          background: `${color}24`,
        }}
        aria-hidden="true"
      >
        <Icon size={size} weight="bold" />
      </span>
    )
  }

  return (
    <Icon
      className={className}
      size={size}
      color={color}
      weight="bold"
      aria-hidden="true"
    />
  )
}
