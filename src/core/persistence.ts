import Decimal from 'break_infinity.js';
import { CombatantStats } from './types';

/* ============================================================
 * Persistence — Serializzazione & Hydration (GDD §2.2)
 *
 * JSON.stringify distrugge il prototipo di Decimal: al load i
 * dati grezzi vanno "reidratati" in vere istanze Decimal, o ogni
 * .plus()/.times() esploderebbe a runtime. TS strict non basta:
 * il JSON arriva da storage esterno, quindi validiamo a runtime.
 * ============================================================ */

/** Converte un valore JSON grezzo in un'istanza Decimal valida. */
export function hydrateDecimal(raw: unknown): Decimal {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    'mantissa' in raw &&
    'exponent' in raw &&
    typeof (raw as { mantissa: unknown }).mantissa === 'number' &&
    typeof (raw as { exponent: unknown }).exponent === 'number'
  ) {
    const r = raw as { mantissa: number; exponent: number };
    return Decimal.fromMantissaExponent(r.mantissa, r.exponent);
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    return new Decimal(raw);
  }
  return new Decimal(0);
}

/** Ripristina le statistiche da un salvataggio grezzo. */
export function hydrateCombatantStats(rawStats: unknown): CombatantStats {
  const r = (rawStats ?? {}) as Record<string, unknown>;
  return {
    str: hydrateDecimal(r.str),
    int: hydrateDecimal(r.int),
    vit: hydrateDecimal(r.vit),
    lck: typeof r.lck === 'number' ? r.lck : 0
  };
}

/** Serializza Decimal in forma compatta e stabile ("1.5e42"):
 *  più leggero di {mantissa, exponent} e retro-compatibile con
 *  hydrateDecimal, che accetta anche stringhe. */
export function serializeDecimal(value: Decimal): string {
  return value.toString();
}
