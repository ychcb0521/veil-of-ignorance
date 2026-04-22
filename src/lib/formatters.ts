/**
 * Global price/amount formatters for the trading UI.
 *
 * formatPrice — dynamic precision based on magnitude, with thousands separators
 *               and zero scientific notation. Always safe for display.
 * formatAmount — base-asset quantity formatter (4 decimals by default).
 * formatUSDT  — fiat / margin / PnL formatter (2 decimals + thousands).
 */

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Convert a finite number to a plain decimal string (no scientific notation). */
function toPlainString(n: number): string {
  if (!isFiniteNumber(n)) return '0';
  const s = n.toString();
  if (!/e/i.test(s)) return s;
  // Expand scientific notation manually
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const [mantissaRaw, expRaw] = abs.toString().split(/e/i);
  const exp = parseInt(expRaw, 10);
  const [intPart, fracPart = ''] = mantissaRaw.split('.');
  if (exp >= 0) {
    const digits = intPart + fracPart;
    const pointPos = intPart.length + exp;
    if (pointPos >= digits.length) {
      return sign + digits + '0'.repeat(pointPos - digits.length);
    }
    return sign + digits.slice(0, pointPos) + '.' + digits.slice(pointPos);
  }
  // exp < 0
  const shift = -exp;
  if (shift >= intPart.length) {
    return sign + '0.' + '0'.repeat(shift - intPart.length) + intPart + fracPart;
  }
  return sign + intPart.slice(0, intPart.length - shift) + '.' + intPart.slice(intPart.length - shift) + fracPart;
}

/** Add thousands separators to the integer part of a plain decimal string. */
function withThousands(plain: string): string {
  const negative = plain.startsWith('-');
  const body = negative ? plain.slice(1) : plain;
  const [intPart, fracPart] = body.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = fracPart != null ? `${grouped}.${fracPart}` : grouped;
  return negative ? `-${out}` : out;
}

/** Choose decimal places by absolute price magnitude. */
export function getPriceDecimals(price: number): number {
  const abs = Math.abs(price);
  if (!isFiniteNumber(price) || abs === 0) return 2;
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  if (abs >= 0.01) return 6;
  // For ultra-small (sub-cent) values: first significant digit + 4 more.
  // e.g. 0.00001234 -> 0.00001234 (8 decimals here as a hard upper bound).
  const log = Math.floor(Math.log10(abs));        // negative
  const firstSigDecimal = -log;                   // position of first non-zero digit
  return Math.min(12, firstSigDecimal + 3);
}

/**
 * Format a price with dynamic precision and thousands separators.
 * - >= 1000   → 2 decimals
 * - 1..1000   → 4 decimals
 * - 0.01..1   → 6 decimals
 * - < 0.01    → first significant digit + 3 more (cap 12)
 * Never returns scientific notation. Never throws.
 */
export function formatPrice(price: number | string | null | undefined, _symbol?: string): string {
  if (price == null || price === '') return '-';
  const n = typeof price === 'number' ? price : parseFloat(price);
  if (!isFiniteNumber(n)) return '-';
  if (n === 0) return '0.00';
  const decimals = getPriceDecimals(n);
  // Use toFixed which always returns plain decimal, then add separators.
  const fixed = n.toFixed(decimals);
  // Defensive: in case of any future regression, expand sci-notation first.
  const plain = /e/i.test(fixed) ? toPlainString(Number(fixed)) : fixed;
  return withThousands(plain);
}

/** Format a base-asset quantity. Default 4 decimals; trims optional trailing zeros. */
export function formatAmount(amount: number | string | null | undefined, decimals = 4): string {
  if (amount == null || amount === '') return '-';
  const n = typeof amount === 'number' ? amount : parseFloat(amount);
  if (!isFiniteNumber(n)) return '-';
  return withThousands(n.toFixed(decimals));
}

/** Format a USDT / fiat / margin / PnL value with 2 decimals and thousands separators. */
export function formatUSDT(value: number | string | null | undefined, decimals = 2): string {
  if (value == null || value === '') return '-';
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!isFiniteNumber(n)) return '-';
  return withThousands(n.toFixed(decimals));
}

/** Format a signed PnL (prefix '+' for positives). */
export function formatSignedUSDT(value: number | string | null | undefined, decimals = 2): string {
  if (value == null || value === '') return '-';
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!isFiniteNumber(n)) return '-';
  const sign = n > 0 ? '+' : '';
  return sign + withThousands(n.toFixed(decimals));
}
