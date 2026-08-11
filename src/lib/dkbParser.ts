/**
 * DKB Girokonto CSV parser.
 *
 * Handles the post-2023 export format:
 * - Semicolon-delimited
 * - ~4 metadata lines before the header
 * - German dates (DD.MM.YYYY / DD.MM.YY) and decimal-comma amounts (-12,34)
 * - UTF-8 or ISO-8859-1 encoding
 */

import Papa from 'papaparse'
import type { DkbAccountMeta, Transaction } from './types'

const HEADER_MARKERS = ['Buchungsdatum', 'Wertstellung', 'Betrag']

function findHeaderLineIndex(lines: string[]): number {
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i] ?? ''
    if (
      HEADER_MARKERS.every((m) => line.includes(m)) &&
      line.includes(';')
    ) {
      return i
    }
  }
  return -1
}

/** Strip BOM and normalize line endings */
function normalizeText(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** True when the text contains the DKB Girokonto header row. */
export function isDkbCsv(rawText: string): boolean {
  return findHeaderLineIndex(normalizeText(rawText).split('\n')) >= 0
}

/**
 * Try UTF-8 first; if we see typical mojibake / replacement chars around
 * German umlauts in the header area, fall back to ISO-8859-1.
 */
export async function readFileAsText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  const sample = utf8.slice(0, 2000)
  const looksBroken =
    sample.includes('\uFFFD') ||
    /Ã¤|Ã¶|Ã¼|Ã„|Ã–|Ãœ|ÃŸ/.test(sample)

  if (looksBroken) {
    return new TextDecoder('iso-8859-1').decode(buffer)
  }
  return utf8
}

export function parseGermanDate(value: string): string | null {
  const trimmed = value.trim().replace(/^"|"$/g, '')
  // DKB uses both DD.MM.YYYY and DD.MM.YY depending on export
  const m = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)
  if (!m) return null
  const day = m[1]!.padStart(2, '0')
  const month = m[2]!.padStart(2, '0')
  let year = m[3]!
  if (year.length === 2) {
    // Pivot: 00-69 → 20xx, 70-99 → 19xx
    year = Number(year) < 70 ? `20${year}` : `19${year}`
  }
  return `${year}-${month}-${day}`
}

export function parseGermanAmount(value: string): number | null {
  const cleaned = value
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\s/g, '')
    .replace(/€/g, '')
    .replace(/\./g, '') // thousand separators
    .replace(',', '.')
  if (!cleaned || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function stripQuotes(value: string | undefined): string {
  return (value ?? '').trim().replace(/^"|"$/g, '')
}

function pickCounterparty(
  type: string,
  payer: string,
  payee: string,
): string {
  const t = type.toLowerCase()
  if (t.includes('ausgang')) return payee || payer
  if (t.includes('eingang')) return payer || payee
  return payee || payer
}

/** Content fingerprint without account — used to catch cross-account CSV re-imports. */
export function transactionContentKey(input: {
  date: string
  amount: number
  counterparty: string
  purpose: string
}): string {
  return [
    input.date,
    input.amount.toFixed(2),
    input.counterparty.toLowerCase().trim(),
    input.purpose.toLowerCase().trim(),
  ].join('|')
}

/** Stable hash for deduplication within an account across overlapping CSV exports */
export function transactionHash(input: {
  accountId: string
  date: string
  amount: number
  counterparty: string
  purpose: string
}): string {
  const raw = `${input.accountId}|${transactionContentKey(input)}`
  let h = 5381
  for (let i = 0; i < raw.length; i++) {
    h = (h * 33) ^ raw.charCodeAt(i)
  }
  let h2 = 0
  for (let i = 0; i < raw.length; i++) {
    h2 = (h2 + raw.charCodeAt(i) * (i + 1)) >>> 0
  }
  return `tx_${input.accountId}_${(h >>> 0).toString(16)}_${h2.toString(16)}`
}

function getField(
  row: Record<string, string>,
  ...candidates: string[]
): string {
  for (const key of Object.keys(row)) {
    const normalized = key.replace(/"/g, '').trim().toLowerCase()
    for (const c of candidates) {
      if (
        normalized === c.toLowerCase() ||
        normalized.includes(c.toLowerCase())
      ) {
        return stripQuotes(row[key])
      }
    }
  }
  return ''
}

/**
 * Read account label + IBAN from DKB CSV metadata lines above the header, e.g.
 * "Girokonto";"DE4712…"
 */
export function extractDkbAccountMeta(rawText: string): DkbAccountMeta {
  const text = normalizeText(rawText)
  const lines = text.split('\n').slice(0, 12)
  let label: string | null = null
  let iban: string | null = null

  for (const line of lines) {
    const parts = line.split(';').map((p) => stripQuotes(p))
    if (parts.length < 2) continue
    const left = parts[0] ?? ''
    const right = parts[1] ?? ''

    const ibanMatch = right.match(/\bDE\d{20}\b/i) ?? left.match(/\bDE\d{20}\b/i)
    if (ibanMatch && !iban) iban = ibanMatch[0]!.toUpperCase()

    if (
      !label &&
      left &&
      !/^zeitraum/i.test(left) &&
      !/^kontostand/i.test(left) &&
      !/^buchungsdatum/i.test(left) &&
      !/^von:/i.test(left) &&
      !/^bis:/i.test(left) &&
      !/^kontonummer/i.test(left)
    ) {
      // First non-meta label like "Girokonto" or "Visa Debitkarte"
      if (/konto|visa|karte|credit|giro|tagesgeld|spar/i.test(left) || !right) {
        label = left || null
      }
      if (/^girokonto$/i.test(left) || /^visa/i.test(left)) {
        label = left
      }
    }

    if (/^kontonummer/i.test(left) && right) {
      const m = right.match(/\bDE\d{20}\b/i)
      if (m) iban = m[0]!.toUpperCase()
    }
  }

  return { label, iban }
}

export function suggestAccountName(meta: DkbAccountMeta, bank = 'DKB'): string {
  const label = meta.label?.trim() || 'Account'
  if (meta.iban && meta.iban.length >= 4) {
    return `${bank} ${label} ···${meta.iban.slice(-4)}`
  }
  return `${bank} ${label}`
}

export function parseDkbCsv(
  rawText: string,
  accountId: string,
): Transaction[] {
  const text = normalizeText(rawText)
  const lines = text.split('\n')
  const headerIdx = findHeaderLineIndex(lines)

  if (headerIdx < 0) {
    throw new Error(
      'Could not find DKB CSV header. Expected columns like Buchungsdatum, Wertstellung, Betrag (€).',
    )
  }

  const csvBody = lines.slice(headerIdx).join('\n')
  const parsed = Papa.parse<Record<string, string>>(csvBody, {
    delimiter: ';',
    header: true,
    skipEmptyLines: true,
    quoteChar: '"',
  })

  if (parsed.errors.length > 0) {
    const fatal = parsed.errors.filter((e) => e.type === 'Delimiter')
    if (fatal.length) {
      throw new Error(`CSV parse error: ${fatal[0]!.message}`)
    }
  }

  const now = new Date().toISOString()
  const transactions: Transaction[] = []

  for (const row of parsed.data) {
    const dateRaw = getField(row, 'Buchungsdatum')
    const valueDateRaw = getField(row, 'Wertstellung')
    const amountRaw = getField(row, 'Betrag (€)', 'Betrag(€)', 'Betrag')
    const date = parseGermanDate(dateRaw)
    const amount = parseGermanAmount(amountRaw)

    if (!date || amount === null) continue

    const status = getField(row, 'Status')
    const payer = getField(row, 'Zahlungspflichtige')
    const payee = getField(row, 'Zahlungsempfänger')
    const purpose = getField(row, 'Verwendungszweck')
    const type = getField(row, 'Umsatztyp')
    const iban = getField(row, 'IBAN')
    const counterparty = pickCounterparty(type, payer, payee)

    const id = transactionHash({
      accountId,
      date,
      amount,
      counterparty,
      purpose,
    })

    transactions.push({
      id,
      accountId,
      date,
      valueDate: parseGermanDate(valueDateRaw) ?? date,
      status,
      counterparty,
      purpose,
      type,
      iban,
      amount,
      categoryId: 'uncategorized',
      origin: 'bank',
      importedAt: now,
    })
  }

  return transactions
}
