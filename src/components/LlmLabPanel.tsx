import { useMemo, useState } from 'react'
import type { AppStore } from '../lib/types'
import {
  categorizeLlmDebug,
  getLlmStatus,
  llmSupported,
  type LlmDebugResult,
} from '../lib/llmCategorize'
import { buildLlmSystemPrompt, buildLlmUserPrompt, llmCategorySpecs } from '../lib/llmHints'
import { useLocale } from '../hooks/useLocale'
import type { TranslateFn } from '../lib/i18n'
import type { CategoryId } from '../lib/types'

interface Props {
  store: AppStore
}

const LAB_EXAMPLE = {
  counterparty: 'UKAS Baecker Grieser',
  purpose: 'Kartenzahlung',
  bookingType: 'Ausgang',
  amount: -8.4,
}

export function LlmLabPanel({ store }: Props) {
  const { t, categoryLabel, formatEur } = useLocale()
  const categories = store.categories ?? []
  const [counterparty, setCounterparty] = useState(LAB_EXAMPLE.counterparty)
  const [purpose, setPurpose] = useState(LAB_EXAMPLE.purpose)
  const [bookingType, setBookingType] = useState(LAB_EXAMPLE.bookingType)
  const [amount, setAmount] = useState(String(LAB_EXAMPLE.amount))
  const cashflow = (Number(amount) || 0) >= 0 ? 'in' : 'out'
  const specs = useMemo(
    () => llmCategorySpecs(categories, cashflow),
    [categories, cashflow],
  )
  const defaultPrompt = useMemo(
    () => buildLlmSystemPrompt(specs, cashflow),
    [specs, cashflow],
  )

  const uncategorized = useMemo(
    () =>
      store.transactions.filter(
        (tx) => !tx.categoryOverride && tx.categoryId === 'uncategorized',
      ),
    [store.transactions],
  )

  const [systemPrompt, setSystemPrompt] = useState(defaultPrompt)
  const [busy, setBusy] = useState<'apple' | 'bundled' | 'both' | null>(null)
  const [apple, setApple] = useState<LlmDebugResult | null>(null)
  const [bundled, setBundled] = useState<LlmDebugResult | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const userPrompt = buildLlmUserPrompt({
    counterparty,
    purpose,
    bookingType,
    amount: Number(amount) || 0,
  })

  const run = async (mode: 'apple' | 'bundled' | 'both') => {
    setBusy(mode)
    setStatus(null)
    const payload = {
      counterparty,
      purpose,
      bookingType,
      amount: Number(amount) || 0,
      categories,
      systemPrompt,
    }
    try {
      if (mode === 'apple' || mode === 'both') {
        setApple(await categorizeLlmDebug({ ...payload, provider: 'apple' }))
      }
      if (mode === 'bundled' || mode === 'both') {
        setBundled(await categorizeLlmDebug({ ...payload, provider: 'bundled' }))
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const loadTx = (id: string) => {
    const tx = store.transactions.find((t) => t.id === id)
    if (!tx) return
    setCounterparty(tx.counterparty)
    setPurpose(tx.purpose)
    setBookingType(tx.type)
    setAmount(String(tx.amount))
  }

  return (
    <div className="llm-lab">
      <p className="muted settings-intro">{t('llmLab.intro')}</p>
      <p className="privacy-note">{t('llmLab.privacy')}</p>

      <label className="manual-field">
        <span>{t('llmLab.sample')}</span>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) loadTx(e.target.value)
          }}
        >
          <option value="">{t('llmLab.samplePlaceholder')}</option>
          {uncategorized.slice(0, 80).map((tx) => (
            <option key={tx.id} value={tx.id}>
              {tx.counterparty || t('tx.transaction')} · {formatEur(tx.amount)}
            </option>
          ))}
        </select>
      </label>

      <div className="llm-lab-fields">
        <label className="manual-field">
          <span>{t('tx.col.counterparty')}</span>
          <input
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
          />
        </label>
        <label className="manual-field">
          <span>{t('tx.col.purpose')}</span>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <label className="manual-field">
          <span>{t('tx.col.bookingType')}</span>
          <input
            value={bookingType}
            onChange={(e) => setBookingType(e.target.value)}
          />
        </label>
        <label className="manual-field">
          <span>{t('tx.col.amount')}</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
      </div>

      <label className="manual-field">
        <span>{t('llmLab.systemPrompt')}</span>
        <textarea
          className="llm-lab-prompt"
          rows={14}
          spellCheck={false}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </label>
      <div className="llm-lab-prompt-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setSystemPrompt(defaultPrompt)}
        >
          {t('llmLab.resetPrompt')}
        </button>
      </div>

      <label className="manual-field">
        <span>{t('llmLab.userPrompt')}</span>
        <pre className="llm-lab-pre">{userPrompt}</pre>
      </label>

      <div className="manual-dialog-actions">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => void run('apple')}
        >
          {busy === 'apple' ? t('llmLab.running') : t('llmLab.runApple')}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => void run('bundled')}
        >
          {busy === 'bundled' ? t('llmLab.running') : t('llmLab.runBundled')}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy !== null}
          onClick={() => void run('both')}
        >
          {busy === 'both' ? t('llmLab.running') : t('llmLab.runBoth')}
        </button>
        <button
          type="button"
          className="linkish"
          disabled={busy !== null}
          onClick={() => {
            void getLlmStatus().then((s) => {
              if (!s) {
                setStatus(t('llmLab.statusUnknown'))
                return
              }
              setStatus(
                `${s.provider} · ${s.model || '—'} · ${s.available ? t('llmLab.available') : t('llmLab.unavailable')}`,
              )
            })
          }}
        >
          {t('llmLab.status')}
        </button>
      </div>
      {status && <p className="muted small">{status}</p>}

      <div className="llm-lab-results">
        <DebugCard
          title={t('llmLab.apple')}
          result={apple}
          categoryLabel={categoryLabel}
          t={t}
        />
        <DebugCard
          title={t('llmLab.bundled')}
          result={bundled}
          categoryLabel={categoryLabel}
          t={t}
        />
      </div>
    </div>
  )
}

function DebugCard({
  title,
  result,
  categoryLabel,
  t,
}: {
  title: string
  result: LlmDebugResult | null
  categoryLabel: (id: CategoryId) => string
  t: TranslateFn
}) {
  if (!result) {
    return (
      <section className="llm-lab-card">
        <h3>{title}</h3>
        <p className="muted">{t('llmLab.noResult')}</p>
      </section>
    )
  }
  return (
    <section className="llm-lab-card">
      <h3>{title}</h3>
      <p className="llm-lab-verdict">
        {result.categoryId ? (
          <strong>
            {result.categoryId} · {categoryLabel(result.categoryId as CategoryId)}
          </strong>
        ) : (
          <span className="toolbar-ai-status--fail">—</span>
        )}
        <span className="muted small">
          {t('llmLab.ms', { ms: result.elapsedMs })}
        </span>
      </p>
      {result.error && <p className="muted small">{result.error}</p>}
      <span className="muted small">{t('llmLab.raw')}</span>
      <pre className="llm-lab-pre">{result.raw || '—'}</pre>
      <span className="muted small">{t('llmLab.enginePrompt')}</span>
      <pre className="llm-lab-pre llm-lab-pre--prompt">{result.prompt}</pre>
    </section>
  )
}

export function llmLabUnlocked(): boolean {
  if (!llmSupported()) return false
  try {
    return sessionStorage.getItem('uebrig.llmLab') === '1'
  } catch {
    return false
  }
}

export function unlockLlmLab(): void {
  try {
    sessionStorage.setItem('uebrig.llmLab', '1')
  } catch {
    // ignore
  }
}
