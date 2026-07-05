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
