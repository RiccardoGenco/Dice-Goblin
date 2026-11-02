import Decimal from 'break_infinity.js';
import { DieFace } from './types';
import type { GoblinDie } from './GoblinDie';

/* ============================================================
 * Combinazioni di dadi (design_evolution.md, Fase A)
 *
 * Ogni dado ha 6 facce; il "pip" di una faccia è la sua posizione
 * nel dado (1-6). Le combinazioni si leggono sui pip dei dadi della
 * BORSA (non sui lanci extra dei dadi ricorsivi) e danno un
 * moltiplicatore che entra nella Fase MULT della pipeline, come le
 * mani di poker di Balatro. Si sceglie la combinazione col
 * moltiplicatore più alto tra quelle soddisfatte.
 * ============================================================ */

export type ComboId =
  | 'none' | 'pair' | 'two-pair' | 'three' | 'short-straight'
  | 'full' | 'straight' | 'four' | 'five';

export interface ComboDef {
  id: ComboId;
  name: string;
  mult: number;
}

export const COMBOS: Record<ComboId, ComboDef> = {
  'none':           { id: 'none',           name: 'Nessuna',        mult: 1 },
  'pair':           { id: 'pair',           name: 'Coppia',         mult: 1.3 },
  'two-pair':       { id: 'two-pair',       name: 'Doppia coppia',  mult: 1.8 },
  'three':          { id: 'three',          name: 'Tris',           mult: 2.2 },
  'short-straight': { id: 'short-straight', name: 'Mezza scala',    mult: 2.5 },
  'full':           { id: 'full',           name: 'Full',           mult: 3 },
  'straight':       { id: 'straight',       name: 'Scala',          mult: 4 },
  'four':           { id: 'four',           name: 'Poker',          mult: 4 },
  'five':           { id: 'five',           name: 'Cinque uguali',  mult: 6 }
};

export interface ComboResult {
  def: ComboDef;
  mult: Decimal;
}

/** Combinazione più forte presente in una lista di pip (1-6) */
export function detectCombo(pips: readonly number[]): ComboDef {
  const counts = new Map<number, number>();
  for (const p of pips) counts.set(p, (counts.get(p) ?? 0) + 1);
  const sorted = [...counts.values()].sort((a, b) => b - a);
  const top = sorted[0] ?? 0;

  // scala: lunghezza della corsa più lunga di pip consecutivi distinti
  const distinct = [...counts.keys()].sort((a, b) => a - b);
  let run = distinct.length ? 1 : 0;
  let best = run;
  for (let i = 1; i < distinct.length; i++) {
    run = distinct[i] === distinct[i - 1]! + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }

  const found: ComboDef[] = [];
  if (top >= 5) found.push(COMBOS.five);
  if (top >= 4) found.push(COMBOS.four);
  if (best >= 5) found.push(COMBOS.straight);
  if (top >= 3 && (sorted[1] ?? 0) >= 2) found.push(COMBOS.full);
  if (best >= 4) found.push(COMBOS['short-straight']);
  if (top >= 3) found.push(COMBOS.three);
  if (top >= 2 && (sorted[1] ?? 0) >= 2) found.push(COMBOS['two-pair']);
  if (top >= 2) found.push(COMBOS.pair);
  if (found.length === 0) return COMBOS.none;
  return found.reduce((a, b) => (b.mult > a.mult ? b : a));
}

/** Pip di una faccia: posizione 1-6 nel dado che l'ha prodotta */
export function pipOf(source: GoblinDie, face: DieFace): number {
  return Math.max(0, source.faces.indexOf(face)) + 1;
}

/** Combinazione dei primi `baseCount` dadi del lancio */
export function comboOfRoll(
  faces: readonly DieFace[],
  sources: readonly GoblinDie[],
  baseCount: number
): ComboResult {
  const pips: number[] = [];
  for (let i = 0; i < Math.min(baseCount, faces.length); i++) {
    pips.push(pipOf(sources[i]!, faces[i]!));
  }
  const def = detectCombo(pips);
  return { def, mult: new Decimal(def.mult) };
}
