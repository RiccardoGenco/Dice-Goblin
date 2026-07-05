import Decimal from 'break_infinity.js';
import { GoblinDie } from './GoblinDie';
import { DamagePipeline } from './DamagePipeline';
import { SKILLS } from './skills';
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
    stats,
    hp: maxHp,
    maxHp,
    shield: new Decimal(0),
    poison: { perTurn: new Decimal(0), turnsLeft: 0 }
  };
}

export interface RollResult {
  faces: DieFace[];
  /** true se il turno è stato risolto via Dopamine Cap */
  overflowed: boolean;
  /** Moltiplicatore extra applicato all'overflow (1.5^rimanenti) */
  overflowMultiplier: Decimal;
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
      overflowed: this.lastRoll.overflowed
      // La UI aggiunge qui il proprio waitUntilFinished
    });

    if (this.lastRoll.overflowed) {
      await this.emitEvent('onOverflowTriggered', {
        multiplier: this.lastRoll.overflowMultiplier
      });
    }

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
    const faces: DieFace[] = [];
    const queue: GoblinDie[] = [...this.diceBag];
    let rolledCount = 0;
    let pendingRecursive = 0;

    while (queue.length > 0) {
      if (rolledCount >= BALANCE.MAX_CHAIN) {
        // Dadi pendenti stimati = coda residua (non lanciati fisicamente)
        pendingRecursive = queue.length;
        break;
      }
      const die = queue.shift()!;
      const face = die.roll(this.player.stats.lck);
      faces.push(face);
      rolledCount++;

      if (face.type === FaceType.RECURSIVE) {
        // Il dado ricorsivo genera un lancio extra (dado casuale della borsa)
        const extraIndex = Math.floor(this.rng.next() * this.diceBag.length);
        const extra = this.diceBag[extraIndex];
        if (extra) queue.push(extra);
      }
      if (face.type === FaceType.BUFF_STR) {
        // Buff permanente per il match: agisce sulla Fase FLAT
        this.player.stats.str = this.player.stats.str.plus(face.value);
      }
    }

    const overflowed = pendingRecursive > 0;
    const overflowMultiplier = overflowed
      ? new Decimal(BALANCE.OVERFLOW_MULT_BASE).pow(pendingRecursive)
      : new Decimal(1);

    return { faces, overflowed, overflowMultiplier };
  }

  /** Reroll selettivo (Tiro Truccato): rilancia i dadi agli indici
   *  indicati prima della risoluzione. */
  public rerollDice(indices: number[], skillId: SkillId): void {
    if (this.state !== BattleState.WAIT_PLAYER_ACTION || !this.lastRoll) {
      throw new Error('Reroll consentito solo in WAIT_PLAYER_ACTION');
    }
    const allowed = SKILLS[skillId].rerolls;
    for (const idx of indices.slice(0, allowed)) {
      const die = this.diceBag[idx % this.diceBag.length];
      if (die && this.lastRoll.faces[idx]) {
        this.lastRoll.faces[idx] = die.roll(this.player.stats.lck);
      }
    }
  }

  /** 3-4. WAIT_PLAYER_ACTION -> RESOLUTION (GDD §5.3-5.4) */
  public async resolvePlayerAction(skillId: SkillId): Promise<void> {
    if (this.state !== BattleState.WAIT_PLAYER_ACTION || !this.lastRoll) {
      throw new Error('Azione consentita solo in WAIT_PLAYER_ACTION');
    }
    await this.setState(BattleState.RESOLUTION);

    const skill = SKILLS[skillId];

    // Pipeline a 3 fasi (FLAT -> MULT -> skillMod) + middleware passivi
    let damage = this.pipeline.calculateTurnDamage(
      this.player.stats.str,
      this.lastRoll.faces,
      skill.skillMod
    );

    // Overflow del Dopamine Cap: moltiplicatore esponenziale forzato
    if (this.lastRoll.overflowed) {
      damage = damage.times(this.lastRoll.overflowMultiplier);
    }

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
