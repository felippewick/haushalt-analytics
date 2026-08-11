import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account } from '../lib/types'
import {
  mapCsvRows,
  suggestMapping,
  MAPPING_FIELDS,
  REQUIRED_MAPPING_FIELDS,
  type ColumnMapping,
  type CsvAnalysis,
  type MappingField,
} from '../lib/genericCsvParser'
import { accountOptionLabel } from '../lib/store'
import { useLocale } from '../hooks/useLocale'
import { translateError } from '../lib/i18n'
import type { MessageKey } from '../lib/i18n'

interface Props {
  open: boolean
  fileName: string
  analysis: CsvAnalysis | null
  /** Selectable existing accounts (demo accounts are excluded by the parent). */
  accounts: Account[]
  onCancel: () => void
  onConfirm: (input: {
    mapping: ColumnMapping
    accountId?: string
    accountName?: string
  }) => Promise<void>
}

const NEW_ACCOUNT = '__new__'
const IGNORE_COLUMN = ''

const FIELD_LABEL_KEYS: Record<MappingField, MessageKey> = {
  date: 'mapping.field.date',
  amount: 'mapping.field.amount',
  counterparty: 'mapping.field.counterparty',
  purpose: 'mapping.field.purpose',
  iban: 'mapping.field.iban',
}

/** First non-empty value of a column — helps verify a mapping choice. */
function sampleValue(
  rows: Array<Record<string, string>>,
  column: string | undefined,
): string {
  if (!column) return ''
  for (const row of rows.slice(0, 20)) {
    const value = (row[column] ?? '').trim().replace(/^"|"$/g, '')
    if (value) return value
  }
  return ''
}

export function CsvMappingDialog({
  open,
  fileName,
  analysis,
  accounts,
  onCancel,
  onConfirm,
}: Props) {
  const { t, formatEur } = useLocale()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [accountChoice, setAccountChoice] = useState<string>(NEW_ACCOUNT)
  const [accountName, setAccountName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (open) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  }, [open])

  // Fresh suggestions per file
  useEffect(() => {
    if (!open || !analysis) return
    setMapping(suggestMapping(analysis.columns))
    setAccountChoice(NEW_ACCOUNT)
    setAccountName(fileName.replace(/\.[^.]+$/, '').trim())
    setBusy(false)
    setError(null)
  }, [open, analysis, fileName])

  const preview = useMemo(() => {
    if (!analysis || !mapping.date || !mapping.amount) return null
    return mapCsvRows(analysis.rows, mapping)
  }, [analysis, mapping])

  const requiredMissing = REQUIRED_MAPPING_FIELDS.some((f) => !mapping[f])
  const validCount = preview?.rows.length ?? 0
  const canImport =
    !busy &&
    !requiredMissing &&
    validCount > 0 &&
    (accountChoice !== NEW_ACCOUNT || accountName.trim().length > 0)

  const setField = (field: MappingField, column: string) => {
    setMapping((prev) => {
      const next: ColumnMapping = { ...prev }
      if (column === IGNORE_COLUMN) {
        delete next[field]
        return next
      }
      // A column can only feed one field
      for (const other of MAPPING_FIELDS) {
        if (other !== field && next[other] === column) delete next[other]
      }
      next[field] = column
      return next
    })
    setError(null)
  }

  const submit = async () => {
    if (!canImport) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm({
        mapping,
        accountId: accountChoice !== NEW_ACCOUNT ? accountChoice : undefined,
        accountName:
          accountChoice === NEW_ACCOUNT ? accountName.trim() : undefined,
      })
    } catch (e) {
      setError(translateError(t, e))
      setBusy(false)
    }
  }

  if (!analysis) return null

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog csv-mapping-dialog"
      onClose={onCancel}
    >
      <div className="settings-dialog-inner">
        <header className="settings-dialog-header">
          <div className="settings-dialog-heading">
            <h2>{t('mapping.title')}</h2>
            <span className="muted small">
              {t('mapping.detected', {
                columns: analysis.columns.length,
                rows: analysis.rows.length,
              })}
            </span>
          </div>
          <button type="button" className="linkish" onClick={onCancel}>
            {t('import.close')}
          </button>
        </header>

        <p className="muted settings-intro">
          {t('mapping.intro', { file: fileName })}
        </p>

        <div className="mapping-fields">
          {MAPPING_FIELDS.map((field) => {
            const isRequired = (
              REQUIRED_MAPPING_FIELDS as readonly MappingField[]
            ).includes(field)
            const sample = sampleValue(analysis.rows, mapping[field])
            return (
              <label key={field} className="manual-field mapping-field">
                <span>
                  {t(FIELD_LABEL_KEYS[field])}
                  <span
                    className={
                      isRequired ? 'mapping-required' : 'mapping-optional'
                    }
                  >
                    {isRequired ? t('mapping.required') : t('mapping.optional')}
                  </span>
                </span>
                <select
                  value={mapping[field] ?? IGNORE_COLUMN}
                  onChange={(e) => setField(field, e.target.value)}
                >
                  <option value={IGNORE_COLUMN}>{t('mapping.ignore')}</option>
                  {analysis.columns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
                <span className="muted small mapping-sample">
                  {sample ? t('mapping.sample', { value: sample }) : '\u00A0'}
                </span>
              </label>
            )
          })}
        </div>

        <p className="muted small mapping-hint">{t('mapping.amountHint')}</p>

        <div className="mapping-account">
          <label className="manual-field">
            <span>{t('mapping.account')}</span>
            <select
              value={accountChoice}
              onChange={(e) => setAccountChoice(e.target.value)}
            >
              <option value={NEW_ACCOUNT}>{t('mapping.newAccount')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountOptionLabel(a)}
                </option>
              ))}
            </select>
          </label>
          {accountChoice === NEW_ACCOUNT && (
            <label className="manual-field">
              <span>{t('mapping.accountName')}</span>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder={t('mapping.accountNamePlaceholder')}
              />
            </label>
          )}
        </div>

        <div className="mapping-preview">
          <h3>{t('mapping.preview')}</h3>
          {requiredMissing ? (
            <p className="muted small">{t('mapping.chooseRequired')}</p>
          ) : validCount === 0 ? (
            <p className="error">{t('mapping.noValidRows')}</p>
          ) : (
            <>
              <p className="muted small">
                {t('mapping.previewStats', {
                  valid: validCount,
                  total: validCount + (preview?.skipped ?? 0),
                })}
              </p>
              <div className="table-wrap mapping-preview-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t('tx.col.date')}</th>
                      <th>{t('tx.col.counterparty')}</th>
                      <th>{t('tx.col.purpose')}</th>
                      <th className="num">{t('tx.col.amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview?.rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        <td className="nowrap">{row.date}</td>
                        <td>{row.counterparty || '—'}</td>
                        <td className="mapping-preview-purpose">
                          {row.purpose || '—'}
                        </td>
                        <td className="num">{formatEur(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        <div className="manual-dialog-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {t('mapping.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!canImport}
            onClick={() => void submit()}
          >
            {busy
              ? t('import.busy')
              : validCount === 1
                ? t('mapping.import', { count: validCount })
                : t('mapping.importPlural', { count: validCount })}
          </button>
        </div>
      </div>
    </dialog>
  )
}
