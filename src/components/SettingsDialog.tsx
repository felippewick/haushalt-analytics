import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../hooks/useLocale'
import type { CategoryInput } from '../lib/categories'
import type { MessageKey } from '../lib/i18n'
import { translateError } from '../lib/i18n'
import { withoutSampleDataset } from '../lib/store'
import {
  downloadStoreJson,
  previewStoreFileMerge,
  type StoreMergePreview,
} from '../lib/storeMerge'
import type { AppStore, CategoryId } from '../lib/types'
import type { AppUpdater } from '../hooks/useAppUpdater'
import { CategoryManager } from './CategoryManager'
import { LlmLabPanel, llmLabUnlocked, unlockLlmLab } from './LlmLabPanel'
import { llmSupported } from '../lib/llmCategorize'

interface Props {
  open: boolean
  store: AppStore
  updater: AppUpdater
  onClose: () => void
  onApplyMerge: (merged: AppStore) => void
  onDeleteAll: () => void
  onAddCategory: (input: CategoryInput) => void
  onUpdateCategoryDefinition: (
    categoryId: CategoryId,
    input: CategoryInput,
  ) => void
  onDeleteCategory: (categoryId: CategoryId) => void
  onResetCategories: () => void
}

type SettingsPane =
  | 'menu'
  | 'language'
  | 'categories'
  | 'updates'
  | 'data'
  | 'llmLab'

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

function matchesDeleteConfirm(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === 'delete' || normalized === 'löschen'
}

export function SettingsDialog({
  open,
  store,
  updater,
  onClose,
  onApplyMerge,
  onDeleteAll,
  onAddCategory,
  onUpdateCategoryDefinition,
  onDeleteCategory,
  onResetCategories,
}: Props) {
  const { t, preference, setLocale, categoryLabel } = useLocale()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pane, setPane] = useState<SettingsPane>('menu')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [preview, setPreview] = useState<StoreMergePreview | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)
  const [deleteAllConfirm, setDeleteAllConfirm] = useState('')
  const [labUnlocked, setLabUnlocked] = useState(llmLabUnlocked)
  const [labClicks, setLabClicks] = useState(0)

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
      setDeleteAllOpen(false)
      setDeleteAllConfirm('')
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [open])

  const resetPreview = () => {
    setPreview(null)
    setFileName(null)
    setError(null)
    setExportStatus(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const goBack = () => {
    resetPreview()
    setDeleteAllOpen(false)
    setDeleteAllConfirm('')
    setPane('menu')
  }

  const onExport = async () => {
    setError(null)
    setExportStatus(null)
    setExporting(true)
    try {
      const result = await downloadStoreJson(store)
      if (result === 'saved') setExportStatus(t('settings.exportDone'))
    } catch (e) {
      setError(translateError(t, e, 'error.exportFailed'))
    } finally {
      setExporting(false)
    }
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
      const base = withoutSampleDataset(store)
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

  const onConfirmDeleteAll = () => {
    if (!matchesDeleteConfirm(deleteAllConfirm)) return
    onDeleteAll()
    onClose()
  }

  const onLabSecretClick = () => {
    if (!llmSupported() || labUnlocked) return
    const next = labClicks + 1
    setLabClicks(next)
    if (next >= 5) {
      unlockLlmLab()
      setLabUnlocked(true)
    }
  }

  const s = preview?.summary
  const title =
    pane === 'language'
      ? t('settings.language.title')
      : pane === 'categories'
        ? t('settings.categories.title')
        : pane === 'updates'
          ? t('settings.updates.title')
          : pane === 'data'
            ? t('settings.data.title')
            : pane === 'llmLab'
              ? t('llmLab.title')
              : t('settings.title')

  const languageValue =
    preference === 'system'
      ? t('settings.language.system')
      : preference === 'de'
        ? t('settings.language.de')
        : t('settings.language.en')

  const categoryCount = store.categories?.length ?? 0

  return (
    <dialog
      ref={dialogRef}
      className={`settings-dialog${pane === 'llmLab' ? ' settings-dialog--lab' : ''}`}
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
            <h2 onClick={onLabSecretClick}>{title}</h2>
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
              {updater.enabled && (
                <button
                  type="button"
                  className="settings-menu-item"
                  onClick={() => setPane('updates')}
                >
                  <span className="settings-menu-text">
                    <span className="settings-menu-title">
                      {t('settings.menu.updates')}
                    </span>
                    <span className="muted small settings-menu-desc">
                      {t('settings.menu.updatesDesc')}
                    </span>
                  </span>
                  <span className="settings-menu-meta">
                    <span className="settings-menu-value">
                      {updater.status === 'available' && updater.availableVersion
                        ? t('settings.menu.updatesAvailable')
                        : updater.currentVersion || '—'}
                    </span>
                    <span className="settings-menu-chevron" aria-hidden="true">
                      ›
                    </span>
                  </span>
                </button>
              )}
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
              {labUnlocked && (
                <button
                  type="button"
                  className="settings-menu-item"
                  onClick={() => setPane('llmLab')}
                >
                  <span className="settings-menu-text">
                    <span className="settings-menu-title">
                      {t('llmLab.title')}
                    </span>
                    <span className="muted small settings-menu-desc">
                      {t('llmLab.menuDesc')}
                    </span>
                  </span>
                  <span className="settings-menu-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              )}
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
                  ['system', 'settings.language.system'],
                  ['en', 'settings.language.en'],
                  ['de', 'settings.language.de'],
                ] as const
              ).map(([id, labelKey]) => (
                <label key={id} className="settings-option">
                  <input
                    type="radio"
                    name="settings-locale"
                    value={id}
                    checked={preference === id}
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

        {pane === 'llmLab' && (
          <div className="settings-pane">
            <LlmLabPanel store={store} />
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

        {pane === 'updates' && (
          <div className="settings-pane">
            <p className="muted settings-intro">
              {t('settings.updates.detail')}
            </p>
            <p className="settings-updates-version">
              {t('settings.updates.current')}
              {': '}
              <strong
                onClick={onLabSecretClick}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onLabSecretClick()
                }}
              >
                {updater.currentVersion || '—'}
              </strong>
            </p>
            {updater.status === 'checking' && (
              <p className="muted">{t('settings.updates.checking')}</p>
            )}
            {updater.status === 'upToDate' && (
              <p>{t('settings.updates.upToDate')}</p>
            )}
            {updater.status === 'available' && updater.availableVersion && (
              <p>
                {t('settings.updates.available', {
                  version: updater.availableVersion,
                })}
              </p>
            )}
            {updater.status === 'downloading' && (
              <p>
                {updater.progressPercent != null
                  ? t('settings.updates.downloading', {
                      percent: updater.progressPercent,
                    })
                  : t('settings.updates.downloadingUnknown')}
              </p>
            )}
            {updater.status === 'restarting' && (
              <p>{t('settings.updates.restarting')}</p>
            )}
            {updater.status === 'dev' && (
              <p className="muted">{t('settings.updates.dev')}</p>
            )}
            {updater.status === 'error' && (
              <p className="error">
                {t('settings.updates.error')}
                {updater.error ? ` ${updater.error}` : ''}
              </p>
            )}
            {updater.status === 'downloading' && (
              <div
                className="settings-update-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={updater.progressPercent ?? undefined}
              >
                <div
                  className="settings-update-progress-bar"
                  style={{
                    width: `${updater.progressPercent ?? 15}%`,
                  }}
                />
              </div>
            )}
            <section className="settings-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={
                  updater.status === 'checking' ||
                  updater.status === 'downloading' ||
                  updater.status === 'restarting'
                }
                onClick={() => void updater.checkForUpdate()}
              >
                {t('settings.updates.check')}
              </button>
              {updater.status === 'available' && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void updater.installAndRelaunch()}
                >
                  {t('settings.updates.install')}
                </button>
              )}
            </section>
          </div>
        )}

        {pane === 'data' && (
          <div className="settings-pane">
            <p className="muted settings-intro">
              <StoreJsonText text={t('settings.intro')} />
            </p>
            <p className="privacy-note">{t('settings.privacy')}</p>

            <section className="settings-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={busy || exporting}
                onClick={() => void onExport()}
              >
                {exporting ? t('settings.exporting') : t('settings.export')}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || exporting}
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

            {exportStatus && <p className="muted">{exportStatus}</p>}
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

            <section className="settings-danger">
              <h3>{t('settings.deleteAll')}</h3>
              <p className="muted settings-intro">{t('settings.deleteAllIntro')}</p>
              {deleteAllOpen ? (
                <form
                  className="import-delete-confirm"
                  onSubmit={(e) => {
                    e.preventDefault()
                    onConfirmDeleteAll()
                  }}
                >
                  <p>{t('settings.deleteAllHint')}</p>
                  <input
                    type="text"
                    className="settings-confirm-input"
                    value={deleteAllConfirm}
                    onChange={(e) => setDeleteAllConfirm(e.target.value)}
                    placeholder={t('settings.deleteAllPlaceholder')}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label={t('settings.deleteAllHint')}
                  />
                  <div className="import-delete-confirm-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setDeleteAllOpen(false)
                        setDeleteAllConfirm('')
                      }}
                    >
                      {t('settings.cancel')}
                    </button>
                    <button
                      type="submit"
                      className="btn-danger"
                      disabled={!matchesDeleteConfirm(deleteAllConfirm)}
                    >
                      {t('settings.deleteAllConfirm')}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setDeleteAllOpen(true)}
                >
                  {t('settings.deleteAll')}
                </button>
              )}
            </section>
          </div>
        )}
      </div>
    </dialog>
  )
}
