import Decimal from 'break_infinity.js';
import { GoblinDie } from './GoblinDie';
import { DieFace, FaceEffect, FaceType, Rarity, RNG, defaultRNG } from './types';

/* ============================================================
 * Meta — Borse di partenza e obiettivi
 *
 * Tra una run e l'altra restano gli sblocchi: nuove borse di partenza
 * (ognuna spinge una build) e nuovi dadi per il negozio. Si sbloccano
 * completando obiettivi, che si contano su statistiche permanenti.
 * ============================================================ */

export type BagId = 'classica' | 'veleno' | 'scudo' | 'fuoco';

export interface BagDef {
  id: BagId;
  name: string;
  icon: string;
  description: string;
  /** facce incantate di partenza: [dado, faccia, effetto] */
  starter: [number, number, FaceEffect][];
  /** oggetto con cui si parte, se c'è */
  item?: string;
}

export const BAGS: BagDef[] = [
  { id: 'classica', name: 'Borsa Classica', icon: '🎒', description: 'Due facce di veleno, scudo e fuoco: si impara di tutto un po\'.',
    starter: [[0, 4, 'veleno'], [0, 5, 'fuoco'], [1, 4, 'scudo'], [1, 5, 'veleno'], [2, 4, 'fuoco'], [2, 5, 'scudo']] },
  { id: 'veleno', name: 'Borsa del Veleno', icon: '☠', description: 'Quattro facce di veleno. Parti con la Fiala Velenosa.',
    starter: [[0, 4, 'veleno'], [0, 5, 'veleno'], [1, 4, 'veleno'], [1, 5, 'scudo'], [2, 4, 'fuoco'], [2, 5, 'veleno']], item: 'fiala-velenosa' },
  { id: 'scudo', name: 'Borsa dello Scudo', icon: '🛡️', description: 'Quattro facce di scudo. Parti con lo Scudo di Pentola.',
    starter: [[0, 4, 'scudo'], [0, 5, 'veleno'], [1, 4, 'scudo'], [1, 5, 'scudo'], [2, 4, 'fuoco'], [2, 5, 'scudo']], item: 'scudo-pentola' },
  { id: 'fuoco', name: 'Borsa del Fuoco', icon: '🔥', description: 'Quattro facce di fuoco. Parti con il Carbone Ardente.',
    starter: [[0, 4, 'fuoco'], [0, 5, 'fuoco'], [1, 4, 'scudo'], [1, 5, 'veleno'], [2, 4, 'fuoco'], [2, 5, 'fuoco']], item: 'carbone-ardente' }
];

export function getBag(id: string): BagDef {
  return BAGS.find(b => b.id === id) ?? BAGS[0]!;
}

/** I cinque dadi di partenza, con le facce incantate della borsa scelta */
export function buildStarterBag(bagId: string = 'classica', rng: RNG = defaultRNG): GoblinDie[] {
  const special: DieFace[] = [
    { value: new Decimal(5), type: FaceType.NORMAL },
    { value: new Decimal(10), type: FaceType.NORMAL },
    { value: new Decimal(2), type: FaceType.MULTIPLIER },
    { value: new Decimal(3), type: FaceType.MULTIPLIER },
    { value: new Decimal(2), type: FaceType.BUFF_STR },
    { value: new Decimal(1), type: FaceType.RECURSIVE }
  ];
  const bag = [
    new GoblinDie(Rarity.COMUNE, undefined, rng),
    new GoblinDie(Rarity.NON_COMUNE, undefined, rng),
    new GoblinDie(Rarity.RARO, undefined, rng),
    new GoblinDie(Rarity.EPICO, undefined, rng),
    new GoblinDie(Rarity.LEGGENDARIO, special, rng)
  ];
  for (const [d, f, effect] of getBag(bagId).starter) {
    const face = bag[d]!.faces[f]!;
    if (face.type === FaceType.NORMAL) face.effect = effect;
  }
  return bag;
}

/* ---------------- Statistiche permanenti e obiettivi ---------------- */

export interface MetaStats {
  /** Élite sconfitti in totale */
  elites: number;
  /** Atto più avanzato raggiunto (1..3) */
  bestAct: number;
  /** Boss d'Atto sconfitti in totale */
  bosses: number;
  /** Run completate */
  wins: number;
}

export const freshMetaStats = (): MetaStats => ({ elites: 0, bestAct: 1, bosses: 0, wins: 0 });

export interface GoalDef {
  id: string;
  name: string;
  description: string;
  /** progresso corrente e traguardo, per la barra */
  progress: (s: MetaStats) => [number, number];
  /** cosa si sblocca */
  reward: { bag?: BagId; die?: string };
  rewardText: string;
}

export const GOALS: GoalDef[] = [
  { id: 'primo-elite', name: 'Cacciatore di Élite', description: 'Sconfiggi un nemico Élite',
    progress: s => [s.elites, 1], reward: { bag: 'veleno' }, rewardText: 'Borsa del Veleno' },
  { id: 'primo-boss', name: 'Spezzaboss', description: 'Sconfiggi il Boss dell\'Atto 1',
    progress: s => [s.bosses, 1], reward: { bag: 'scudo' }, rewardText: 'Borsa dello Scudo' },
  { id: 'atto-tre', name: 'In fondo al pozzo', description: 'Raggiungi l\'Atto 3',
    progress: s => [s.bestAct, 3], reward: { bag: 'fuoco' }, rewardText: 'Borsa del Fuoco' },
  { id: 'vittoria', name: 'Vendetta compiuta', description: 'Completa una run',
    progress: s => [s.wins, 1], reward: { die: 'dado-prisma' }, rewardText: 'Dado Prisma nel negozio' }
];

/** Obiettivi completati con queste statistiche */
export function completedGoals(s: MetaStats): string[] {
  return GOALS.filter(g => { const [a, b] = g.progress(s); return a >= b; }).map(g => g.id);
}
