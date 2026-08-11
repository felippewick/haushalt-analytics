import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { format, parseISO } from 'date-fns'
import type { Account, CategoryId, ImportBatch, Transaction } from '../lib/types'
import {
  accountLabel,
  accountOptionLabel,
  formatIban,
} from '../lib/store'
import { TransactionTable } from './TransactionTable'
import { useLocale } from '../hooks/useLocale'
import { translateError } from '../lib/i18n'

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
  onDeleteImport: (importId: string) => void
  onRenameAccount: (accountId: string, name: string) => void
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
  lastImport: {
    added: number
    duplicates: number
    accountId: string
    created?: boolean
  } | null
}

function sourceLabel(source: ImportBatch['source']): string {
  return source === 'trade_republic' ? 'Trade Republic' : 'DKB'
}

function formatImportedAt(iso: string): string {
  try {
    return format(parseISO(iso), 'dd.MM.yyyy HH:mm')
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
  onDeleteImport,
  onRenameAccount,
  onReassignImport,
  onAddAccount,
  onUpdateCategory,
  lastImport,
}: Props) {
  const { t } = useLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
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

  useEffect(() => {
    if (viewingImportId && !imports.some((b) => b.id === viewingImportId)) {
      setViewingImportId(null)
    }
  }, [imports, viewingImportId])

  useEffect(() => {
    if (!viewingImportId || !viewRef.current) return
    viewRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [viewingImportId])

  const onPickFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      setLocalError(t('error.csvOnly'))
      return
    }

    setLocalError(null)
    setBusy(true)
    try {
      await onImport(file)
    } catch (e) {
      setLocalError(translateError(t, e))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void onPickFile(e.dataTransfer.files[0])
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

  const confirmDelete = (batch: ImportBatch) => {
    const name = accountName(batch.accountId)
    const key =
      batch.addedCount === 1
        ? 'import.confirmDelete'
        : 'import.confirmDeletePlural'
    const ok = window.confirm(
      t(key, {
        file: batch.fileName,
        account: name,
        count: batch.addedCount,
      }),
    )
    if (ok) {
      if (viewingImportId === batch.id) setViewingImportId(null)
      onDeleteImport(batch.id)
    }
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
          className={`dropzone ${dragging ? 'dragging' : ''} ${busy ? 'busy' : ''}`}
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
            hidden
            onChange={(e) => void onPickFile(e.target.files?.[0])}
          />
          {busy ? (
            <p>{t('import.busy')}</p>
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
          </p>
        )}

        <div className="accounts-list">
          <h3>{t('import.accountsTitle')}</h3>
          {bankAccounts.length > 0 && (
            <ul className="account-name-list">
              {bankAccounts.map((a) => (
                <li key={a.id}>
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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('import.col.when')}</th>
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
                    viewingImportId === batch.id ? 'import-row-active' : undefined
                  }
                >
                  <td className="nowrap">{formatImportedAt(batch.importedAt)}</td>
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
                      onClick={() => confirmDelete(batch)}
                    >
                      {t('import.delete')}
                    </button>
                  </td>
                </tr>
              ))}
              {imports.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
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
    </>
  )
}
