import Decimal from 'break_infinity.js';
import { BALANCE } from './types';

/* ============================================================
 * RunManager — Struttura ad Atti (MVP Specs §1, Opzione C)
 *
 * Run = 3 Atti; ogni Atto = 10 incontri + 1 Boss finale.
 * Il "level" globale (usato dalle curve di scaling 1.6^lv e
 * 1.5^lv del GDD §4.2) cresce linearmente lungo tutta la run:
 * l'esponenzialità sta nelle curve, non nel contatore.
 * ============================================================ */

export const ENCOUNTERS_PER_ACT = 11; // 10 incontri + 1 boss
export const TOTAL_ACTS = 3;
export const GOLD_REWARD_BASE = 10;
export const BOSS_GOLD_MULTIPLIER = 3;
/** I boss hanno statistiche amplificate rispetto all'incontro base */
export const BOSS_STAT_MULTIPLIER = 2.5;

export interface RunState {
  act: number;       // 1..TOTAL_ACTS
  encounter: number; // 1..ENCOUNTERS_PER_ACT (l'ultimo è il boss)
  gold: Decimal;
  purchases: number; // acquisti effettuati (inasprisce i costi shop)
}

export type AdvanceResult = 'next-encounter' | 'act-completed' | 'run-completed';

export function freshRunState(): RunState {
  return { act: 1, encounter: 1, gold: new Decimal(0), purchases: 0 };
}

export class RunManager {
  constructor(public state: RunState = freshRunState()) {}

  /** Livello globale per le curve di scaling: 0-based e continuo
   *  tra gli Atti (Atto 2 incontro 1 -> level 11). */
  public get level(): number {
    return (this.state.act - 1) * ENCOUNTERS_PER_ACT + (this.state.encounter - 1);
  }

  public get isBoss(): boolean {
    return this.state.encounter === ENCOUNTERS_PER_ACT;
  }

  public get label(): string {
    const enc = this.isBoss ? '👑 BOSS' : `${this.state.encounter}/10`;
    return `Atto ${this.state.act} — ${enc}`;
  }

  /** Ricompensa in oro della vittoria.
   *  SCALING: cresce di 1.5^level, la STESSA base dei costi shop
   *  (GDD §4.2): il potere d'acquisto resta costante lungo la run,
   *  niente inflazione né stalli. I boss pagano triplo. */
  public goldReward(): Decimal {
    const growth = new Decimal(BALANCE.SHOP_COST_GROWTH).pow(this.level);
    const base = new Decimal(GOLD_REWARD_BASE).times(growth);
    return this.isBoss ? base.times(BOSS_GOLD_MULTIPLIER) : base;
  }

  public addGold(amount: Decimal): void {
    this.state.gold = this.state.gold.plus(amount);
  }

  /** Ritorna false (senza addebitare) se l'oro non basta */
  public spendGold(amount: Decimal): boolean {
    if (this.state.gold.lt(amount)) return false;
    this.state.gold = this.state.gold.minus(amount);
    this.state.purchases++;
    return true;
  }

  /** Avanza dopo una vittoria. Se l'incontro era il boss, chiude
   *  l'Atto (o l'intera run al terzo boss). */
  public advance(): AdvanceResult {
    if (this.isBoss) {
      if (this.state.act >= TOTAL_ACTS) return 'run-completed';
      this.state.act++;
      this.state.encounter = 1;
      return 'act-completed';
    }
    this.state.encounter++;
    return 'next-encounter';
  }
}
