import Decimal from 'break_infinity.js';
import { DieFace, FaceType } from './types';

/* ============================================================
 * Riepilogo della catena di dadi (solo lettura, per la UI)
 *
 * SCALING ESPONENZIALE: qui si vede la sorgente del Balatro-effect.
 * Ogni faccia MULTIPLIER moltiplica il totale (Fase 2 della pipeline),
 * quindi k facce ×2 valgono 2^k. Questo modulo NON calcola il danno
 * (lo fa DamagePipeline, con equipaggiamento e skill): espone solo il
 * prodotto dei moltiplicatori per mostrarlo al giocatore e scegliere
 * l'intensità degli effetti scenici.
 * ============================================================ */

export interface ChainSummary {
  /** prodotto dei valori delle facce MULTIPLIER (1 se non ce ne sono) */
  multProduct: Decimal;
  multCount: number;
  recursiveCount: number;
  buffCount: number;
}

export function summarizeChain(faces: readonly DieFace[]): ChainSummary {
  let multProduct = new Decimal(1);
  let multCount = 0;
  let recursiveCount = 0;
  let buffCount = 0;
  for (const f of faces) {
    if (f.type === FaceType.MULTIPLIER) {
      multProduct = multProduct.times(f.value);
      multCount++;
    } else if (f.type === FaceType.RECURSIVE) recursiveCount++;
    else if (f.type === FaceType.BUFF_STR) buffCount++;
  }
  return { multProduct, multCount, recursiveCount, buffCount };
}

/** Intensità scenica del moltiplicatore: 0 = nessun effetto, 4 = spettacolare */
export function multTier(mult: Decimal): 0 | 1 | 2 | 3 | 4 {
  if (mult.lte(1)) return 0;
  if (mult.lt(4)) return 1;
  if (mult.lt(16)) return 2;
  if (mult.lt(100)) return 3;
  return 4;
}

/** Ordine di grandezza (log10, >= 0) per scalare la dimensione dei numeri */
export function magnitudeOf(value: Decimal): number {
  const m = value.log10();
  return Number.isFinite(m) ? Math.max(0, m) : 0;
}
