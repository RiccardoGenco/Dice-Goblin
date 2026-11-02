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

export const ENCOUNTERS_PER_ACT = 10;
/** Una boss fight ogni 5 incontri: il 5° è il Campione (mid-boss),
 *  il 10° è il Boss d'Atto. */
export const BOSS_INTERVAL = 5;
export const TOTAL_ACTS = 3;
export const CHAMPION_GOLD_MULTIPLIER = 2;
export const BOSS_GOLD_MULTIPLIER = 3;
/** Amplificazione delle stat nemiche nelle boss fight */
export const CHAMPION_STAT_MULTIPLIER = 1.5; // TUNING: 1.8 -> 1.7 -> 1.5
/** Boss d'Atto: HP e attacco separati. Il vecchio x1.8 su entrambi valeva
 *  circa x3.2 di difficoltà reale (HP x1.8 e colpi x1.8 sul giocatore). */
export const BOSS_HP_MULTIPLIER = 1.5; // TUNING: 2.5 -> 2.2 -> 1.8 -> 1.5
export const BOSS_STR_MULTIPLIER = 1.3; // TUNING: 1.8 -> 1.3
/** Élite scelta al bivio: nemico forte, premio in oro e un oggetto raro */
export const ELITE_HP_MULT = 1.8;
export const ELITE_STR_MULT = 1.4;
export const ELITE_GOLD_MULT = 1.5;

export interface RunState {
  act: number;       // 1..TOTAL_ACTS
  encounter: number; // 1..ENCOUNTERS_PER_ACT (l'ultimo è il boss)
  gold: Decimal;
  purchases: number; // acquisti effettuati (inasprisce i costi shop)
  /** HP del goblin come frazione del massimo, portati da un incontro all'altro */
  hpRatio: number;
  /** il prossimo incontro (o quello in corso) è un'Élite scelta al bivio */
  elite?: boolean;
  /** Élite affrontati nell'Atto in corso (tetto per Atto) */
  elitesInAct?: number;
}

export type AdvanceResult = 'next-encounter' | 'act-completed' | 'run-completed';

export function freshRunState(): RunState {
  return { act: 1, encounter: 1, gold: new Decimal(0), purchases: 0, hpRatio: 1 };
}

export class RunManager {
  constructor(public state: RunState = freshRunState()) {}

  /** Livello globale per le curve di scaling: 0-based e continuo
   *  tra gli Atti (Atto 2 incontro 1 -> level 11). */
  public get level(): number {
    return (this.state.act - 1) * ENCOUNTERS_PER_ACT + (this.state.encounter - 1);
  }

  /** Livello di riferimento dei prezzi: quello dell'incontro appena vinto. Il negozio
   *  si visita dopo `advance()`, ma il bottino in tasca è quello del livello prima. */
  public get shopLevel(): number {
    return Math.max(0, this.level - 1);
  }

  /** True su OGNI boss fight (incontri multipli di 5: Campione e Boss) */
  public get isBossFight(): boolean {
    return this.state.encounter % BOSS_INTERVAL === 0;
  }

  /** Il Boss d'Atto: 10° incontro, chiude l'Atto e sblocca il dado */
  public get isActBoss(): boolean {
    return this.state.encounter === ENCOUNTERS_PER_ACT;
  }

  /** Il Campione: mid-boss del 5° incontro. Non chiude l'Atto,
   *  ma premia con l'intermezzo speciale. */
  public get isChampion(): boolean {
    return this.isBossFight && !this.isActBoss;
  }

  /** Incontro Élite: scelto al bivio, mai su Campione e Boss */
  public get isElite(): boolean {
    return !!this.state.elite && !this.isBossFight;
  }

  public get label(): string {
    const enc = this.isActBoss
      ? '👑 BOSS'
      : this.isChampion
        ? '🏆 CAMPIONE'
        : this.isElite ? `${this.state.encounter}/10 👹` : `${this.state.encounter}/10`;
    return `Atto ${this.state.act} — ${enc}`;
  }

  /** Ricompensa in oro della vittoria.
   *  SCALING: cresce di 1.5^level, la STESSA base dei costi shop
   *  (GDD §4.2): il potere d'acquisto resta costante lungo la run.
   *  Le boss fight sono i picchi economici: Campione x2, Boss x3
   *  — in sincrono con lo sconto del Mercante Reale. */
  public goldReward(): Decimal {
    const growth = new Decimal(BALANCE.GOLD_REWARD_GROWTH).pow(this.level);
    const base = new Decimal(BALANCE.GOLD_REWARD_BASE).times(growth);
    if (this.isActBoss) return base.times(BOSS_GOLD_MULTIPLIER);
    if (this.isChampion) return base.times(CHAMPION_GOLD_MULTIPLIER);
    if (this.isElite) return base.times(ELITE_GOLD_MULT);
    return base;
  }

  /** Oro "di riferimento" del livello: il bottino di un incontro normale.
   *  Tutti i prezzi del negozio sono una frazione di questo numero. */
  public static incomeAt(level: number): Decimal {
    return new Decimal(BALANCE.GOLD_REWARD_BASE).times(new Decimal(BALANCE.GOLD_REWARD_GROWTH).pow(level));
  }

  /** Interesse sull'oro non speso (con tetto): si incassa dopo il bottino. Ritorna l'importo. */
  public applyInterest(): Decimal {
    const raw = this.state.gold.times(BALANCE.INTEREST_RATE);
    const cap = RunManager.incomeAt(this.level).times(BALANCE.INTEREST_CAP);
    const gain = Decimal.min(raw, cap).floor();
    if (gain.gt(0)) this.state.gold = this.state.gold.plus(gain);
    return gain;
  }

  public addGold(amount: Decimal): void {
    this.state.gold = this.state.gold.plus(amount);
  }

  /** Ritorna false (senza addebitare) se l'oro non basta.
   *  `counts=false` per le spese che non devono rincarare i prezzi (rilanci, servizi). */
  public spendGold(amount: Decimal, counts = true): boolean {
    if (this.state.gold.lt(amount)) return false;
    this.state.gold = this.state.gold.minus(amount);
    if (counts) this.state.purchases++;
    return true;
  }

  /** Avanza dopo una vittoria. Solo il Boss d'Atto (10°) chiude
   *  l'Atto (o l'intera run al terzo); il Campione (5°) prosegue
   *  normalmente al 6° incontro. */
  public advance(): AdvanceResult {
    this.state.elite = false;
    if (this.isActBoss) {
      if (this.state.act >= TOTAL_ACTS) return 'run-completed';
      this.state.act++;
      this.state.encounter = 1;
      this.state.elitesInAct = 0;
      return 'act-completed';
    }
    this.state.encounter++;
    return 'next-encounter';
  }
}
