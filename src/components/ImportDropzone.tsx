import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { format, parseISO } from 'date-fns'
import type { Account, CategoryId, ImportBatch, Transaction } from '../lib/types'
import {
  accountLabel,
  accountOptionLabel,
  detectCsvFormat,
  formatIban,
  type GenericImportInput,
} from '../lib/store'
import { readFileAsText } from '../lib/dkbParser'
import {
  analyzeCsv,
  isConfidentBankMapping,
  suggestMapping,
  type CsvAnalysis,
} from '../lib/genericCsvParser'
import { TransactionTable } from './TransactionTable'
import { CsvMappingDialog } from './CsvMappingDialog'
import { useLocale } from '../hooks/useLocale'
import { translateError } from '../lib/i18n'
import { llmSupported, type LlmProgress } from '../lib/llmCategorize'
import { LlmProgressBar } from './LlmProgressBar'

interface Props {
  accounts: Account[]
  imports: ImportBatch[]
  transactions: Transaction[]
  isDemo?: boolean
  onImport: (file: File) => Promise<{
    added: number
    duplicates: number
    accountId: string
    created?: boolean
  }>
  onImportGeneric: (input: GenericImportInput) => Promise<{
    added: number
    duplicates: number
    accountId: string
    created?: boolean
  }>
  onDeleteImport: (importId: string) => void
  onRenameAccount: (accountId: string, name: string) => void
  onDeleteAccount: (accountId: string) => void
  onReassignImport: (importId: string, accountId: string) => void
  onAddAccount: (input: {
    name: string
    iban: string
    bank?: string
  }) => string | null
  onUpdateCategory: (
    transactionId: string,
    categoryId: CategoryId,
    createMerchantRule?: boolean,
  ) => void
  llmBusy?: boolean
  llmProgress?: LlmProgress | null
  lastImport: {
    added: number
    duplicates: number
    accountId: string
    created?: boolean
    llmAssigned?: number
    llmProvider?: 'apple' | 'bundled'
  } | null
}

function sourceLabel(source: ImportBatch['source']): string {
  if (source === 'trade_republic') return 'Trade Republic'
  if (source === 'generic') return 'CSV'
  return 'DKB'
}

/** Uppercased extension for the not-a-CSV warning, e.g. "PDF". */
function fileExtension(file: File): string {
  const dot = file.name.lastIndexOf('.')
  if (dot > 0 && dot < file.name.length - 1) {
    return file.name.slice(dot + 1).toUpperCase()
  }
  return file.type || '?'
}

function formatImportedAt(iso: string): string {
  try {
    return format(parseISO(iso), 'dd.MM.yyyy HH:mm')
  } catch {
    return iso
  }
}

function formatTxDate(iso: string): string {
  try {
    return format(parseISO(iso), 'dd.MM.yyyy')
  } catch {
    return iso
  }
}

export function ImportDropzone({
  accounts,
  imports,
  transactions,
  isDemo = false,
  onImport,
  onImportGeneric,
  onDeleteImport,
  onRenameAccount,
  onDeleteAccount,
  onReassignImport,
  onAddAccount,
  onUpdateCategory,
  llmBusy = false,
  llmProgress = null,
  lastImport,
}: Props) {
  const { t } = useLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const localAiAvailable = useMemo(() => llmSupported(), [])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [importProgress, setImportProgress] = useState<{
    fileName: string
    index: number
    total: number
  } | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [notCsvFile, setNotCsvFile] = useState<{
    name: string
    ext: string
  } | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [pendingDeleteAccountId, setPendingDeleteAccountId] = useState<
    string | null
  >(null)
  const [pendingMappings, setPendingMappings] = useState<Array<{
    fileName: string
    text: string
    analysis: CsvAnalysis
    index: number
    total: number
  }>>([])
  const pendingMapping = pendingMappings[0] ?? null
  const [draftNames, setDraftNames] = useState<Record<string, string>>({})
  const [viewingImportId, setViewingImportId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'transactions' | 'csv'>(
    'transactions',
  )
  const [newAccountName, setNewAccountName] = useState('')
  const [newAccountIban, setNewAccountIban] = useState('')
  const [addAccountError, setAddAccountError] = useState<string | null>(null)

  const accountName = useMemo(() => {
    return (id: string) => accountLabel(accounts, id)
  }, [accounts])

  const bankAccounts = useMemo(
    () => accounts.filter((a) => a.id !== 'acc_manual'),
    [accounts],
  )

  const canReassignAccount = (accountId: string) =>
    bankAccounts.length > 1 || !bankAccounts.some((a) => a.id === accountId)

  const viewingBatch = useMemo(
    () => imports.find((b) => b.id === viewingImportId) ?? null,
    [imports, viewingImportId],
  )

  const viewingTxs = useMemo(() => {
    if (!viewingImportId) return []
    return transactions.filter((tx) => tx.importId === viewingImportId)
  }, [transactions, viewingImportId])

  const importPeriods = useMemo(() => {
    const map = new Map<string, { from: string; to: string }>()
    for (const tx of transactions) {
      if (!tx.importId) continue
      const existing = map.get(tx.importId)
      if (!existing) {
        map.set(tx.importId, { from: tx.date, to: tx.date })
        continue
      }
      if (tx.date < existing.from) existing.from = tx.date
      if (tx.date > existing.to) existing.to = tx.date
    }
    return map
  }, [transactions])

  const formatPeriod = (importId: string) => {
    const period = importPeriods.get(importId)
    if (!period) return t('import.period.none')
    if (period.from === period.to) return formatTxDate(period.from)
    return t('import.period.range', {
      from: formatTxDate(period.from),
      to: formatTxDate(period.to),
    })
  }

  useEffect(() => {
    if (viewingImportId && !imports.some((b) => b.id === viewingImportId)) {
      setViewingImportId(null)
    }
  }, [imports, viewingImportId])

  useEffect(() => {
    if (pendingDeleteId && !imports.some((b) => b.id === pendingDeleteId)) {
      setPendingDeleteId(null)
    }
  }, [imports, pendingDeleteId])

  useEffect(() => {
    if (
      pendingDeleteAccountId &&
      !bankAccounts.some((a) => a.id === pendingDeleteAccountId)
    ) {
      setPendingDeleteAccountId(null)
    }
  }, [bankAccounts, pendingDeleteAccountId])

  useEffect(() => {
    if (!viewingImportId || !viewRef.current) return
    viewRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [viewingImportId])

  const onPickFiles = async (files: File[]) => {
    if (files.length === 0) return
    setLocalError(null)
    setNotCsvFile(null)

    const csvFiles = files.filter(
      (file) =>
        file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv',
    )
    const invalidFile = files.find((file) => !csvFiles.includes(file))
    if (invalidFile) {
      setNotCsvFile({
        name: invalidFile.name,
        ext: fileExtension(invalidFile),
      })
    }
    if (csvFiles.length === 0) {
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    const mappings: typeof pendingMappings = []
    setBusy(true)
    try {
      for (let index = 0; index < csvFiles.length; index += 1) {
        const file = csvFiles[index]
        setImportProgress({
          fileName: file.name,
          index: index + 1,
          total: csvFiles.length,
        })
        const text = await readFileAsText(file)
        if (detectCsvFormat(text) === 'unknown') {
          const analysis = analyzeCsv(text)
          if (!analysis) {
            setLocalError(t('error.unreadableCsv'))
            continue
          }
          if (isConfidentBankMapping(analysis.columns)) {
            await onImportGeneric({
              fileName: file.name,
              text,
              mapping: suggestMapping(analysis.columns),
            })
            continue
          }
          mappings.push({
            fileName: file.name,
            text,
            analysis,
            index: index + 1,
            total: csvFiles.length,
          })
          continue
        }
        await onImport(file)
      }
    } catch (e) {
      setLocalError(translateError(t, e))
    } finally {
      if (mappings.length > 0) {
        setPendingMappings((current) => [...current, ...mappings])
      }
      setBusy(false)
      setImportProgress(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const confirmMapping = async (input: {
    mapping: GenericImportInput['mapping']
    accountId?: string
    accountName?: string
  }) => {
    if (!pendingMapping) return
    setBusy(true)
    setImportProgress({
      fileName: pendingMapping.fileName,
      index: pendingMapping.index,
      total: pendingMapping.total,
    })
    try {
      await onImportGeneric({
        fileName: pendingMapping.fileName,
        text: pendingMapping.text,
        mapping: input.mapping,
        accountId: input.accountId,
        accountName: input.accountName,
      })
      setPendingMappings((current) => current.slice(1))
    } finally {
      setBusy(false)
      setImportProgress(null)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void onPickFiles(Array.from(e.dataTransfer.files))
  }

  const lastAccount = lastImport
    ? accounts.find((a) => a.id === lastImport.accountId)
    : null

  const commitName = (accountId: string, currentName: string) => {
    const draft = draftNames[accountId]
    if (draft === undefined) return
    if (draft.trim() && draft.trim() !== currentName) {
      onRenameAccount(accountId, draft)
    }
    setDraftNames((prev) => {
      const next = { ...prev }
      delete next[accountId]
      return next
    })
  }

  // In-app confirm: window.confirm is a silent no-op on macOS Tauri WKWebView.
  const requestDelete = (batch: ImportBatch) => {
    setPendingDeleteAccountId(null)
    setPendingDeleteId(batch.id)
  }

  const cancelDelete = () => setPendingDeleteId(null)

  const confirmDelete = () => {
    if (!pendingDeleteId) return
    if (viewingImportId === pendingDeleteId) setViewingImportId(null)
    onDeleteImport(pendingDeleteId)
    setPendingDeleteId(null)
  }

  const pendingDeleteBatch = pendingDeleteId
    ? imports.find((b) => b.id === pendingDeleteId) ?? null
    : null

  const pendingDeleteAccount = pendingDeleteAccountId
    ? bankAccounts.find((a) => a.id === pendingDeleteAccountId) ?? null
    : null

  const confirmDeleteAccount = () => {
    if (!pendingDeleteAccountId) return
    if (viewingBatch?.accountId === pendingDeleteAccountId) {
      setViewingImportId(null)
    }
    onDeleteAccount(pendingDeleteAccountId)
    setDraftNames((prev) => {
      const next = { ...prev }
      delete next[pendingDeleteAccountId]
      return next
    })
    setPendingDeleteAccountId(null)
  }

  const openView = (batch: ImportBatch) => {
    setViewMode('transactions')
    setViewingImportId(batch.id)
  }

  const downloadCsv = (batch: ImportBatch) => {
    if (!batch.rawCsv) return
    const blob = new Blob([batch.rawCsv], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = batch.fileName || 'import.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const submitNewAccount = () => {
    const err = onAddAccount({
      name: newAccountName,
      iban: newAccountIban,
      bank: 'DKB',
    })
    if (err) {
      setAddAccountError(err)
      return
    }
    setAddAccountError(null)
    setNewAccountName('')
    setNewAccountIban('')
  }

  return (
    <>
      <section className="card import-card">
        <h2>{t('import.title')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t('import.intro')
            .split(/(DKB|Trade Republic)/g)
            .map((part, i) =>
              part === 'DKB' || part === 'Trade Republic' ? (
                <strong key={i}>{part}</strong>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
        </p>
        <p className="privacy-note">{t('import.privacy')}</p>
        {isDemo && (
          <p className="demo-import-hint">{t('import.demoHint')}</p>
        )}

        <div
          className={`dropzone ${dragging ? 'dragging' : ''} ${busy || llmBusy ? 'busy' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            hidden
            onChange={(e) =>
              void onPickFiles(Array.from(e.target.files ?? []))
            }
          />
          {busy || llmBusy ? (
            <div className="import-progress" role="status" aria-live="polite">
              <span className="import-spinner" aria-hidden="true" />
              <div>
                <p className="import-progress-title">
                  {llmBusy ? t('import.busyLlm') : t('import.busy')}
                </p>
                {importProgress && (
                  <p className="import-progress-file">
                    {t('import.progressFile', {
                      file: importProgress.fileName,
                      index: importProgress.index,
                      total: importProgress.total,
                    })}
                  </p>
                )}
                <p className="import-progress-detail">
                  {localAiAvailable
                    ? t('import.aiAvailable')
                    : t('import.aiUnavailable')}
                </p>
                {llmBusy && llmProgress && llmProgress.total > 0 ? (
                  <LlmProgressBar
                    done={llmProgress.done}
                    total={llmProgress.total}
                    label={t('import.llmProgress', {
                      done: llmProgress.done,
                      total: llmProgress.total,
                    })}
                  />
                ) : localAiAvailable ? (
                  <p className="import-progress-estimate">
                    {t('import.estimate')}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <p className="dropzone-title">
                {isDemo ? t('import.dropDemo') : t('import.drop')}
              </p>
              <p className="muted">{t('import.browse')}</p>
            </>
          )}
        </div>
        {localError && <p className="error">{localError}</p>}
        {notCsvFile && (
          <div className="import-warning" role="alert">
            <strong>{t('import.notCsv.title')}</strong>
            <p>
              {t('import.notCsv.body', {
                file: notCsvFile.name,
                ext: notCsvFile.ext,
              })}
            </p>
            <p className="import-warning-hint">{t('import.notCsv.hint')}</p>
          </div>
        )}
        {lastImport && lastAccount && (
          <p className="import-summary">
            {lastImport.created
              ? t('import.newAccount')
              : t('import.matchedAccount')}{' '}
            <strong>{lastAccount.name}</strong>
            {lastAccount.iban ? (
              <span className="muted"> · {formatIban(lastAccount.iban)}</span>
            ) : null}
            {' · '}
            {t('import.addedSkipped', {
              added: lastImport.added,
              duplicates: lastImport.duplicates,
            })}
            {lastImport.llmAssigned && lastImport.llmAssigned > 0
              ? ` ${t(
                  lastImport.llmProvider === 'apple'
                    ? 'import.llmAssignedApple'
                    : 'import.llmAssigned',
                  { count: lastImport.llmAssigned },
                )}`
              : null}
          </p>
        )}

        <div className="accounts-list">
          <h3>{t('import.accountsTitle')}</h3>
          {pendingDeleteAccount && (
            <div className="import-delete-confirm" role="alertdialog" aria-modal="true">
              <p>
                {t('import.confirmDeleteAccount', {
                  name: pendingDeleteAccount.name,
                })}
              </p>
              <div className="import-delete-confirm-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPendingDeleteAccountId(null)}
                >
                  {t('settings.cancel')}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={confirmDeleteAccount}
                >
                  {t('import.delete')}
                </button>
              </div>
            </div>
          )}
          {bankAccounts.length > 0 && (
            <ul className="account-name-list">
              {bankAccounts.map((a) => (
                <li key={a.id}>
                  <div className="account-name-row">
                    <input
                      type="text"
                      className="account-name-input"
                      value={draftNames[a.id] ?? a.name}
                      placeholder={t('import.accountPlaceholder')}
                      aria-label={t('import.accountNameAria', {
                        id: a.iban ?? a.bank,
                      })}
                      onChange={(e) =>
                        setDraftNames((prev) => ({
                          ...prev,
                          [a.id]: e.target.value,
                        }))
                      }
                      onBlur={() => commitName(a.id, a.name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          ;(e.target as HTMLInputElement).blur()
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="linkish danger"
                      aria-label={t('import.deleteAccountAria', {
                        name: a.name,
                      })}
                      onClick={() => {
                        setPendingDeleteId(null)
                        setPendingDeleteAccountId(a.id)
                      }}
                    >
                      {t('import.delete')}
                    </button>
                  </div>
                  <div className="muted small account-meta">
                    {a.bank}
                    {a.iban ? ` · ${formatIban(a.iban)}` : ''}
                    {a.fingerprint === 'broker:trade_republic'
                      ? ` · ${t('import.broker')}`
                      : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form
            className="add-account-form"
            onSubmit={(e) => {
              e.preventDefault()
              submitNewAccount()
            }}
          >
            <p className="muted small" style={{ margin: '0.75rem 0 0.4rem' }}>
              {t('import.addAccountIntro')}
            </p>
            <div className="add-account-row">
              <input
                type="text"
                className="account-name-input"
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder={t('import.accountPlaceholder')}
                aria-label={t('import.addAccountName')}
              />
              <input
                type="text"
                className="account-iban-input"
                value={newAccountIban}
                onChange={(e) => {
                  setNewAccountIban(e.target.value)
                  setAddAccountError(null)
                }}
                placeholder={t('import.addAccountIbanPlaceholder')}
                aria-label={t('import.addAccountIban')}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="submit" className="btn-secondary">
                {t('import.addAccount')}
              </button>
            </div>
            {addAccountError && <p className="error">{addAccountError}</p>}
          </form>
        </div>
      </section>

      <section className="card import-history-card">
        <h2>{t('import.history')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t('import.historyIntro')}
        </p>
        {pendingDeleteBatch && (
          <div className="import-delete-confirm" role="alertdialog" aria-modal="true">
            <p>
              {t(
                pendingDeleteBatch.addedCount === 1
                  ? 'import.confirmDelete'
                  : 'import.confirmDeletePlural',
                {
                  file: pendingDeleteBatch.fileName,
                  account: accountName(pendingDeleteBatch.accountId),
                  count: pendingDeleteBatch.addedCount,
                },
              )}
            </p>
            <div className="import-delete-confirm-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={cancelDelete}
              >
                {t('settings.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={confirmDelete}
              >
                {t('import.delete')}
              </button>
            </div>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('import.col.when')}</th>
                <th>{t('import.col.period')}</th>
                <th>{t('import.col.file')}</th>
                <th>{t('import.col.account')}</th>
                <th>{t('import.col.source')}</th>
                <th className="num">{t('import.col.added')}</th>
                <th className="num">{t('import.col.skipped')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {imports.map((batch) => (
                <tr
                  key={batch.id}
                  className={
                    viewingImportId === batch.id || pendingDeleteId === batch.id
                      ? 'import-row-active'
                      : undefined
                  }
                >
                  <td className="nowrap">{formatImportedAt(batch.importedAt)}</td>
                  <td className="nowrap">{formatPeriod(batch.id)}</td>
                  <td>
                    <strong title={batch.fileName}>{batch.fileName}</strong>
                  </td>
                  <td>
                    {canReassignAccount(batch.accountId) ? (
                      <select
                        className="import-account-select"
                        value={batch.accountId}
                        aria-label={t('import.accountFor', {
                          file: batch.fileName,
                        })}
                        onChange={(e) =>
                          onReassignImport(batch.id, e.target.value)
                        }
                      >
                        {!bankAccounts.some((a) => a.id === batch.accountId) && (
                          <option value={batch.accountId}>
                            {accountName(batch.accountId)}
                          </option>
                        )}
                        {bankAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {accountOptionLabel(a)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      accountName(batch.accountId)
                    )}
                  </td>
                  <td>{sourceLabel(batch.source)}</td>
                  <td className="num">{batch.addedCount}</td>
                  <td className="num">{batch.duplicateCount}</td>
                  <td className="import-row-actions">
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => openView(batch)}
                    >
                      {t('import.view')}
                    </button>
                    <button
                      type="button"
                      className="linkish danger"
                      onClick={() => requestDelete(batch)}
                    >
                      {t('import.delete')}
                    </button>
                  </td>
                </tr>
              ))}
              {imports.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {t('import.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {viewingBatch && (
        <div ref={viewRef} className="import-view">
          <div className="import-view-meta card">
            <div>
              <h2>{t('import.details')}</h2>
              <p className="muted import-view-meta-line">
                <strong title={viewingBatch.fileName}>
                  {viewingBatch.fileName}
                </strong>
                {' · '}
                {canReassignAccount(viewingBatch.accountId) ? (
                  <select
                    className="import-account-select"
                    value={viewingBatch.accountId}
                    aria-label={t('import.accountFor', {
                      file: viewingBatch.fileName,
                    })}
                    onChange={(e) =>
                      onReassignImport(viewingBatch.id, e.target.value)
                    }
                  >
                    {!bankAccounts.some(
                      (a) => a.id === viewingBatch.accountId,
                    ) && (
                      <option value={viewingBatch.accountId}>
                        {accountName(viewingBatch.accountId)}
                      </option>
                    )}
                    {bankAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {accountOptionLabel(a)}
                      </option>
                    ))}
                  </select>
                ) : (
                  accountName(viewingBatch.accountId)
                )}
                {' · '}
                {sourceLabel(viewingBatch.source)}
                {' · '}
                {formatImportedAt(viewingBatch.importedAt)}
                {' · '}
                {formatPeriod(viewingBatch.id)}
                {' · '}
                {viewingTxs.length === 1
                  ? t('import.txCount', { count: viewingTxs.length })
                  : t('import.txCountPlural', { count: viewingTxs.length })}
                {viewingTxs.length !== viewingBatch.addedCount
                  ? t('import.originallyAdded', {
                      count: viewingBatch.addedCount,
                    })
                  : ''}
              </p>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setViewingImportId(null)}
            >
              {t('import.close')}
            </button>
          </div>

          <div className="flow-tabs import-view-tabs">
            <button
              type="button"
              className={`flow-tab ${viewMode === 'transactions' ? 'active' : ''}`}
              onClick={() => setViewMode('transactions')}
            >
              {t('import.tab.transactions')}
            </button>
            <button
              type="button"
              className={`flow-tab ${viewMode === 'csv' ? 'active' : ''}`}
              onClick={() => setViewMode('csv')}
            >
              {t('import.tab.csv')}
            </button>
          </div>

          {viewMode === 'transactions' ? (
            <TransactionTable
              transactions={viewingTxs}
              accounts={accounts}
              onUpdateCategory={onUpdateCategory}
              title={t('import.importedTx')}
              id="import-transactions"
            />
          ) : (
            <section className="card import-csv-card">
              <div className="card-header">
                <h2>{t('import.originalCsv')}</h2>
                {viewingBatch.rawCsv ? (
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => downloadCsv(viewingBatch)}
                  >
                    {t('import.download')}
                  </button>
                ) : null}
              </div>
              {viewingBatch.rawCsv ? (
                <pre className="import-csv-pre">{viewingBatch.rawCsv}</pre>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  {t('import.csvMissing')}
                </p>
              )}
            </section>
          )}
        </div>
      )}

      <CsvMappingDialog
        open={pendingMapping !== null}
        fileName={pendingMapping?.fileName ?? ''}
        analysis={pendingMapping?.analysis ?? null}
        accounts={isDemo ? [] : bankAccounts}
        onCancel={() => setPendingMappings((current) => current.slice(1))}
        onConfirm={confirmMapping}
      />
    </>
  )
}
