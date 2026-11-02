import Decimal from 'break_infinity.js';
import { GoblinDie } from './GoblinDie';
import { DamagePipeline } from './DamagePipeline';
import { SKILLS } from './skills';
import { ComboResult, comboOfRoll } from './combos';
import {
  BALANCE,
  BattleState,
  CombatantStats,
  DieFace,
  EnemyIntent,
  FaceType,
  IntentType,
  RNG,
  SkillId,
  defaultRNG
} from './types';

/* ============================================================
 * BattleEngine — Macchina a stati del combattimento (GDD §5)
 *
 * Event-driven e completamente disaccoppiato dal renderer:
 * la UI si registra sugli eventi e può restituire una Promise
 * (Visual Blocking Callback) per mettere in pausa la logica
 * finché le animazioni non sono concluse.
 * ============================================================ */

/** Evento con resolver visuale opzionale: la logica attende
 *  la Promise restituita dal listener (se presente). */
export type BattleEventPayload = Record<string, unknown> & {
  waitUntilFinished?: () => Promise<void>;
};

export type BattleEventName =
  | 'onStateChanged'
  | 'onDicesRolled'
  | 'onOverflowTriggered' // Dopamine Cap raggiunto: la UI mostra il "glitch"
  | 'onDamageDealt'
  | 'onShieldGained'
  | 'onPoisonApplied'
  | 'onEnemyIntent'
  | 'onEnemyAction'
  | 'onBattleEnded';

type Listener = (payload: BattleEventPayload) => void | Promise<void>;

export interface Combatant {
  stats: CombatantStats;
  hp: Decimal;
  maxHp: Decimal;
  shield: Decimal;
  /** Veleno: danno per turno + turni rimanenti */
  poison: { perTurn: Decimal; turnsLeft: number };
}

export function createCombatant(stats: CombatantStats): Combatant {
  const maxHp = stats.vit.times(BALANCE.HP_PER_VIT);
  return {
    // Copia difensiva: i buff di battaglia (BUFF_STR) modificano questa copia
    // e non le stat persistenti del giocatore salvate nella run.
    stats: { ...stats },
    hp: maxHp,
    maxHp,
    shield: new Decimal(0),
    poison: { perTurn: new Decimal(0), turnsLeft: 0 }
  };
}

export interface RollResult {
  faces: DieFace[];
  /** Dado logico che ha prodotto ciascuna faccia (stesso indice di `faces`),
   *  inclusi i lanci extra dei dadi ricorsivi. */
  sources: GoblinDie[];
  /** true se il turno è stato risolto via Dopamine Cap */
  overflowed: boolean;
  /** Moltiplicatore extra applicato all'overflow (1.5^rimanenti) */
  overflowMultiplier: Decimal;
  /** Dadi della borsa (le prime `baseCount` facce sono i dadi veri, le altre i lanci extra) */
  baseCount: number;
  /** Dadi ricorsivi pendenti non lanciati (Dopamine Cap) */
  pending: number;
}

export class BattleEngine {
  public state: BattleState = BattleState.INIT_TURN;
  public readonly pipeline = new DamagePipeline();

  public player: Combatant;
  public enemy: Combatant;
  public currentIntent: EnemyIntent | null = null;

  private listeners = new Map<BattleEventName, Listener[]>();
  private lastRoll: RollResult | null = null;
  private rerollsLeft = 0;
  /** Rilanci gratuiti ancora disponibili nel turno */
  public get rerolls(): number { return this.rerollsLeft; }

  constructor(
    playerStats: CombatantStats,
    enemyStats: CombatantStats,
    public diceBag: GoblinDie[],
    private readonly rng: RNG = defaultRNG
  ) {
    this.player = createCombatant(playerStats);
    this.enemy = createCombatant(enemyStats);
  }

  /* ---------------- Event system ---------------- */

  public on(event: BattleEventName, listener: Listener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  /** Emette l'evento e ATTENDE sia i listener async sia l'eventuale
   *  resolver visuale: è il "Visual Blocking Callback" del GDD §5. */
  private async emitEvent(
    event: BattleEventName,
    payload: BattleEventPayload = {}
  ): Promise<void> {
    const list = this.listeners.get(event) ?? [];
    for (const listener of list) {
      await listener(payload);
    }
    if (payload.waitUntilFinished) {
      await payload.waitUntilFinished();
    }
  }

  private async setState(next: BattleState): Promise<void> {
    this.state = next;
    await this.emitEvent('onStateChanged', { state: next });
  }

  /* ---------------- Ciclo del turno ---------------- */

  /** 1. INIT_TURN: svuota i buffer e applica i DoT (GDD §5.1) */
  public async initTurn(): Promise<void> {
    await this.setState(BattleState.INIT_TURN);
    this.lastRoll = null;
    this.rerollsLeft = 0;

    // Applica il veleno al nemico (calcolato in Decimal)
    this.tickPoison(this.enemy);
    this.tickPoison(this.player);

    if (await this.checkBattleEnd()) return;

    // Il nemico dichiara l'intento del turno (deterministico, MVP §2)
    this.currentIntent = this.computeEnemyIntent();
    await this.emitEvent('onEnemyIntent', { intent: this.currentIntent });

    await this.rollPhase();
  }

  /** 2. ROLL_PHASE: lancia la borsa dei dadi, con catena ricorsiva
   *  protetta dal Dopamine Cap (GDD §3.3). */
  private async rollPhase(): Promise<void> {
    await this.setState(BattleState.ROLL_PHASE);
    this.lastRoll = this.rollDiceChain();

    await this.emitEvent('onDicesRolled', {
      dices: this.lastRoll.faces,
      sources: this.lastRoll.sources,
      overflowed: this.lastRoll.overflowed
      // La UI aggiunge qui il proprio waitUntilFinished
    });

    if (this.lastRoll.overflowed) {
      await this.emitEvent('onOverflowTriggered', {
        multiplier: this.lastRoll.overflowMultiplier
      });
    }

    this.rerollsLeft = BALANCE.REROLLS_PER_TURN;
    await this.setState(BattleState.WAIT_PLAYER_ACTION);
  }

  /**
   * Catena di lancio con Anti-Loop (Dopamine Cap, GDD §3.3):
   * ogni faccia RECURSIVE accoda un dado extra. Alla soglia
   * MAX_CHAIN (30) la catena si interrompe e i dadi pendenti
   * vengono convertiti in un moltiplicatore forzato:
   *
   *   Danno = Accumulato * 1.5^(dadi rimanenti stimati)
   *
   * Nota di scaling: l'overflow trasforma una catena potenzialmente
   * infinita (crescita incontrollata) in un premio esponenziale
   * FINITO e prevedibile, mantenendo la curva compatibile con lo
   * scaling HP nemici (1.6^level).
   */
  private rollDiceChain(): RollResult {
    const res: RollResult = {
      faces: [],
      sources: [],
      overflowed: false,
      overflowMultiplier: new Decimal(1),
      baseCount: this.diceBag.length,
      pending: 0
    };
    this.extendChain(res, [...this.diceBag]);
    return res;
  }

  /** Lancia i dadi in coda aggiungendo le facce al risultato; ogni faccia
   *  RECURSIVE accoda un dado extra. Oltre MAX_CHAIN i dadi pendenti
   *  diventano il moltiplicatore forzato dell'overflow. */
  private extendChain(res: RollResult, queue: GoblinDie[]): void {
    let pendingNow = 0;
    while (queue.length > 0) {
      if (res.faces.length >= BALANCE.MAX_CHAIN) {
        pendingNow = queue.length;
        break;
      }
      const die = queue.shift()!;
      const face = die.roll(this.player.stats.lck);
      res.faces.push(face);
      res.sources.push(die);
      this.afterFace(face, queue);
    }
    res.pending += pendingNow;
    res.overflowed = res.pending > 0;
    res.overflowMultiplier = res.overflowed
      ? new Decimal(BALANCE.OVERFLOW_MULT_BASE).pow(res.pending)
      : new Decimal(1);
  }

  /** Effetti immediati di una faccia appena uscita */
  private afterFace(face: DieFace, queue: GoblinDie[]): void {
    if (face.type === FaceType.RECURSIVE) {
      // Il dado ricorsivo genera un lancio extra (dado casuale della borsa)
      const extra = this.diceBag[Math.floor(this.rng.next() * this.diceBag.length)];
      if (extra) queue.push(extra);
    }
    if (face.type === FaceType.BUFF_STR) {
      // Buff per il match: agisce sulla Fase FLAT
      this.player.stats.str = this.player.stats.str.plus(face.value);
    }
  }

  /** Rilancio gratuito: rilancia le facce agli indici scelti e tiene le
   *  altre. Consuma 1 rilancio per turno. Ritorna false se non consentito. */
  public rerollSelected(indices: number[]): boolean {
    if (this.state !== BattleState.WAIT_PLAYER_ACTION || !this.lastRoll) return false;
    if (this.rerollsLeft <= 0) return false;
    const roll = this.lastRoll;
    const chosen = [...new Set(indices)].filter(i => i >= 0 && i < roll.faces.length);
    if (chosen.length === 0) return false;
    this.rerollsLeft--;
    const queue: GoblinDie[] = [];
    for (const i of chosen) {
      const old = roll.faces[i]!;
      if (old.type === FaceType.BUFF_STR) {
        this.player.stats.str = this.player.stats.str.minus(old.value); // il buff vecchio decade
      }
      const face = roll.sources[i]!.roll(this.player.stats.lck);
      roll.faces[i] = face;
      this.afterFace(face, queue);
    }
    this.extendChain(roll, queue);
    return true;
  }

  /** Stato dell'overflow del lancio corrente */
  public get overflow(): { active: boolean; mult: Decimal } {
    const r = this.lastRoll;
    return { active: !!r?.overflowed, mult: r?.overflowMultiplier ?? new Decimal(1) };
  }

  /** Combinazione di dadi del lancio corrente */
  public getCombo(): ComboResult | null {
    const r = this.lastRoll;
    return r ? comboOfRoll(r.faces, r.sources, r.baseCount) : null;
  }

  /** Danno del lancio corrente con un dato vettore mossa (anteprima e
   *  risoluzione usano lo STESSO calcolo, overflow e combo inclusi). */
  public calcDamage(skillMod: Decimal, comboPower = 1): Decimal {
    const r = this.lastRoll;
    if (!r) return new Decimal(0);
    const combo = comboOfRoll(r.faces, r.sources, r.baseCount).mult.pow(comboPower);
    let dmg = this.pipeline.calculateTurnDamage(this.player.stats.str, r.faces, skillMod, combo);
    if (r.overflowed) dmg = dmg.times(r.overflowMultiplier);
    return dmg;
  }

  /** 3-4. WAIT_PLAYER_ACTION -> RESOLUTION (GDD §5.3-5.4) */
  public async resolvePlayerAction(skillId: SkillId): Promise<void> {
    if (this.state !== BattleState.WAIT_PLAYER_ACTION || !this.lastRoll) {
      throw new Error('Azione consentita solo in WAIT_PLAYER_ACTION');
    }
    await this.setState(BattleState.RESOLUTION);

    const skill = SKILLS[skillId];

    // Pipeline a 3 fasi (FLAT -> MULT -> skillMod) + combinazione + middleware
    const damage = this.calcDamage(skill.skillMod, skill.comboPower);

    if (skill.convertsToShield) {
      // Scudo del Goblin: il danno diventa Punti Scudo temporanei
      this.player.shield = this.player.shield.plus(damage);
      await this.emitEvent('onShieldGained', { amount: damage });
    } else {
      this.applyDamage(this.enemy, damage);
      await this.emitEvent('onDamageDealt', {
        target: 'enemy',
        amount: damage
        // La UI blocca qui fino a fine effetto d'impatto
      });

      if (skill.poisonRatio) {
        // Sputo Acido: 20% del danno per 3 turni, scalato da INT
        const perTurn = damage
          .times(skill.poisonRatio)
          .times(Decimal.max(this.player.stats.int, 1));
        this.enemy.poison = { perTurn, turnsLeft: skill.poisonTurns };
        await this.emitEvent('onPoisonApplied', { perTurn, turns: skill.poisonTurns });
      }
    }

    if (await this.checkBattleEnd()) return;
    await this.enemyPhase();
  }

  /** 5. ENEMY_PHASE: esecuzione deterministica dell'intento (GDD §5.5) */
  private async enemyPhase(): Promise<void> {
    await this.setState(BattleState.ENEMY_PHASE);
    const intent = this.currentIntent;
    if (!intent) return;

    switch (intent.type) {
      case IntentType.ATTACK:
        this.applyDamage(this.player, intent.value);
        break;
      case IntentType.SHIELD:
        this.enemy.shield = this.enemy.shield.plus(intent.value);
        break;
      case IntentType.POISON:
        this.player.poison = {
          perTurn: intent.value,
          turnsLeft: intent.duration ?? 3
        };
        break;
      case IntentType.BUFF:
        this.enemy.stats.str = this.enemy.stats.str.plus(intent.value);
        break;
    }
    await this.emitEvent('onEnemyAction', { intent });

    if (await this.checkBattleEnd()) return;
    await this.initTurn(); // nuovo turno
  }

  /* ---------------- Helpers ---------------- */

  /** Il danno consuma prima lo scudo, poi gli HP */
  private applyDamage(target: Combatant, amount: Decimal): void {
    const absorbed = Decimal.min(target.shield, amount);
    target.shield = target.shield.minus(absorbed);
    target.hp = target.hp.minus(amount.minus(absorbed));
  }

  private tickPoison(c: Combatant): void {
    if (c.poison.turnsLeft > 0) {
      c.hp = c.hp.minus(c.poison.perTurn);
      c.poison.turnsLeft--;
    }
    // Gli scudi temporanei scadono a inizio turno
    c.shield = new Decimal(0);
  }

  /** IA deterministica minimale per l'MVP: pattern ciclico basato
   *  su STR nemica. Estendibile con pattern per-nemico. */
  private computeEnemyIntent(): EnemyIntent {
    const roll = this.rng.next();
    if (roll < 0.6) {
      return { type: IntentType.ATTACK, value: this.enemy.stats.str.times(2) };
    }
    if (roll < 0.85) {
      return { type: IntentType.SHIELD, value: this.enemy.stats.str.times(1.5) };
    }
    return {
      type: IntentType.POISON,
      value: this.enemy.stats.int.times(3),
      duration: 3
    };
  }

  private async checkBattleEnd(): Promise<boolean> {
    if (this.enemy.hp.lte(0)) {
      await this.setState(BattleState.VICTORY);
      await this.emitEvent('onBattleEnded', { winner: 'player' });
      return true;
    }
    if (this.player.hp.lte(0)) {
      await this.setState(BattleState.DEFEAT);
      await this.emitEvent('onBattleEnded', { winner: 'enemy' });
      return true;
    }
    return false;
  }
}

/* ------------------------------------------------------------
 * Curve di progressione (GDD §4.2) — crescita esponenziale
 * allineata alla pipeline moltiplicativa del giocatore.
 * ------------------------------------------------------------ */

/** HP(level) = HPbase * 1.6^level */
export function scaleEnemyHp(baseHp: Decimal, level: number): Decimal {
  return baseHp.times(new Decimal(BALANCE.ENEMY_HP_GROWTH).pow(level));
}

/** Cost(level) = CostBase * 1.5^level — cresce PIÙ LENTAMENTE
 *  degli HP nemici (1.5 < 1.6): il potere d'acquisto del giocatore
 *  resta leggermente avanti alla difficoltà, evitando soft-lock. */
export function scaleShopCost(baseCost: Decimal, level: number): Decimal {
  return baseCost.times(new Decimal(BALANCE.SHOP_COST_GROWTH).pow(level));
}
