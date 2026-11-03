import type { RNG } from './types';

/* ============================================================
 * Imprevisti di turno
 *
 * Dall'Atto 2, a volte il turno porta una sorpresa che l'avversario non
 * annuncia: la lettura dell'intento non basta più a decidere. Due imprevisti
 * ti ostacolano, due ti aiutano. Mai nel primo turno, mai due di fila.
 * ============================================================ */

export type TurnEventId = 'mano-ridotta' | 'furia-nemica' | 'eco-tuono' | 'pioggia-curativa';

export interface TurnEvent {
  id: TurnEventId;
  icon: string;
  title: string;
  text: string;
  good: boolean;
}

export const TURN_EVENTS: TurnEvent[] = [
  { id: 'mano-ridotta', icon: '🌫️', title: 'Nebbia fitta', text: 'Peschi un dado in meno questo turno', good: false },
  { id: 'furia-nemica', icon: '💢', title: 'Il nemico è furioso', text: "L'intento di questo turno vale il 30% in più", good: false },
  { id: 'eco-tuono', icon: '⚡', title: 'Eco del tuono', text: 'Il danno di questo turno vale ×1.5', good: true },
  { id: 'pioggia-curativa', icon: '🌧️', title: 'Pioggia curativa', text: 'Recuperi il 10% degli HP massimi', good: true }
];

export const TURN_EVENT_CHANCE = 0.22;
export const TURN_EVENT_FROM_ACT = 2;

/** Sorteggia l'imprevisto del turno, o null. `turn` parte da 1. */
export function rollTurnEvent(rng: RNG, act: number, turn: number, lastId: TurnEventId | null): TurnEvent | null {
  if (act < TURN_EVENT_FROM_ACT || turn < 2 || lastId) return null;
  if (rng.next() >= TURN_EVENT_CHANCE) return null;
  return TURN_EVENTS[Math.floor(rng.next() * TURN_EVENTS.length)] ?? null;
}
