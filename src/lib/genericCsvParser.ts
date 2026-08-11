/**
 * Generic bank CSV support for exports that aren't DKB or Trade Republic.
 *
 * Analyzes an unknown CSV (delimiter + header detection), suggests a column
 * mapping for the fields the app needs, and turns mapped rows into
 * Transactions. Dates and amounts are parsed leniently (German and
 * international formats) — unparseable rows are skipped and surfaced as a
 * count so the user can verify the mapping in the preview.
 */

import Papa from 'papaparse'
import type { Transaction } from './types'
import { transactionHash } from './dkbParser'

export const REQUIRED_MAPPING_FIELDS = ['date', 'amount'] as const
export const OPTIONAL_MAPPING_FIELDS = ['counterparty', 'purpose', 'iban'] as const
export const MAPPING_FIELDS = [
  ...REQUIRED_MAPPING_FIELDS,
  ...OPTIONAL_MAPPING_FIELDS,
] as const

export type MappingField = (typeof MAPPING_FIELDS)[number]

/** Maps each app field to a CSV column name (undefined = not present). */
export type ColumnMapping = Partial<Record<MappingField, string>>

export interface CsvAnalysis {
  delimiter: string
  headerIndex: number
  columns: string[]
  rows: Array<Record<string, string>>
}

export interface MappedRow {
  date: string
  amount: number
  counterparty: string
  purpose: string
  iban: string
}

const DELIMITER_CANDIDATES = [';', ',', '\t', '|']

function normalizeText(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** Split one line on a delimiter, respecting double quotes (detection only). */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells
}

function modalFieldCount(
  lines: string[],
  delimiter: string,
): { count: number; occurrences: number } {
  const tally = new Map<number, number>()
  for (const line of lines) {
    if (!line.trim()) continue
    const n = splitLine(line, delimiter).length
    if (n < 2) continue
    tally.set(n, (tally.get(n) ?? 0) + 1)
  }
  let count = 0
  let occurrences = 0
  for (const [n, times] of tally) {
    if (times > occurrences || (times === occurrences && n > count)) {
      count = n
      occurrences = times
    }
  }
  return { count, occurrences }
}

export function parseFlexibleDate(value: string): string | null {
  const v = value.trim().replace(/^"|"$/g, '')
  if (!v) return null

  const pad = (s: string) => s.padStart(2, '0')
  const valid = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1970 && y <= 2100

  const expandYear = (raw: string) =>
    raw.length === 2 ? (Number(raw) < 70 ? `20${raw}` : `19${raw}`) : raw

  // ISO: YYYY-MM-DD (optionally with time)
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m && valid(Number(m[1]), Number(m[2]), Number(m[3]))) {
    return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`
  }

  // German: DD.MM.YYYY or DD.MM.YY
  m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})/)
  if (m) {
    const year = expandYear(m[3]!)
    if (valid(Number(year), Number(m[2]), Number(m[1]))) {
      return `${year}-${pad(m[2]!)}-${pad(m[1]!)}`
    }
  }

  // YYYY/MM/DD
  m = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/)
  if (m && valid(Number(m[1]), Number(m[2]), Number(m[3]))) {
    return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`
  }

  // Slash dates: assume D/M/Y (European) unless the first part must be a month
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})/)
  if (m) {
    const year = expandYear(m[3]!)
    let day = Number(m[1])
    let month = Number(m[2])
    if (month > 12 && day <= 12) {
      // M/D/Y export
      ;[day, month] = [month, day]
    }
    if (valid(Number(year), month, day)) {
      return `${year}-${pad(String(month))}-${pad(String(day))}`
    }
  }

  return null
}

export function parseFlexibleAmount(value: string): number | null {
  let s = value
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/€|EUR|\$|£|CHF/gi, '')
    .replace(/[\s\u00A0']/g, '')
  if (!s) return null

  // Trailing minus ("12,34-") and accounting parentheses ("(12.34)")
  let negative = false
  if (s.endsWith('-')) {
    negative = true
    s = s.slice(0, -1)
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true
    s = s.slice(1, -1)
  }
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1)
  }
  s = s.replace(/^\+/, '')

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')

  if (lastComma >= 0 && lastDot >= 0) {
    // The later separator is the decimal one
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (lastComma >= 0) {
    // Decimal comma (German); multiple commas = thousands
    s =
      s.indexOf(',') === lastComma
        ? s.replace(',', '.')
        : s.replace(/,/g, '')
  } else if (lastDot >= 0 && s.indexOf('.') !== lastDot) {
    // Multiple dots = German thousand separators
    s = s.replace(/\./g, '')
  }

  if (!s || !/^\d/.test(s)) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

function looksLikeHeaderLine(cells: string[]): boolean {
  let textCells = 0
  for (const raw of cells) {
    const cell = raw.trim().replace(/^"|"$/g, '')
    if (!cell) continue
    if (parseFlexibleDate(cell)) return false
    if (/^[-+(]?\d[\d.,]*[)€]?$/.test(cell)) return false
    if (/[a-zA-ZäöüÄÖÜß]/.test(cell)) textCells++
  }
  return textCells >= 2
}

/**
 * Detect delimiter and header row of an unknown CSV, and parse its data rows.
 * Returns null when no tabular structure is found.
 */
export function analyzeCsv(rawText: string): CsvAnalysis | null {
  const text = normalizeText(rawText)
  const lines = text.split('\n')
  const sample = lines.slice(0, 200)

  let delimiter = ''
  let fieldCount = 0
  let occurrences = 0
  for (const candidate of DELIMITER_CANDIDATES) {
    const modal = modalFieldCount(sample, candidate)
    if (
      modal.occurrences > occurrences ||
      (modal.occurrences === occurrences && modal.count > fieldCount)
    ) {
      delimiter = candidate
      fieldCount = modal.count
      occurrences = modal.occurrences
    }
  }
  if (!delimiter || fieldCount < 2 || occurrences < 2) return null

  // Header = first line with the modal column count that looks textual
  let headerIndex = -1
  const searchLimit = Math.min(lines.length, 30)
  for (let i = 0; i < searchLimit; i++) {
    const line = lines[i] ?? ''
    if (!line.trim()) continue
    const cells = splitLine(line, delimiter)
    if (cells.length !== fieldCount) continue
    if (looksLikeHeaderLine(cells)) {
      headerIndex = i
      break
    }
  }
  if (headerIndex < 0) return null

  const parsed = Papa.parse<Record<string, string>>(
    lines.slice(headerIndex).join('\n'),
    {
      delimiter,
      header: true,
      skipEmptyLines: true,
      quoteChar: '"',
    },
  )

  const columns = (parsed.meta.fields ?? [])
    .map((f) => f.trim())
    .filter(Boolean)
  if (columns.length < 2 || parsed.data.length === 0) return null

  return { delimiter, headerIndex, columns, rows: parsed.data }
}

/** Synonyms in priority order, per app field, for auto-mapping columns. */
const COLUMN_SYNONYMS: Record<MappingField, string[]> = {
  date: [
    'buchungsdatum',
    'buchungstag',
    'buchung',
    'datum',
    'date',
    'booking date',
    'transaction date',
    'valutadatum',
    'wertstellung',
    'valuta',
  ],
  amount: [
    'betrag (€)',
    'betrag (eur)',
    'betrag',
    'amount (eur)',
    'amount',
    'umsatz',
    'summe',
    'wert',
    'value',
  ],
  counterparty: [
    'zahlungsempfänger*in',
    'zahlungsempfänger',
    'empfänger',
    'beguenstigter/zahlungspflichtiger',
    'begünstigter',
    'auftraggeber',
    'counterparty',
    'payee',
    'merchant',
    'partner',
    'name',
  ],
  purpose: [
    'verwendungszweck',
    'buchungstext',
    'beschreibung',
    'description',
    'purpose',
    'payment reference',
    'reference',
    'memo',
    'betreff',
  ],
  iban: ['iban', 'kontonummer', 'account number'],
}

function normalizeColumnName(name: string): string {
  return name.trim().replace(/^"|"$/g, '').toLowerCase()
}

export function suggestMapping(columns: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const used = new Set<string>()

  for (const field of MAPPING_FIELDS) {
    const synonyms = COLUMN_SYNONYMS[field]

    let match: string | undefined
    for (const syn of synonyms) {
      match = columns.find(
        (c) => !used.has(c) && normalizeColumnName(c) === syn,
      )
      if (match) break
    }
    if (!match) {
      for (const syn of synonyms) {
        match = columns.find(
          (c) => !used.has(c) && normalizeColumnName(c).includes(syn),
        )
        if (match) break
      }
    }

    if (match) {
      mapping[field] = match
      used.add(match)
    }
  }

  return mapping
}

function cell(row: Record<string, string>, column: string | undefined): string {
  if (!column) return ''
  return (row[column] ?? '').trim().replace(/^"|"$/g, '')
}

/** Apply a mapping to analyzed rows; rows without date/amount are skipped. */
export function mapCsvRows(
  rows: Array<Record<string, string>>,
  mapping: ColumnMapping,
): { rows: MappedRow[]; skipped: number } {
  const mapped: MappedRow[] = []
  let skipped = 0

  if (!mapping.date || !mapping.amount) {
    return { rows: [], skipped: rows.length }
  }

  for (const row of rows) {
    const date = parseFlexibleDate(cell(row, mapping.date))
    const amount = parseFlexibleAmount(cell(row, mapping.amount))
    if (!date || amount === null) {
      skipped++
      continue
    }
    mapped.push({
      date,
      amount,
      counterparty: cell(row, mapping.counterparty),
      purpose: cell(row, mapping.purpose),
      iban: cell(row, mapping.iban),
    })
  }

  return { rows: mapped, skipped }
}

export function buildGenericTransactions(
  rows: MappedRow[],
  accountId: string,
): Transaction[] {
  const now = new Date().toISOString()
  return rows.map((row) => ({
    id: transactionHash({
      accountId,
      date: row.date,
      amount: row.amount,
      counterparty: row.counterparty,
      purpose: row.purpose,
    }),
    accountId,
    date: row.date,
    valueDate: row.date,
    status: 'Gebucht',
    counterparty: row.counterparty,
    purpose: row.purpose,
    type: row.amount >= 0 ? 'Eingang' : 'Ausgang',
    iban: row.iban,
    amount: row.amount,
    categoryId: 'uncategorized',
    origin: 'bank',
    importedAt: now,
  }))
}
