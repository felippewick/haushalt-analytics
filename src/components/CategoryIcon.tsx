import {
  Baby,
  Banknote,
  Briefcase,
  Car,
  CircleDashed,
  Clapperboard,
  Coffee,
  Gift,
  HeartPulse,
  HelpCircle,
  Home,
  Landmark,
  LineChart,
  MoreHorizontal,
  Palette,
  PiggyBank,
  Plane,
  Repeat,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Shirt,
  Tag,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { CategoryId } from '../lib/types'
import { getCategoryMap } from '../lib/categories'
import { CATEGORY_MAP as DEFAULT_CATEGORY_MAP } from '../lib/defaultRules'
import type { BuiltinCategoryId } from '../lib/types'

const CATEGORY_ICONS: Partial<Record<CategoryId, LucideIcon>> &
  Record<BuiltinCategoryId, LucideIcon> = {
  groceries: ShoppingCart,
  coffee_restaurants: Coffee,
  rent: Home,
  clothing: Shirt,
  transport: Car,
  subscriptions: Wifi,
  insurance: Shield,
  health: HeartPulse,
  utilities: Zap,
  shopping: ShoppingBag,
  gifts: Gift,
  entertainment: Clapperboard,
  hobbies: Palette,
  kids: Baby,
  travel: Plane,
  reserves: PiggyBank,
  investments: LineChart,
  securities: Landmark,
  atm: Banknote,
  salary: Briefcase,
  transfer: Repeat,
  excluded: CircleDashed,
  other: MoreHorizontal,
  uncategorized: HelpCircle,
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
          background: `${color}1a`,
        }}
        aria-hidden="true"
      >
        <Icon size={size} strokeWidth={2.25} />
      </span>
    )
  }

  return (
    <Icon
      className={className}
      size={size}
      color={color}
      strokeWidth={2.25}
      aria-hidden="true"
    />
  )
}
