import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Monitor, Moon, Sun } from '@phosphor-icons/react'
import { useAppStore } from './hooks/useAppStore'
import { useLocale, useSyncCategories } from './hooks/useLocale'
import { useTheme } from './hooks/useTheme'
import { ImportDropzone } from './components/ImportDropzone'
import { Trends } from './components/Trends'
import { TransactionTable } from './components/TransactionTable'
import { AccountFilter } from './components/AccountFilter'
import { SettingsDialog } from './components/SettingsDialog'
import {
  clampRangeToData,
  compareMonths,
  dataMonthSpan,
  defaultMonthRange,
  rangesOverlap,
  selectableMonths,
  type MonthRange,
} from './lib/analytics'
import { filterTransactionsByAccount } from './lib/store'
import { translateError } from './lib/i18n'
import './App.css'

type Tab = 'trends' | 'transactions' | 'import'

export default function App() {
  const {
    store,
    loading,
    saving,
    error,
    lastImport,
    importFile,
    importGenericFile,
    updateCategory,
    addManual,
    removeTransaction,
    removeImport,
    renameAccount,
    reassignImport,
    addAccount,
    applyImportedStore,
    addCategory,
    updateCategoryDefinition,
    deleteCategory,
    resetCategories,
  } = useAppStore()
  const { t } = useLocale()
  const { preference, cycleTheme } = useTheme()
  useSyncCategories(store.categories)

  const [accountFilter, setAccountFilter] = useState<string[] | 'all'>('all')
  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const [periodRange, setPeriodRange] = useState<MonthRange | null>(null)
  const [tab, setTab] = useState<Tab>('trends')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mergeNotice, setMergeNotice] = useState<string | null>(null)

  const visibleTxs = useMemo(
    () => filterTransactionsByAccount(store.transactions, accountFilter),
    [store.transactions, accountFilter],
  )

  const months = useMemo(() => selectableMonths(visibleTxs), [visibleTxs])

  const activeRange = useMemo(() => {
    const span = dataMonthSpan(visibleTxs)
    if (!span) return null
    if (!periodRange || !rangesOverlap(periodRange, span)) {
      return defaultMonthRange(visibleTxs)
    }
    return clampRangeToData(periodRange, visibleTxs) ?? defaultMonthRange(visibleTxs)
  }, [visibleTxs, periodRange])

  const handlePeriodRangeChange = (next: MonthRange) => {
    const clamped = clampRangeToData(next, visibleTxs)
    if (!clamped) return
    setPeriodRange(clamped)
    setSelectedMonth((prev) => {
      const current = prev || clamped.to
      if (
        compareMonths(current, clamped.from) < 0 ||
        compareMonths(current, clamped.to) > 0
      ) {
        return clamped.to
      }
      return current
    })
  }

  const activeMonth =
    selectedMonth ||
    activeRange?.to ||
    months[0] ||
    format(new Date(), 'yyyy-MM')

  if (loading) {
    return (
      <div className="app-shell">
        <p className="muted">{t('app.loading')}</p>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="header-actions">
        <button
          type="button"
          className="header-action-btn"
          onClick={cycleTheme}
          title={t('app.theme.aria')}
          aria-label={t('app.theme.aria')}
        >
          {preference === 'system' ? (
            <Monitor aria-hidden="true" />
          ) : preference === 'light' ? (
            <Sun aria-hidden="true" />
          ) : (
            <Moon aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="header-action-btn"
          onClick={() => setSettingsOpen(true)}
          title={t('app.settingsTitle')}
        >
          {t('app.settings')}
        </button>
      </div>

      <header className="app-header">
        <div>
          <h1>Haushalt Analytics</h1>
          <p className="muted">
            {t('app.tagline')}
            {saving ? ` · ${t('app.saving')}` : ''}
          </p>
        </div>
        <div className="header-controls">
          <AccountFilter
            accounts={store.accounts}
            value={accountFilter}
            onChange={setAccountFilter}
          />
          <nav className="tabs">
            {(
              [
                ['trends', 'app.tab.trends'],
                ['transactions', 'app.tab.transactions'],
                ['import', 'app.tab.import'],
              ] as const
            ).map(([id, labelKey]) => (
              <button
                key={id}
                type="button"
                className={tab === id ? 'active' : ''}
                onClick={() => setTab(id)}
              >
                {t(labelKey)}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {store.isDemo && (
        <div className="banner demo-banner" role="status">
          <div>
            <strong>{t('app.demo.title')}</strong>
            <p>
              {t('app.demo.bodyBefore')}{' '}
              <button
                type="button"
                className="linkish inline-link"
                onClick={() => setTab('import')}
              >
                {t('app.tab.import')}
              </button>{' '}
              {t('app.demo.bodyAfter')}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="banner error-banner">
          {translateError(t, new Error(error))}
        </div>
      )}
      {mergeNotice && (
        <div className="banner success-banner">{mergeNotice}</div>
      )}

      <SettingsDialog
        open={settingsOpen}
        store={store}
        onClose={() => setSettingsOpen(false)}
        onApplyMerge={(merged) => {
          applyImportedStore(merged)
          setMergeNotice(t('app.mergeApplied'))
          window.setTimeout(() => setMergeNotice(null), 4000)
        }}
        onAddCategory={addCategory}
        onUpdateCategoryDefinition={updateCategoryDefinition}
        onDeleteCategory={deleteCategory}
        onResetCategories={resetCategories}
      />

      {tab === 'trends' && (
        <Trends
          transactions={visibleTxs}
          accounts={store.accounts}
          selectedMonth={activeMonth}
          onSelectMonth={setSelectedMonth}
          periodRange={
            activeRange ?? { from: activeMonth, to: activeMonth }
          }
          onPeriodRangeChange={handlePeriodRangeChange}
          onAddManual={addManual}
          onDeleteManual={removeTransaction}
          onUpdateCategory={updateCategory}
        />
      )}
      {tab === 'transactions' && (
        <TransactionTable
          transactions={visibleTxs}
          accounts={store.accounts}
          onUpdateCategory={updateCategory}
          onDeleteManual={removeTransaction}
        />
      )}
      {tab === 'import' && (
        <ImportDropzone
          accounts={store.accounts}
          imports={store.imports ?? []}
          transactions={store.transactions}
          isDemo={Boolean(store.isDemo)}
          onImport={importFile}
          onImportGeneric={importGenericFile}
          onDeleteImport={removeImport}
          onRenameAccount={renameAccount}
          onReassignImport={reassignImport}
          onAddAccount={addAccount}
          onUpdateCategory={updateCategory}
          lastImport={lastImport}
        />
      )}

      <footer className="app-footer">
        <p>{t('app.footer')}</p>
      </footer>
    </div>
  )
}
