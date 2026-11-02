import Decimal from 'break_infinity.js';
import { GoblinDie } from './GoblinDie';
import { DamagePipeline } from './DamagePipeline';
import { SKILLS } from './skills';
import { ItemCtx, ItemMods, buildCtx, neutralMods } from './equipment';
import { EffectSummary, FIRE_DAMAGE_FACTOR, POISON_BASE_TURNS, SPORE_EXTRA_TURNS, summarizeEffects } from './effects';
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
  | 'onReflect' // la Parata rimbalza parte dell'attacco sul nemico
  | 'onCharge' // Carica: il lancio resta per il turno dopo
  | 'onReaction' // due effetti di facce diverse reagiscono (vapori, spore...)
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
  /** Facce messe da parte da Carica: si aggiungono ai dadi del turno dopo */
  private carried: { faces: DieFace[]; sources: GoblinDie[]; pending: number } | null = null;
  /** Rimbalzo attivo della Parata durante la fase nemica */
  private reflectRatio: Decimal | null = null;
  /** Regole modificate dagli oggetti equipaggiati (le imposta chi equipaggia) */
  public mods: ItemMods = neutralMods();
  private ctxSkill: SkillId | null = null;
  private rerollsMax = 0;
  /** Il lancio corrente arriva da una Carica: danno ×CHARGE_BONUS */
  private chargedRoll = false;
  public get charged(): boolean { return this.chargedRoll; }
  /** Facce conservate da Carica (per la UI) */
  public get carriedCount(): number { return this.carried?.faces.length ?? 0; }
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
    this.tickPoison(this.enemy, false); // lo scudo nemico resta fino al suo prossimo turno
    this.tickPoison(this.player, true);

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

    this.rerollsMax = BALANCE.REROLLS_PER_TURN + this.mods.extraRerolls;
    this.rerollsLeft = this.rerollsMax;
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
    // Carica: le facce messe da parte aprono il lancio, poi i dadi della borsa
    this.chargedRoll = !!this.carried;
    if (this.carried) {
      res.faces.push(...this.carried.faces);
      res.sources.push(...this.carried.sources);
      res.pending = this.carried.pending;
      this.carried = null;
    }
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

  /** Effetti e reazioni delle facce del lancio corrente */
  public getEffects(): EffectSummary {
    return summarizeEffects(this.lastRoll?.faces ?? [], FIRE_DAMAGE_FACTOR + this.mods.fireFactor);
  }

  /** Il contesto che gli oggetti leggono per le loro condizioni */
  public itemCtx(skill?: SkillId | null): ItemCtx {
    const r = this.lastRoll;
    return buildCtx({
      skill: skill !== undefined ? skill : this.ctxSkill,
      faces: r?.faces ?? [],
      extraDice: r ? Math.max(0, r.faces.length - r.baseCount) : 0,
      reactions: this.getEffects().reactions.length,
      rerollsUsed: Math.max(0, this.rerollsMax - this.rerollsLeft),
      hpRatio: this.player.hp.div(Decimal.max(this.player.maxHp, 1)).toNumber(),
      enemyPoisoned: this.enemy.poison.turnsLeft > 0,
      enemyShielded: this.enemy.shield.gt(0),
      charged: this.chargedRoll
    });
  }

  /** Stato dell'overflow del lancio corrente */
  public get overflow(): { active: boolean; mult: Decimal } {
    const r = this.lastRoll;
    return { active: !!r?.overflowed, mult: r?.overflowMultiplier ?? new Decimal(1) };
  }

  /** Danno del lancio corrente con un dato vettore mossa (anteprima e
   *  risoluzione usano lo STESSO calcolo, overflow incluso). */
  public calcDamage(skillMod: Decimal, skillId: SkillId | null = null): Decimal {
    const r = this.lastRoll;
    if (!r) return new Decimal(0);
    this.ctxSkill = skillId;
    let dmg: Decimal;
    try {
      dmg = this.pipeline.calculateTurnDamage(this.player.stats.str, r.faces, skillMod);
    } finally {
      this.ctxSkill = null;
    }
    if (r.overflowed) dmg = dmg.times(r.overflowMultiplier);
    if (this.chargedRoll) dmg = dmg.times(BALANCE.CHARGE_BONUS + this.mods.chargeBonus);
    return dmg;
  }

  /** 3-4. WAIT_PLAYER_ACTION -> RESOLUTION (GDD §5.3-5.4) */
  public async resolvePlayerAction(skillId: SkillId): Promise<void> {
    if (this.state !== BattleState.WAIT_PLAYER_ACTION || !this.lastRoll) {
      throw new Error('Azione consentita solo in WAIT_PLAYER_ACTION');
    }
    await this.setState(BattleState.RESOLUTION);

    const skill = SKILLS[skillId];

    // Pipeline a 3 fasi (FLAT -> MULT -> skillMod) + middleware passivi
    const damage = this.calcDamage(skill.skillMod, skillId);
    this.reflectRatio = null;

    if (skill.carriesRoll) {
      // Carica: nessun attacco e nessun effetto di faccia ora; il lancio resta
      const r = this.lastRoll;
      this.carried = { faces: [...r.faces], sources: [...r.sources], pending: r.pending };
      await this.emitEvent('onCharge', { count: r.faces.length });
    } else {
      if (skill.convertsToShield) {
        // Parata: il danno diventa Punti Scudo temporanei
        this.player.shield = this.player.shield.plus(damage);
        this.reflectRatio = skill.reflectRatio ? skill.reflectRatio.plus(this.mods.reflectBonus) : null;
        await this.emitEvent('onShieldGained', { amount: damage });
      }
      if (skill.dealsDamage) {
        this.applyDamage(this.enemy, damage);
        await this.emitEvent('onDamageDealt', {
          target: 'enemy',
          amount: damage
          // La UI blocca qui fino a fine effetto d'impatto
        });
      }
      if (skill.poisonRatio) {
        // Bava: veleno forte che si somma a quello già in corso, scalato da INT
        const add = damage
          .times(skill.poisonRatio)
          .times(Decimal.max(this.player.stats.int, 1));
        const active = this.enemy.poison.turnsLeft > 0;
        const perTurn = active ? this.enemy.poison.perTurn.plus(add) : add;
        const turns = Math.max(this.enemy.poison.turnsLeft, skill.poisonTurns) + this.mods.poisonTurns;
        this.enemy.poison = { perTurn, turnsLeft: turns };
        await this.emitEvent('onPoisonApplied', { perTurn: add, turns });
      }

      await this.applyFaceEffects();
    }

    if (await this.checkBattleEnd()) return;
    await this.enemyPhase();
  }

  /** Effetti delle facce incantate uscite nel lancio e loro reazioni */
  private async applyFaceEffects(): Promise<void> {
    const fx = this.getEffects();
    const has = (id: string) => fx.reactions.some(r => r.id === id);
    const shield = fx.shield.times(this.mods.shieldMult);
    const react = this.mods.reactionMult;

    if (shield.gt(0)) {
      this.player.shield = this.player.shield.plus(shield);
      await this.emitEvent('onShieldGained', { amount: shield });
    }
    if (fx.poison.gt(0)) {
      const perTurn = this.enemy.poison.turnsLeft > 0
        ? this.enemy.poison.perTurn.plus(fx.poison)
        : fx.poison;
      const turns = Math.max(this.enemy.poison.turnsLeft, POISON_BASE_TURNS)
        + (has('spore') ? SPORE_EXTRA_TURNS : 0) + this.mods.poisonTurns;
      this.enemy.poison = { perTurn, turnsLeft: turns };
      await this.emitEvent('onPoisonApplied', { perTurn: fx.poison, turns });
    }
    if (fx.fire.gt(0)) {
      this.enemy.hp = this.enemy.hp.minus(fx.fire); // ignora lo scudo
      await this.emitEvent('onDamageDealt', { target: 'enemy', amount: fx.fire });
    }
    if (has('vapori')) {
      const burst = this.enemy.poison.perTurn.times(react);
      this.enemy.hp = this.enemy.hp.minus(burst);
      await this.emitEvent('onReaction', { id: 'vapori', amount: burst });
    }
    if (has('scudo-ardente')) {
      const burn = shield.times(react);
      this.enemy.hp = this.enemy.hp.minus(burn);
      await this.emitEvent('onReaction', { id: 'scudo-ardente', amount: burn });
    }
    if (has('spore')) {
      await this.emitEvent('onReaction', { id: 'spore', amount: new Decimal(SPORE_EXTRA_TURNS) });
    }
  }

  /** 5. ENEMY_PHASE: esecuzione deterministica dell'intento (GDD §5.5) */
  private async enemyPhase(): Promise<void> {
    await this.setState(BattleState.ENEMY_PHASE);
    const intent = this.currentIntent;
    if (!intent) return;
    this.enemy.shield = new Decimal(0); // il vecchio scudo del nemico scade ora

    switch (intent.type) {
      case IntentType.ATTACK: {
        const blocked = Decimal.min(this.player.shield, intent.value);
        this.applyDamage(this.player, intent.value);
        if (this.reflectRatio && blocked.gt(0)) {
          const back = blocked.times(this.reflectRatio);
          this.applyDamage(this.enemy, back);
          await this.emitEvent('onReflect', { amount: back });
        }
        break;
      }
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
    this.reflectRatio = null;
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

  private tickPoison(c: Combatant, clearShield: boolean): void {
    if (c.poison.turnsLeft > 0) {
      c.hp = c.hp.minus(c.poison.perTurn);
      c.poison.turnsLeft--;
    }
    // Lo scudo di ciascuno scade all'inizio del PROPRIO turno
    if (clearShield) c.shield = new Decimal(0);
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
