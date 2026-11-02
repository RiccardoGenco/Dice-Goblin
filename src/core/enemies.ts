import { IntentType } from './types';

/* ============================================================
 * Enemies — Schemi fissi e regole dei boss
 *
 * Prima l'intento del nemico era un sorteggio (60% attacco, 25% scudo,
 * 15% veleno): la scelta del giocatore dipendeva da un dado, e un errore
 * di lettura (Parata contro un Veleno) costava la partita senza che si
 * potesse fare di meglio. Ora ogni classe ha uno SCHEMA che si ripete e
 * che il giocatore vede in anticipo (l'intento corrente più i prossimi
 * due): le scelte diventano pianificabili.
 *
 * Ogni passo scala un valore base:
 *   ATTACCO  = STR × 2 × mult      SCUDO  = STR × 1.5 × mult
 *   VELENO   = INT × 3 × mult (3 turni)
 *   POTENZIAMENTO = STR × 0.15 × mult (si aggiunge alla STR del nemico, per sempre)
 * Gli schemi sono tarati perché il danno medio per turno resti vicino al
 * vecchio sorteggio (circa 1.2 × STR a turno), con forme diverse per classe.
 * ============================================================ */

export interface IntentStep {
  type: IntentType;
  /** moltiplicatore sul valore base del tipo (default 1) */
  mult?: number;
  /** etichetta speciale mostrata al posto del tipo (es. "Colpo pesante") */
  tag?: string;
}

export interface EnemyPattern {
  id: string;
  name: string;
  /** Come si gioca contro questo schema, in una riga (mostrata nel registro e nel "Come si gioca") */
  tip: string;
  steps: IntentStep[];
}

/** Regole speciali dei boss d'Atto: cambiano come si gioca il turno */
export interface BossRules {
  /** dadi pescati in meno a inizio turno */
  handPenalty?: number;
  /** quota degli HP massimi recuperata a ogni turno nemico */
  regenPct?: number;
  /** testo mostrato accanto al boss */
  text: string;
}

const A = IntentType.ATTACK, S = IntentType.SHIELD, P = IntentType.POISON, B = IntentType.BUFF;

/** Ordine uguale a CLASS_SPRITES (ui/spriteCatalog.ts): l'indice sceglie sprite e schema insieme */
export const CLASS_ORDER = ['Guerriero', 'Mago', 'Paladino', 'Chierico', 'Bardo', 'Ladro'] as const;
export type ClassName = (typeof CLASS_ORDER)[number];

export const CLASS_PATTERNS: Record<ClassName, EnemyPattern> = {
  Guerriero: {
    id: 'guerriero', name: 'Guerriero',
    tip: 'Due colpi e poi si copre: difenditi nei primi due turni, attacca quando alza lo scudo.',
    steps: [{ type: A, mult: 0.9 }, { type: A, mult: 0.8 }, { type: S }]
  },
  Mago: {
    id: 'mago', name: 'Mago',
    tip: 'Apre con il veleno, che ignora lo scudo: non sprecare Parata nel turno del veleno.',
    steps: [{ type: P }, { type: A, mult: 0.8 }, { type: S }]
  },
  Paladino: {
    id: 'paladino', name: 'Paladino',
    tip: 'Alterna scudo e colpo: il fuoco e il veleno passano oltre lo scudo, la Sgancio lo deve rompere.',
    steps: [{ type: S }, { type: A, mult: 1.3 }]
  },
  Chierico: {
    id: 'chierico', name: 'Chierico',
    tip: 'Due turni di scudo, poi un colpo pesante: il turno del colpo è quello di Parata.',
    steps: [{ type: S }, { type: S }, { type: A, mult: 1.8, tag: 'Colpo pesante' }]
  },
  Bardo: {
    id: 'bardo', name: 'Bardo',
    tip: 'Si potenzia a ogni ciclo: chiudi presto, ogni giro il suo attacco cresce.',
    steps: [{ type: B }, { type: A, mult: 0.8 }, { type: A, mult: 0.8 }]
  },
  Ladro: {
    id: 'ladro', name: 'Ladro',
    tip: 'Tre punzecchiature e il veleno: lo scudo basta per le prime tre, il quarto turno no.',
    steps: [{ type: A, mult: 0.5 }, { type: A, mult: 0.5 }, { type: A, mult: 0.5 }, { type: P }]
  }
};

export const BOSS_ORDER = ['Sir Baldovino il Molesto', 'Madre Ildegonda', 'Arcimago Zoltan il Verboso'] as const;

export interface BossProfile {
  pattern: EnemyPattern;
  rules: BossRules;
}

export const BOSS_PROFILES: Record<(typeof BOSS_ORDER)[number], BossProfile> = {
  'Sir Baldovino il Molesto': {
    pattern: {
      id: 'baldovino', name: 'Sir Baldovino',
      tip: 'Colpo, scudo, poi la Molestia: un colpo pesante ogni tre turni.',
      steps: [{ type: A }, { type: S }, { type: A, mult: 1.5, tag: 'Molestia' }]
    },
    rules: { handPenalty: 1, text: 'Molesta: peschi un dado in meno a ogni turno' }
  },
  'Madre Ildegonda': {
    pattern: {
      id: 'ildegonda', name: 'Madre Ildegonda',
      tip: 'Scudo, veleno forte, colpo: ricorda che si cura a ogni turno.',
      steps: [{ type: S }, { type: P, mult: 1.4 }, { type: A, mult: 1.3 }]
    },
    rules: { regenPct: 0.03, text: 'Benedizione: recupera il 3% degli HP a ogni turno' }
  },
  'Arcimago Zoltan il Verboso': {
    pattern: {
      id: 'zoltan', name: 'Arcimago Zoltan',
      tip: 'Si copre con uno scudo enorme, poi alterna colpi e potenziamenti.',
      steps: [{ type: S, mult: 2.5, tag: 'Scudo arcano' }, { type: A, mult: 1.3 }, { type: B }, { type: A, mult: 1.3 }]
    },
    rules: { handPenalty: 1, regenPct: 0.015, text: 'Verboso: peschi un dado in meno e recupera l\'1,5% degli HP a ogni turno' }
  }
};

export interface EnemyProfile {
  name: string;
  pattern: EnemyPattern;
  rules: BossRules | null;
}

/** Quale classe si incontra: stessa formula che sceglie la sprite */
export function classIndexFor(act: number, encounter: number): number {
  return ((act - 1) * 3 + encounter) % CLASS_ORDER.length;
}

export function enemyProfileFor(
  act: number, encounter: number, isChampion: boolean, isActBoss: boolean
): EnemyProfile {
  if (isActBoss) {
    const name = BOSS_ORDER[(act - 1) % BOSS_ORDER.length]!;
    const p = BOSS_PROFILES[name];
    return { name, pattern: p.pattern, rules: p.rules };
  }
  const cls = CLASS_ORDER[classIndexFor(act, encounter)]!;
  return { name: isChampion ? `Campione — ${cls}` : cls, pattern: CLASS_PATTERNS[cls], rules: null };
}
