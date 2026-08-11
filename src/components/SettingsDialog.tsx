import { useEffect, useRef, useState } from 'react'
import type { AppStore, CategoryId } from '../lib/types'
import type { CategoryInput } from '../lib/categories'
import {
  downloadStoreJson,
  previewStoreFileMerge,
  type StoreMergePreview,
} from '../lib/storeMerge'
import { emptyStore } from '../lib/store'
import { useLocale } from '../hooks/useLocale'
import type { MessageKey } from '../lib/i18n'
import { translateError } from '../lib/i18n'
import { CategoryManager } from './CategoryManager'

interface Props {
  open: boolean
  store: AppStore
  onClose: () => void
  onApplyMerge: (merged: AppStore) => void
  onAddCategory: (input: CategoryInput) => void
  onUpdateCategoryDefinition: (
    categoryId: CategoryId,
    input: CategoryInput,
  ) => void
  onDeleteCategory: (categoryId: CategoryId) => void
  onResetCategories: () => void
}

type SettingsPane = 'menu' | 'language' | 'categories' | 'data'

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'add' | 'update' | 'skip' | 'warn'
}) {
  if (value <= 0) return null
  return (
    <li className={tone ? `merge-stat merge-stat-${tone}` : 'merge-stat'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </li>
  )
}

function StoreJsonText({ text }: { text: string }) {
  return (
    <>
      {text.split('store.json').map((part, i, arr) =>
        i < arr.length - 1 ? (
          <span key={i}>
            {part}
            <code>store.json</code>
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

export function SettingsDialog({
  open,
  store,
  onClose,
  onApplyMerge,
  onAddCategory,
  onUpdateCategoryDefinition,
  onDeleteCategory,
  onResetCategories,
}: Props) {
  const { t, locale, setLocale, categoryLabel } = useLocale()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pane, setPane] = useState<SettingsPane>('menu')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<StoreMergePreview | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setPane('menu')
      setBusy(false)
      setError(null)
      setPreview(null)
      setFileName(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [open])

  const resetPreview = () => {
    setPreview(null)
    setFileName(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const goBack = () => {
    resetPreview()
    setPane('menu')
  }

  const onExport = () => {
    downloadStoreJson(store)
  }

  const onPickFile = async (file: File | undefined) => {
    if (!file) return
    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.json') && file.type !== 'application/json') {
      setError(t('settings.selectJson'))
      return
    }

    setError(null)
    setBusy(true)
    setPreview(null)
    setFileName(file.name)
    try {
      const base = store.isDemo ? emptyStore() : store
      const result = await previewStoreFileMerge(base, file)
      setPreview(result)
    } catch (e) {
      setPreview(null)
      setError(translateError(t, e))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const onConfirm = () => {
    if (!preview?.hasChanges) return
    onApplyMerge(preview.merged)
    onClose()
  }

  const s = preview?.summary
  const title =
    pane === 'language'
      ? t('settings.language.title')
      : pane === 'categories'
        ? t('settings.categories.title')
        : pane === 'data'
          ? t('settings.data.title')
          : t('settings.title')

  const languageValue =
    locale === 'de' ? t('settings.language.de') : t('settings.language.en')

  const categoryCount = store.categories?.length ?? 0

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      onClose={onClose}
    >
      <div className="settings-dialog-inner">
        <header className="settings-dialog-header">
          <div className="settings-dialog-heading">
            {pane !== 'menu' && (
              <button
                type="button"
                className="settings-back"
                onClick={goBack}
              >
                ← {t('settings.back')}
              </button>
            )}
            <h2>{title}</h2>
          </div>
          <button type="button" className="linkish" onClick={onClose}>
            {t('settings.close')}
          </button>
        </header>

        {pane === 'menu' && (
          <div className="settings-pane">
            <p className="muted settings-intro">{t('settings.menu.intro')}</p>
            <nav className="settings-menu" aria-label={t('settings.title')}>
              <button
                type="button"
                className="settings-menu-item"
                onClick={() => setPane('language')}
              >
                <span className="settings-menu-text">
                  <span className="settings-menu-title">
                    {t('settings.menu.language')}
                  </span>
                  <span className="muted small settings-menu-desc">
                    {t('settings.menu.languageDesc')}
                  </span>
                </span>
                <span className="settings-menu-meta">
                  <span className="settings-menu-value">{languageValue}</span>
                  <span className="settings-menu-chevron" aria-hidden="true">
                    ›
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="settings-menu-item"
                onClick={() => setPane('categories')}
              >
                <span className="settings-menu-text">
                  <span className="settings-menu-title">
                    {t('settings.menu.categories')}
                  </span>
                  <span className="muted small settings-menu-desc">
                    {t('settings.menu.categoriesDesc')}
                  </span>
                </span>
                <span className="settings-menu-meta">
                  <span className="settings-menu-value">
                    {t('settings.menu.categoriesCount', {
                      count: categoryCount,
                    })}
                  </span>
                  <span className="settings-menu-chevron" aria-hidden="true">
                    ›
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="settings-menu-item"
                onClick={() => setPane('data')}
              >
                <span className="settings-menu-text">
                  <span className="settings-menu-title">
                    {t('settings.menu.data')}
                  </span>
                  <span className="muted small settings-menu-desc">
                    {t('settings.menu.dataDesc')}
                  </span>
                </span>
                <span className="settings-menu-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </nav>
          </div>
        )}

        {pane === 'language' && (
          <div className="settings-pane">
            <p className="muted settings-intro">
              {t('settings.language.detail')}
            </p>
            <fieldset className="settings-options">
              <legend className="settings-options-legend">
                {t('settings.language')}
              </legend>
              {(
                [
                  ['en', 'settings.language.en'],
                  ['de', 'settings.language.de'],
                ] as const
              ).map(([id, labelKey]) => (
                <label key={id} className="settings-option">
                  <input
                    type="radio"
                    name="settings-locale"
                    value={id}
                    checked={locale === id}
                    onChange={() => setLocale(id)}
                  />
                  <span>
                    <strong>{t(labelKey)}</strong>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="privacy-note">{t('settings.language.hint')}</p>
          </div>
        )}

        {pane === 'categories' && (
          <div className="settings-pane">
            <CategoryManager
              categories={store.categories}
              onAdd={onAddCategory}
              onUpdate={onUpdateCategoryDefinition}
              onDelete={onDeleteCategory}
              onReset={onResetCategories}
            />
          </div>
        )}

        {pane === 'data' && (
          <div className="settings-pane">
            <p className="muted settings-intro">
              <StoreJsonText text={t('settings.intro')} />
            </p>
            <p className="privacy-note">{t('settings.privacy')}</p>

            <section className="settings-actions">
              <button type="button" className="btn-primary" onClick={onExport}>
                {t('settings.export')}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                {busy ? t('settings.reading') : t('settings.import')}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => void onPickFile(e.target.files?.[0])}
              />
            </section>

            {error && <p className="error">{error}</p>}

            {preview && (
              <section className="merge-preview card">
                <div className="card-header">
                  <h3>
                    {t('settings.mergePreview')}
                    {fileName ? ` · ${fileName}` : ''}
                  </h3>
                  <button
                    type="button"
                    className="linkish"
                    onClick={resetPreview}
                  >
                    {t('settings.clear')}
                  </button>
                </div>

                {preview.warnings.map((w) => (
                  <p key={w} className="muted merge-warning">
                    {t(w as MessageKey)}
                  </p>
                ))}

                {s && (
                  <ul className="merge-stats">
                    <SummaryRow
                      label={t('settings.stat.accountsAdded')}
                      value={s.accountsAdded}
                      tone="add"
                    />
                    <SummaryRow
                      label={t('settings.stat.accountsMatched')}
                      value={s.accountsMatched}
                      tone="skip"
                    />
                    <SummaryRow
                      label={t('settings.stat.accountNameDiffs')}
                      value={s.accountNameDiffs}
                      tone="warn"
                    />
                    <SummaryRow
                      label={t('settings.stat.identityFilled')}
                      value={s.identityFilled}
                      tone="update"
                    />
                    <SummaryRow
                      label={t('settings.stat.transactionsAdded')}
                      value={s.transactionsAdded}
                      tone="add"
                    />
                    <SummaryRow
                      label={t('settings.stat.transactionsSkipped')}
                      value={s.transactionsSkippedSame}
                      tone="skip"
                    />
                    <SummaryRow
                      label={t('settings.stat.categoryOverrides')}
                      value={s.transactionsCategoryUpdated}
                      tone="update"
                    />
                    <SummaryRow
                      label={t('settings.stat.conflictsKept')}
                      value={s.transactionsConflictKeptLocal}
                      tone="warn"
                    />
                    <SummaryRow
                      label={t('settings.stat.rulesAdded')}
                      value={s.rulesAdded}
                      tone="add"
                    />
                    <SummaryRow
                      label={t('settings.stat.rulesUpdated')}
                      value={s.rulesUpdated}
                      tone="update"
                    />
                    <SummaryRow
                      label={t('settings.stat.rulesSkipped')}
                      value={s.rulesSkipped}
                      tone="skip"
                    />
                    <SummaryRow
                      label={t('settings.stat.importsAdded')}
                      value={s.importsAdded}
                      tone="add"
                    />
                    <SummaryRow
                      label={t('settings.stat.importsSkipped')}
                      value={s.importsSkipped}
                      tone="skip"
                    />
                    <SummaryRow
                      label={t('settings.stat.categoriesAdded')}
                      value={s.categoriesAdded}
                      tone="add"
                    />
                    <SummaryRow
                      label={t('settings.stat.categoriesUpdated')}
                      value={s.categoriesUpdated}
                      tone="update"
                    />
                  </ul>
                )}

                {preview.samples.accountNameDiffs.length > 0 && (
                  <details className="merge-details">
                    <summary>
                      {t('settings.accountNameDiffs', {
                        count: preview.summary.accountNameDiffs,
                      })}
                    </summary>
                    <ul>
                      {preview.samples.accountNameDiffs.map((d) => (
                        <li key={d.localId}>
                          <strong>{d.localName}</strong>
                          <span className="muted">
                            {' '}
                            {t('settings.keptIncoming')}{' '}
                          </span>
                          {d.incomingName}
                        </li>
                      ))}
                      {preview.summary.accountNameDiffs >
                        preview.samples.accountNameDiffs.length && (
                        <li className="muted">
                          {t('settings.andMore', {
                            count:
                              preview.summary.accountNameDiffs -
                              preview.samples.accountNameDiffs.length,
                          })}
                        </li>
                      )}
                    </ul>
                  </details>
                )}

                {preview.samples.categoryUpdates.length > 0 && (
                  <details className="merge-details">
                    <summary>
                      {t('settings.categoryUpdates', {
                        count: preview.summary.transactionsCategoryUpdated,
                      })}
                    </summary>
                    <ul>
                      {preview.samples.categoryUpdates.map((u) => (
                        <li key={u.transactionId}>
                          <span className="muted">{u.date}</span>{' '}
                          {u.counterparty || t('settings.noCounterparty')}
                          <span className="muted">
                            {' '}
                            · {categoryLabel(u.fromCategoryId)} →{' '}
                            {categoryLabel(u.toCategoryId)}
                          </span>
                        </li>
                      ))}
                      {preview.summary.transactionsCategoryUpdated >
                        preview.samples.categoryUpdates.length && (
                        <li className="muted">
                          {t('settings.andMore', {
                            count:
                              preview.summary.transactionsCategoryUpdated -
                              preview.samples.categoryUpdates.length,
                          })}
                        </li>
                      )}
                    </ul>
                  </details>
                )}

                <div className="merge-preview-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={resetPreview}
                  >
                    {t('settings.cancel')}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!preview.hasChanges}
                    onClick={onConfirm}
                  >
                    {preview.hasChanges
                      ? t('settings.applyMerge')
                      : t('settings.nothingToMerge')}
                  </button>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </dialog>
  )
}
