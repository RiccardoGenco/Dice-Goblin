import Decimal from 'break_infinity.js';

/* ============================================================
 * TIPI CORE — Goblin Revenge
 * Architettura dati disaccoppiata: questo modulo NON importa
 * nulla da graphics/ o ui/. È TypeScript puro + break_infinity.
 * ============================================================ */

/** Statistiche di combattimento (GDD §2).
 *  Tutte le stat soggette a scaling esponenziale usano Decimal
 *  per superare il limite dei float nativi (~1.79e308). */
export interface CombatantStats {
  /** Forza: danno base piatto (Fase 1 della pipeline) */
  str: Decimal;
  /** Intelligenza: moltiplicatore effetti e DoT */
  int: Decimal;
  /** Vitalità: HP = vit * 10 */
  vit: Decimal;
  /** Fortuna: pesa i reroll/facce speciali. Primitivo con cap a 100:
   *  non scala esponenzialmente, quindi un number è sufficiente. */
  lck: number;
}

/** Come una faccia del dado influenza la pipeline di calcolo (GDD §3.1) */
export enum FaceType {
  /** Somma flat al danno base (Fase 1 — crescita lineare) */
  NORMAL,
  /** Moltiplica il totale del lancio (Fase 2 — QUI nasce la
   *  crescita esponenziale: N facce MULTIPLIER si compongono
   *  moltiplicativamente tra loro, x2 * x2 * x3 = x12) */
  MULTIPLIER,
  /** Aumenta la STR del Goblin per il resto del match */
  BUFF_STR,
  /** Genera il lancio di un dado extra (reazioni a catena,
   *  limitate dal Dopamine Cap, vedi BattleEngine) */
  RECURSIVE
}

/** Effetto di una faccia NORMALE incantata (vedi effects.ts) */
export type FaceEffect = 'veleno' | 'scudo' | 'fuoco';

export interface DieFace {
  value: Decimal;
  type: FaceType;
  effect?: FaceEffect | undefined;
}

export enum Rarity { COMUNE, NON_COMUNE, RARO, EPICO, LEGGENDARIO }

/* ------------------------------------------------------------
 * RNG iniettabile (MIGLIORIA rispetto al GDD)
 * Sostituisce Math.random hardcoded: permette seed deterministici
 * per unit test, replay delle run e futura validazione server.
 * ------------------------------------------------------------ */
export interface RNG {
  /** Ritorna un float in [0, 1) */
  next(): number;
}

export const defaultRNG: RNG = { next: () => Math.random() };

/** RNG deterministico (mulberry32) per test e replay */
export function seededRNG(seed: number): RNG {
  let s = seed >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };
}

/* ------------------------------------------------------------
 * Intenti deterministici del nemico (MVP Specs §2, Opzione B)
 * ------------------------------------------------------------ */
export enum IntentType { ATTACK, SHIELD, POISON, BUFF }

export interface EnemyIntent {
  type: IntentType;
  /** Entità dell'intento (danno, scudo, veleno/turno...) */
  value: Decimal;
  /** Durata in turni (usata da POISON/BUFF) */
  duration?: number;
  /** Etichetta speciale dello schema (es. "Colpo pesante") */
  tag?: string;
}

/* ------------------------------------------------------------
 * Pipeline middleware a fasi rigide (GDD §7.1)
 * Add e Mult NON sono commutative tra loro: l'ordine di
 * esecuzione è fissato dal motore, non dall'ordine di equip.
 * ------------------------------------------------------------ */
export enum MiddlewarePhase {
  PRE_ADD,   // buff flat pre-calcolo (es. +STR passiva)
  ADD,       // flat aggiuntivi legati alla mossa
  MULT,      // moltiplicatori percentuali (scaling esponenziale)
  POST_MULT  // effetti finali (lifesteal, riduzioni)
}

export interface DamagePayload {
  baseStr: Decimal;
  flatAdded: Decimal;
  multiplier: Decimal;
  finalDamage: Decimal;
}

export type DamageMiddleware = (payload: DamagePayload) => DamagePayload;

/* ------------------------------------------------------------
 * Le 4 skill fisse di classe (MVP Specs §3, Opzione A)
 * ------------------------------------------------------------ */
export enum SkillId {
  SGANCIO_BRUTALE, // Attacco:  skillMod 1.5, il colpo sicuro
  PARATA,          // Difesa:   danno -> Scudo; se il nemico attacca, rimbalza il 50% di ciò che blocchi
  BAVA,            // Veleno:   nessun danno diretto, 60% del danno come Veleno x3 turni (ignora lo scudo)
  CARICA           // Setup:    non attacchi, le facce restano per il turno dopo
}

export interface SkillDefinition {
  id: SkillId;
  name: string;
  /** Moltiplicatore applicato in Fase 3 (Vettore Mossa) */
  skillMod: Decimal;
  /** Converte il danno in scudo invece che infliggerlo */
  convertsToShield: boolean;
  /** Frazione del danno bloccato dallo scudo che torna al nemico se attacca */
  reflectRatio: Decimal | null;
  /** Frazione del danno applicata come veleno per `poisonTurns` */
  poisonRatio: Decimal | null;
  poisonTurns: number;
  /** false: il danno calcolato non colpisce subito (Bava) */
  dealsDamage: boolean;
  /** Il turno non attacca: le facce restano e si sommano ai dadi del turno dopo */
  carriesRoll: boolean;
}

/* ------------------------------------------------------------
 * Stati della macchina a turni (GDD §5)
 * ------------------------------------------------------------ */
export enum BattleState {
  INIT_TURN,
  ROLL_PHASE,
  WAIT_PLAYER_ACTION,
  RESOLUTION,
  ENEMY_PHASE,
  VICTORY,
  DEFEAT
}

/** Costanti di bilanciamento centralizzate (GDD §3.3, §4.2) */
export const BALANCE = {
  /** Dopamine Cap: max dadi lanciati in un singolo turno */
  MAX_CHAIN: 30,
  /** Rilanci gratuiti per turno (ognuno rilancia i dadi selezionati) */
  REROLLS_PER_TURN: 2,
  /** Moltiplicatore sul danno del lancio che arriva da una Carica */
  CHARGE_BONUS: 1.5,
  /** Moltiplicatore forzato per ogni dado ricorsivo non lanciato
   *  all'overflow: Danno = Accumulato * 1.5^rimanenti */
  OVERFLOW_MULT_BASE: 1.5,
  /** Scaling esponenziale HP nemici per incontro.
   *  TUNING (balance sim): 1.6 -> 1.42. Con 30 incontri, 1.6^29
   *  richiedeva una crescita del giocatore irraggiungibile. */
  ENEMY_HP_GROWTH: 1.24,
  /** Stat nemiche all'incontro 0 (poi crescono per livello) */
  ENEMY_BASE_STR: 5,
  ENEMY_BASE_VIT: 12,
  /** Quota di HP massimi recuperata dopo ogni vittoria (le boss fight curano del tutto) */
  HEAL_PER_WIN: 0.2,
  /** La FORZA nemica cresce più piano degli HP: la difesa del
   *  giocatore (VIT/scudi/pozioni) ha meno leve dell'attacco. */
  ENEMY_STR_GROWTH: 1.22,
  /** Scaling costi shop/forgia: UGUALE alla crescita del bottino. Ogni prezzo è
   *  una frazione costante del bottino del livello, quindi all'inizio e alla fine
   *  della run si possono comprare quasi sempre le stesse 2-3 cose. */
  SHOP_COST_GROWTH: 1.5,
  /** Crescita del reddito per incontro (oro) */
  GOLD_REWARD_GROWTH: 1.5,
  /** Oro dell'incontro 0 (poi cresce di GOLD_REWARD_GROWTH per livello) */
  GOLD_REWARD_BASE: 90,
  /** Crescita automatica del goblin a ogni vittoria. Prima Forza e Vitalità si
   *  compravano in negozio: ora sono la base che tiene il passo dei nemici, e il
   *  negozio serve a scegliere la build (oggetti, facce, dadi). */
  WIN_STR_GROWTH: 1.22,
  WIN_VIT_GROWTH: 1.10,
  /** Interesse sull'oro non speso a ogni vittoria, con tetto in "bottini base" */
  INTEREST_RATE: 0.08,
  INTEREST_CAP: 0.5,
  /** Rilancio del negozio: frazione del bottino, che cresce a ogni rilancio della visita */
  REROLL_COST: 0.25,
  REROLL_GROWTH: 1.6,
  /** HP = vit * 10 */
  HP_PER_VIT: 10
} as const;
