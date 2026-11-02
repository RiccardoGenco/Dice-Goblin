import Decimal from 'break_infinity.js';

/* ============================================================
 * formatBigNumber — Leggibilità dei grandi numeri (GDD §6.1)
 *
 * Lo scaling esponenziale della pipeline produce rapidamente
 * valori tipo 123456789012345: sotto il milione usiamo il
 * separatore delle migliaia, oltre passiamo alla notazione
 * mantissa/esponente compatta ("1.25e9"), stabile e senza
 * dipendenze dal locale del browser.
 * ============================================================ */

export function formatBigNumber(value: Decimal): string {
  if (value.lte(0)) return '0';
  if (value.lt(1_000_000)) {
    return Math.round(value.toNumber()).toLocaleString('it-IT');
  }
  return `${value.mantissa.toFixed(2)}e${value.exponent}`;
}

/**
 * Valore di una FACCIA (chip, registro, dado 3D): un solo formato ovunque.
 * A differenza di formatBigNumber NON arrotonda all'intero, perché le facce
 * hanno valori frazionari (×2.5, 1.25 da bonus di rarità) e un ×2.5 letto
 * come "×3" falsava i conti. Max ~5 caratteri, così sta sempre sul dado.
 *   3 → "3" · 2.5 → "2.5" · 3.75 → "3.75" · 1234 → "1.2k" · 4.5e9 → "4.5e9"
 */
export function formatFaceValue(value: Decimal): string {
  if (value.lte(0)) return '0';
  if (value.lt(1000)) return String(Math.round(value.toNumber() * 100) / 100);
  if (value.lt(1_000_000)) {
    const k = Math.round(value.toNumber() / 100) / 10; // una cifra decimale
    return k >= 1000 ? '1m' : `${k}k`;
  }
  let m = Math.round(value.mantissa * 100) / 100;
  let e = value.exponent;
  if (m >= 10) { m /= 10; e += 1; }
  return `${m}e${e}`;
}
