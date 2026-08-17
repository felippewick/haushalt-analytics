/**
 * German (and mixed EU) bank-export amounts and debit/credit direction.
 *
 * Exports disagree on how they encode an outflow:
 * - Signed Betrag: -8,36 (DKB Girokonto)
 * - Unsigned Betrag + Umsatztyp "Ausgang" / "Eingang"
 * - Unsigned Betrag + S/H (Sparkasse, DATEV)
 * - Separate Soll / Haben columns (Deutsche Bank, Postbank)
 *
 * The app stores expenses as negative amounts.
 */

const MINUS_CHARS = /[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g
const CURRENCY = /€|EUR|USD|GBP|CHF|\$|£/gi

export type CashDirection = 'in' | 'out' | null

export function parseGermanAmount(value: string): number | null {
  return parseFlexibleAmount(value)
}

export function parseFlexibleAmount(value: string): number | null {
  let s = value
    .trim()
    .replace(/^"|"$/g, '')
    .replace(CURRENCY, '')
    .replace(MINUS_CHARS, '-')
    .replace(/[\s\u00A0\u202F\u2009\u2007']/g, '')
  if (!s || s === '-') return null

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
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (lastComma >= 0) {
    s =
      s.indexOf(',') === lastComma
        ? s.replace(',', '.')
        : s.replace(/,/g, '')
  } else if (lastDot >= 0 && s.indexOf('.') !== lastDot) {
    s = s.replace(/\./g, '')
  }

  if (!s || !/^\d/.test(s)) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

const OUT_EXACT =
  /^(ausgang|soll|s|debit|lastschrift|abbuchung|auszahlung|karte|outgoing|expense|withdrawal|card purchase|direct debit|sepa debit)$/i
const IN_EXACT =
  /^(eingang|haben|h|credit|gutschrift|einzahlung|incoming|income|deposit|direct credit|sepa credit)$/i

/**
 * Read a dedicated direction cell (Umsatztyp, S/H, Soll/Haben, Transaction type).
 */
export function parseCashDirection(value: string): CashDirection {
  const v = value.trim().replace(/^"|"$/g, '')
  if (!v) return null
  if (OUT_EXACT.test(v)) return 'out'
  if (IN_EXACT.test(v)) return 'in'

  const lower = v.toLowerCase()
  if (
    /\b(ausgang|lastschrift|abbuchung|auszahlung|soll|outgoing|debit|card purchase|direct debit)\b/.test(
      lower,
    )
  ) {
    return 'out'
  }
  if (
    /\b(eingang|gutschrift|einzahlung|haben|incoming|credit|direct credit|inbound)\b/.test(
      lower,
    )
  ) {
    return 'in'
  }
  return null
}

/**
 * If the export left amounts unsigned, apply an explicit debit/credit marker.
 * Already-signed amounts are left alone so DKB `-8,36` + `Ausgang` stays `-8.36`.
 */
export function applyCashDirection(
  amount: number,
  direction: CashDirection,
): number {
  if (!direction || amount === 0) return amount
  if (direction === 'out' && amount > 0) return -amount
  if (direction === 'in' && amount < 0) return Math.abs(amount)
  return amount
}

/** Combine Betrag with optional Soll / Haben columns. */
export function signedAmountFromParts(input: {
  amountRaw: string
  sollRaw?: string
  habenRaw?: string
  directionRaw?: string
}): number | null {
  const soll = input.sollRaw ? parseFlexibleAmount(input.sollRaw) : null
  const haben = input.habenRaw ? parseFlexibleAmount(input.habenRaw) : null
  const hasSoll = soll != null && soll !== 0
  const hasHaben = haben != null && haben !== 0

  if (hasSoll && !hasHaben) {
    return -Math.abs(soll)
  }
  if (hasHaben && !hasSoll) {
    return Math.abs(haben)
  }

  const amount = parseFlexibleAmount(input.amountRaw)
  if (amount === null) return null
  return applyCashDirection(amount, parseCashDirection(input.directionRaw ?? ''))
}
