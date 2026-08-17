/**
 * German bank CSV parser (DKB plus other semicolon/comma Girokonto exports).
 *
 * Handles:
 * - DKB post-2023 (Buchungsdatum, Betrag (€), Umsatztyp, signed amounts)
 * - DKB pre-2023 (Buchungstag, Betrag (EUR), combined counterparty)
 * - Sparkasse / Volksbank / ING / Commerzbank / Deutsche Bank / Postbank
 *   variants with Soll/Haben or unsigned Betrag + direction column
 * - UTF-8 or ISO-8859-1 encoding
 */

import Papa from 'papaparse'
import type { DkbAccountMeta, Transaction } from './types'
import { parseGermanAmount, signedAmountFromParts } from './germanAmount'

export { parseGermanAmount }

const DATE_HEADER =
  /buchungsdatum|buchungstag|belegdatum|\bdate\b|\bbuchung\b|wertstellung/i
const AMOUNT_HEADER = /betrag|amount\s*\(?eur\)?|soll|haben/i

function headerDelimiter(line: string): ';' | ',' | null {
  const semi = (line.match(/;/g) ?? []).length
  const comma = (line.match(/,/g) ?? []).length
  if (semi >= 3 && semi >= comma) return ';'
  if (comma >= 3) return ','
  return null
}

function findHeaderLineIndex(lines: string[]): number {
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i] ?? ''
    if (!headerDelimiter(line)) continue
    if (DATE_HEADER.test(line) && AMOUNT_HEADER.test(line)) {
      return i
    }
  }
  return -1
}

/** Strip BOM and normalize line endings */
function normalizeText(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** True when the text looks like a German (or DKB-style) bank booking export. */
export function isGermanBankCsv(rawText: string): boolean {
  return findHeaderLineIndex(normalizeText(rawText).split('\n')) >= 0
}

/** @deprecated use isGermanBankCsv */
export function isDkbCsv(rawText: string): boolean {
  return isGermanBankCsv(rawText)
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
  if (!trimmed) return null

  const pad = (s: string) => s.padStart(2, '0')
  const expandYear = (raw: string) =>
    raw.length === 2 ? (Number(raw) < 70 ? `20${raw}` : `19${raw}`) : raw

  // DKB uses both DD.MM.YYYY and DD.MM.YY depending on export
  let m = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)
  if (m) {
    return `${expandYear(m[3]!)}-${pad(m[2]!)}-${pad(m[1]!)}`
  }

  m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) {
    return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`
  }

  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})/)
  if (m) {
    const year = expandYear(m[3]!)
    let day = Number(m[1])
    let month = Number(m[2])
    if (month > 12 && day <= 12) {
      ;[day, month] = [month, day]
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad(String(month))}-${pad(String(day))}`
    }
  }

  return null
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

const CARD_PURPOSE =
  /visa|mastercard|debitkartenumsatz|kartenzahlung|apple pay|google pay/i

function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase()
}

/**
 * Identity for overlapping bank exports when the counterparty *name* changed
 * (e.g. DKB placeholder "Max Mustermann" → the real sender) but the booking
 * is the same SEPA transfer. Returns null for card clearing rows, where the
 * merchant IBAN is shared and the name is the real discriminator.
 */
export function bookingIdentityKey(input: {
  accountId: string
  date: string
  amount: number
  purpose: string
  iban: string
}): string | null {
  const iban = normalizeIban(input.iban)
  if (!iban || /^0+$/.test(iban)) return null
  if (CARD_PURPOSE.test(input.purpose)) return null
  return [
    input.accountId,
    input.date,
    input.amount.toFixed(2),
    input.purpose.toLowerCase().trim(),
    iban,
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

function normalizeHeader(name: string): string {
  return name.replace(/"/g, '').trim().toLowerCase()
}

function getField(
  row: Record<string, string>,
  ...candidates: string[]
): string {
  const keys = Object.keys(row)
  for (const c of candidates) {
    const want = c.toLowerCase()
    const exact = keys.find((key) => normalizeHeader(key) === want)
    if (exact) return stripQuotes(row[exact])
  }
  for (const c of candidates) {
    const want = c.toLowerCase()
    if (want.length < 4) continue
    const partial = keys.find((key) => {
      const n = normalizeHeader(key)
      if (!n.includes(want)) return false
      // Don't treat Umsatztyp / Wertstellung as the amount or date column
      if (want === 'umsatz' && /typ|art/.test(n)) return false
      if (want === 'wert' && /stellung|datum/.test(n)) return false
      if (want === 'betrag' && /urspr/.test(n)) return false
      if (want === 'soll' && /haben|typ/.test(n)) return false
      if (want === 'haben' && /soll/.test(n)) return false
      return true
    })
    if (partial) return stripQuotes(row[partial])
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

/** Guess the bank from metadata / header names (DKB omits its name on Girokonto CSVs). */
export function detectBankName(rawText: string, meta?: DkbAccountMeta): string {
  const sample = rawText.slice(0, 5000)
  const lower = sample.toLowerCase()
  if (/\bdkb\b|deutsche kreditbank/.test(lower)) return 'DKB'
  if (
    meta?.iban &&
    meta.label &&
    /girokonto|visa|tagesgeld|kreditkarte/i.test(meta.label)
  ) {
    return 'DKB'
  }
  if (
    /zahlungspflichtige/i.test(sample) &&
    /zahlungsempfänger/i.test(sample) &&
    /umsatztyp/i.test(sample)
  ) {
    return 'DKB'
  }
  if (/sparkasse/.test(lower)) return 'Sparkasse'
  if (/\bing-diba\b|\bing bank\b/.test(lower)) return 'ING'
  if (/\bn26\b/.test(lower)) return 'N26'
  if (/commerzbank/.test(lower)) return 'Commerzbank'
  if (/postbank/.test(lower)) return 'Postbank'
  if (/consors/.test(lower)) return 'Consorsbank'
  if (/comdirect/.test(lower)) return 'comdirect'
  if (/\bc24\b/.test(lower)) return 'C24'
  if (/volksbank|raiffeisen/.test(lower)) return 'Volksbank'
  if (/deutsche bank/.test(lower)) return 'Deutsche Bank'
  if (/tomorrow/.test(lower)) return 'Tomorrow'
  return 'Bank'
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
      'Could not find a bank CSV header. Expected a date column (Buchungsdatum / Buchungstag) and an amount (Betrag).',
    )
  }

  const delimiter = headerDelimiter(lines[headerIdx] ?? '') ?? ';'
  const csvBody = lines.slice(headerIdx).join('\n')
  const parsed = Papa.parse<Record<string, string>>(csvBody, {
    delimiter,
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
    const dateRaw = getField(
      row,
      'Buchungsdatum',
      'Buchungstag',
      'Belegdatum',
      'Buchung',
      'Datum',
      'Date',
      'Booking date',
    )
    const valueDateRaw = getField(
      row,
      'Wertstellung',
      'Valutadatum',
      'Valuta',
    )
    const amountRaw = getField(
      row,
      'Betrag (€)',
      'Betrag (EUR)',
      'Betrag(€)',
      'Amount (EUR)',
      'Betrag',
      'Amount',
      'Umsatz',
    )
    const date = parseGermanDate(dateRaw)
    const type = getField(
      row,
      'Umsatztyp',
      'Umsatzart',
      'S/H',
      'Soll/Haben',
      'Transaction type',
      'Buchungstext',
    )
    const amount = signedAmountFromParts({
      amountRaw,
      sollRaw: getField(row, 'Soll'),
      habenRaw: getField(row, 'Haben'),
      directionRaw: type,
    })

    if (!date || amount === null) continue

    const status = getField(row, 'Status')
    const payer = getField(
      row,
      'Zahlungspflichtige',
      'Auftraggeber',
    )
    const payee = getField(
      row,
      'Zahlungsempfänger',
      'Empfänger',
      'Begünstigter',
      'Beguenstigter',
      'Payee',
      'Beschreibung',
    )
    const combinedParty = getField(
      row,
      'Auftraggeber / Begünstigter',
      'Beguenstigter/Zahlungspflichtiger',
      'Auftraggeber/Empfänger',
      'Partner',
    )
    const purpose = getField(
      row,
      'Verwendungszweck',
      'Buchungstext',
      'Beschreibung',
      'Payment reference',
      'Description',
    )
    const iban = getField(row, 'IBAN', 'Kontonummer', 'Account number')
    const counterparty =
      pickCounterparty(type, payer, payee) || combinedParty

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
