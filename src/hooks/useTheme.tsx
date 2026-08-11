import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'haushalt-theme'
const CYCLE: ThemePreference[] = ['system', 'light', 'dark']

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

function loadStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (isPreference(raw)) return raw
  } catch {
    // ignore (privacy mode)
  }
  return 'system'
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

/** Colors for Recharts internals, which can't consume CSS variables. */
export const CHART_THEMES: Record<
  ResolvedTheme,
  {
    grid: string
    axis: string
    tick: string
    label: string
    reference: string
    line: string
    legend: string
    pieStroke: string
    tooltipBg: string
    tooltipBorder: string
    tooltipText: string
  }
> = {
  dark: {
    grid: 'rgba(255, 255, 255, 0.07)',
    axis: 'rgba(255, 255, 255, 0.12)',
    tick: '#9b9b9b',
    label: '#ffffff',
    reference: '#9b9b9b',
    line: '#ffffff',
    legend: '#9b9b9b',
    pieStroke: '#1f1f1f',
    tooltipBg: '#272727',
    tooltipBorder: 'rgba(255, 255, 255, 0.16)',
    tooltipText: '#ffffff',
  },
  light: {
    grid: 'rgba(0, 0, 0, 0.07)',
    axis: 'rgba(0, 0, 0, 0.14)',
    tick: '#666666',
    label: '#000000',
    reference: '#666666',
    line: '#000000',
    legend: '#666666',
    pieStroke: '#ffffff',
    tooltipBg: '#ffffff',
    tooltipBorder: 'rgba(0, 0, 0, 0.14)',
    tooltipText: '#000000',
  },
}

interface ThemeContextValue {
  preference: ThemePreference
  resolved: ResolvedTheme
  cycleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    loadStoredPreference(),
  )
  const [system, setSystem] = useState<ResolvedTheme>(() => systemTheme())

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setSystem(query.matches ? 'light' : 'dark')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedTheme =
    preference === 'system' ? system : preference

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'light' ? '#f4f4f4' : '#181818')
  }, [resolved])

  const cycleTheme = useCallback(() => {
    setPreference((current) => {
      const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next)
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ preference, resolved, cycleTheme }),
    [preference, resolved, cycleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return ctx
}
