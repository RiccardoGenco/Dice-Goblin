import { writable } from 'svelte/store';
import { BattleState } from '@core/types';

/* ============================================================
 * Store reattivi della UI (GDD §6.2 — DOM Layer)
 *
 * Gli store contengono SOLO viste serializzabili (stringhe già
 * formattate, ratio 0-1, label): nessun Decimal attraversa il
 * confine logica->UI. Il GameManager è l'unico writer.
 * ============================================================ */

export interface CombatantView {
  hp: string;        // già formattato con formatBigNumber
  maxHp: string;
  hpRatio: number;   // 0-1 per la larghezza della barra
  shield: string;    // '0' = nessuno scudo
  poisonTurns: number;
}

export interface IntentView {
  icon: string;
  label: string;
  value: string;
}

export interface DieChip {
  text: string;      // es. "×2", "+STR 5", "12"
  cssClass: string;  // normal | multiplier | buff | recursive
}

export const emptyCombatant = (): CombatantView => ({
  hp: '0',
  maxHp: '0',
  hpRatio: 0,
  shield: '0',
  poisonTurns: 0
});

export const playerView = writable<CombatantView>(emptyCombatant());
export const enemyView = writable<CombatantView>(emptyCombatant());
export const intentView = writable<IntentView | null>(null);
export const battleState = writable<BattleState>(BattleState.INIT_TURN);
export const rolledChips = writable<DieChip[]>([]);
export const overflowActive = writable(false);
/** 'idle' = normale; 'reroll' = Tiro Truccato in attesa di selezione */
export const uiMode = writable<'idle' | 'reroll'>('idle');
export const battleResult = writable<'victory' | 'defeat' | null>(null);
export const actLevel = writable(0);
export const logLines = writable<string[]>([]);
export const equipVersion = writable(0); // bump per ri-renderizzare gli slot

/* ---- Meta-progressione (commit 11-13) ---- */
export interface ShopOfferView {
  id: string;
  icon: string;
  label: string;
  description: string;
  cost: string;
  affordable: boolean;
}

/** 'battle' = combattimento; 'shop' = negozio tra un incontro e
 *  l'altro; 'run-complete' = terzo boss sconfitto. */
export const uiPhase = writable<'battle' | 'shop' | 'run-complete'>('battle');
export const goldView = writable('0');
export const runLabel = writable('Atto 1 — 1/10');
export const shopOffers = writable<ShopOfferView[]>([]);
export const rewardBanner = writable<string | null>(null);

export function pushLog(line: string): void {
  logLines.update(lines => [line, ...lines].slice(0, 6));
}
