import Decimal from 'break_infinity.js';
import { GoblinDie } from './GoblinDie';
import type { EnemyPattern, BossRules, IntentStep } from './enemies';
import { rollTurnEvent } from './turnEvents';
import type { TurnEvent } from './turnEvents';
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
  | 'onPhase' // il nemico passa alla fase 2
  | 'onTurnEvent' // imprevisto di turno
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
  /** Per ogni faccia, l'indice della "carta" della mano da cui discende:
   *  una carta è un dado pescato (o tenuto da Carica); i lanci extra della
   *  ricorsione seguono la carta che li ha generati e non occupano slot. */
  rootOf: number[];
  /** Dadi ricorsivi non lanciati (Dopamine Cap), contati sulla carta di origine */
  pendingOf: number[];
  /** Carte nella mano (facce con rootOf[i] === i) */
  baseCount: number;
}

/** Carta con la sua catena di dadi ricorsivi in coda */
interface QueuedDie { die: GoblinDie; root: number }

export class BattleEngine {
  public state: BattleState = BattleState.INIT_TURN;
  public readonly pipeline = new DamagePipeline();

  public player: Combatant;
  public enemy: Combatant;
  public currentIntent: EnemyIntent | null = null;
  /** Schema fisso del nemico (null = sorteggio, come nelle prime versioni) */
  public enemyPattern: EnemyPattern | null = null;
  /** Regole speciali del boss */
  public bossRules: BossRules | null = null;
  /** Fase 2 del nemico (si attiva sotto metà HP) */
  public phase2: { pattern: EnemyPattern; text: string } | null = null;
  public phase = 1;
  /** Imprevisti di turno: l'Atto in corso (0 = spenti) e quello attivo adesso */
  public eventAct = 0;
  public turnEvent: TurnEvent | null = null;
  private turnNumber = 0;
  /** Passo dello schema del turno corrente */
  private patternIdx = 0;
  private patternTurn = 0;

  private listeners = new Map<BattleEventName, Listener[]>();
  private lastRoll: RollResult | null = null;
  /** Facce messe da parte da Carica: si aggiungono ai dadi del turno dopo */
  private carried: { faces: DieFace[]; sources: GoblinDie[]; rootOf: number[]; pendingOf: number[] } | null = null;
  /** Carte della mano scelte per il turno (indici delle radici) */
  private selected = new Set<number>();
  /** Rimbalzo attivo della Parata durante la fase nemica */
  private reflectRatio: Decimal | null = null;
  /** Regole modificate dagli oggetti equipaggiati (le imposta chi equipaggia) */
  public mods: ItemMods = neutralMods();
  private ctxSkill: SkillId | null = null;
  /** Il lancio corrente arriva da una Carica: danno ×CHARGE_BONUS */
  private chargedRoll = false;
  public get charged(): boolean { return this.chargedRoll; }
  /** Facce conservate da Carica (per la UI) */
  public get carriedCount(): number { return this.carried?.faces.length ?? 0; }
  /** Dadi che si possono giocare in questo turno */
  public get playSlots(): number { return Math.max(1, BALANCE.HAND_PLAY + this.mods.extraPlay); }
  /** Dadi pescati dalla borsa a inizio turno */
  public get drawCount(): number {
    const ev = this.turnEvent?.id === 'mano-ridotta' ? 1 : 0;
    return Math.max(1, BALANCE.HAND_DRAW + this.mods.extraDraw - (this.bossRules?.handPenalty ?? 0) - ev);
  }
  /** Indici delle carte della mano (le radici) */
  public get cards(): number[] {
    const r = this.lastRoll;
    if (!r) return [];
    const out: number[] = [];
    r.rootOf.forEach((root, i) => { if (root === i) out.push(i); });
    return out;
  }
  /** Carte scelte per il turno */
  public get selection(): number[] { return [...this.selected].sort((a, b) => a - b); }
  /** Facce giocate: quelle delle carte scelte e dei loro lanci extra */
  public get playedFaces(): DieFace[] {
    const r = this.lastRoll;
    return r ? r.faces.filter((_, i) => this.selected.has(r.rootOf[i]!)) : [];
  }
  /** Indici (in lastRoll.faces) delle facce giocate */
  public get playedIndices(): number[] {
    const r = this.lastRoll;
    const out: number[] = [];
    if (r) r.faces.forEach((_, i) => { if (this.selected.has(r.rootOf[i]!)) out.push(i); });
    return out;
  }

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
    this.selected = new Set();

    // Applica il veleno al nemico (calcolato in Decimal)
    this.tickPoison(this.enemy, false); // lo scudo nemico resta fino al suo prossimo turno
    this.tickPoison(this.player, true);

    if (await this.checkBattleEnd()) return;

    // Fase 2: sotto metà HP il nemico cambia schema, e il giocatore lo vede subito
    if (this.phase2 && this.phase === 1 && this.enemy.hp.lte(this.enemy.maxHp.times(0.5))) {
      this.phase = 2;
      this.enemyPattern = this.phase2.pattern;
      this.patternTurn = 0;
      await this.emitEvent('onPhase', { text: this.phase2.text });
    }

    // Imprevisto di turno (dall'Atto 2): non annunciato dall'avversario
    this.turnNumber++;
    const prevEvent = this.turnEvent;
    this.turnEvent = this.eventAct > 0 ? rollTurnEvent(this.rng, this.eventAct, this.turnNumber, prevEvent?.id ?? null) : null;
    if (this.turnEvent) {
      if (this.turnEvent.id === 'pioggia-curativa') {
        this.player.hp = Decimal.min(this.player.maxHp, this.player.hp.plus(this.player.maxHp.times(0.1)));
      }
      await this.emitEvent('onTurnEvent', { event: this.turnEvent });
    }

    // Il nemico dichiara l'intento del turno (deterministico, MVP §2)
    this.currentIntent = this.computeEnemyIntent();
    if (this.turnEvent?.id === 'furia-nemica' && this.currentIntent.type !== IntentType.BUFF) {
      this.currentIntent = { ...this.currentIntent, value: this.currentIntent.value.times(1.3) };
    }
    await this.emitEvent('onEnemyIntent', { intent: this.currentIntent });

    await this.rollPhase();
  }

  /** 2. ROLL_PHASE: pesca la mano dalla borsa e la lancia una volta sola;
   *  la catena ricorsiva è protetta dal Dopamine Cap (GDD §3.3).
   *  Il giocatore sceglie poi quali dadi giocare. */
  private async rollPhase(): Promise<void> {
    await this.setState(BattleState.ROLL_PHASE);
    this.lastRoll = this.rollHand();
    this.autoSelect();

    await this.emitEvent('onDicesRolled', {
      dices: this.lastRoll.faces,
      sources: this.lastRoll.sources,
      overflowed: this.handOverflow().active
      // La UI aggiunge qui il proprio waitUntilFinished
    });

    const ov = this.handOverflow();
    if (ov.active) {
      await this.emitEvent('onOverflowTriggered', { multiplier: ov.mult });
    }

    await this.setState(BattleState.WAIT_PLAYER_ACTION);
  }

  /** Pesca `drawCount` dadi diversi dalla borsa (senza ripetizioni) */
  private drawHand(): GoblinDie[] {
    const pool = [...this.diceBag];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    return pool.slice(0, this.drawCount);
  }

  /**
   * Lancio della mano con Anti-Loop (Dopamine Cap, GDD §3.3):
   * ogni faccia RECURSIVE accoda un dado extra. Alla soglia
   * MAX_CHAIN (30) la catena si interrompe e i dadi pendenti
   * vengono convertiti in un moltiplicatore forzato:
   *
   *   Danno = Accumulato * 1.5^(dadi rimanenti stimati)
   *
   * L'overflow vale solo per le carte giocate: i dadi pendenti sono
   * contati sulla carta ricorsiva che li ha generati.
   */
  private rollHand(): RollResult {
    const res: RollResult = { faces: [], sources: [], rootOf: [], pendingOf: [], baseCount: 0 };
    // Carica: le facce messe da parte aprono la mano, poi i dadi pescati
    this.chargedRoll = !!this.carried;
    if (this.carried) {
      res.faces.push(...this.carried.faces);
      res.sources.push(...this.carried.sources);
      res.rootOf.push(...this.carried.rootOf);
      res.pendingOf.push(...this.carried.pendingOf);
      res.baseCount += this.carried.rootOf.filter((r, i) => r === i).length;
      this.carried = null;
    }
    const queue: QueuedDie[] = [];
    for (const die of this.drawHand()) {
      const idx = res.faces.length;
      const face = die.roll(this.player.stats.lck);
      res.faces.push(face);
      res.sources.push(die);
      res.rootOf.push(idx);
      res.pendingOf.push(0);
      res.baseCount++;
      this.afterFace(face, queue, idx);
    }
    this.extendChain(res, queue);
    return res;
  }

  /** Lancia i dadi in coda aggiungendo le facce al risultato; ogni faccia
   *  RECURSIVE accoda un dado extra. Oltre MAX_CHAIN i dadi pendenti
   *  diventano il moltiplicatore forzato dell'overflow. */
  private extendChain(res: RollResult, queue: QueuedDie[]): void {
    while (queue.length > 0) {
      if (res.faces.length >= BALANCE.MAX_CHAIN) {
        for (const q of queue) res.pendingOf[q.root] = (res.pendingOf[q.root] ?? 0) + 1;
        break;
      }
      const { die, root } = queue.shift()!;
      const face = die.roll(this.player.stats.lck);
      res.faces.push(face);
      res.sources.push(die);
      res.rootOf.push(root);
      res.pendingOf.push(0);
      this.afterFace(face, queue, root);
    }
  }

  /** Effetti immediati di una faccia appena uscita */
  private afterFace(face: DieFace, queue: QueuedDie[], root: number): void {
    if (face.type === FaceType.RECURSIVE) {
      // Il dado ricorsivo genera un lancio extra (dado casuale della borsa)
      const extra = this.diceBag[Math.floor(this.rng.next() * this.diceBag.length)];
      if (extra) queue.push({ die: extra, root });
    }
  }

  /** Overflow di un insieme di carte */
  private overflowOf(roots: Iterable<number>): { active: boolean; mult: Decimal } {
    const r = this.lastRoll;
    let pending = 0;
    if (r) for (const c of roots) pending += r.pendingOf[c] ?? 0;
    return { active: pending > 0, mult: pending > 0 ? new Decimal(BALANCE.OVERFLOW_MULT_BASE).pow(pending) : new Decimal(1) };
  }
  private handOverflow() { return this.overflowOf(this.cards); }

  /* ---------------- Scelta della mano ---------------- */

  /** Gioca/toglie una carta. Rifiuta se gli slot sono pieni o se si svuoterebbe la selezione. */
  public toggleCard(card: number): boolean {
    if (this.state !== BattleState.WAIT_PLAYER_ACTION || !this.lastRoll) return false;
    if (!this.cards.includes(card)) return false;
    if (this.selected.has(card)) {
      if (this.selected.size <= 1) return false;
      this.selected.delete(card);
      return true;
    }
    if (this.selected.size >= this.playSlots) return false;
    this.selected.add(card);
    return true;
  }

  /** Sceglie le carte da giocare (come toggleCard ma in blocco); false se non valida */
  public setSelection(cards: number[]): boolean {
    if (this.state !== BattleState.WAIT_PLAYER_ACTION || !this.lastRoll) return false;
    const valid = [...new Set(cards)].filter(c => this.cards.includes(c));
    if (valid.length === 0 || valid.length > this.playSlots) return false;
    this.selected = new Set(valid);
    return true;
  }

  /** Mano migliore per il danno dello Sgancio: è la scelta di partenza,
   *  così chi non vuole pensarci conferma e basta. */
  public autoSelect(): void {
    const cards = this.cards;
    const k = Math.min(this.playSlots, cards.length);
    if (k === 0) return;
    const sgancio = SKILLS[SkillId.SGANCIO_BRUTALE];
    let best: number[] = cards.slice(0, k);
    let bestDmg: Decimal | null = null;
    const walk = (start: number, pick: number[]) => {
      if (pick.length === k) {
        this.selected = new Set(pick);
        const d = this.calcDamage(sgancio.skillMod, SkillId.SGANCIO_BRUTALE);
        if (!bestDmg || d.gt(bestDmg)) { bestDmg = d; best = [...pick]; }
        return;
      }
      for (let i = start; i < cards.length; i++) walk(i + 1, [...pick, cards[i]!]);
    };
    walk(0, []);
    this.selected = new Set(best);
  }

  /** Effetti e reazioni delle facce del lancio corrente */
  public getEffects(): EffectSummary {
    return summarizeEffects(this.playedFaces, FIRE_DAMAGE_FACTOR + this.mods.fireFactor);
  }

  /** Il contesto che gli oggetti leggono per le loro condizioni */
  public itemCtx(skill?: SkillId | null): ItemCtx {
    const r = this.lastRoll;
    return buildCtx({
      skill: skill !== undefined ? skill : this.ctxSkill,
      faces: this.playedFaces,
      extraDice: Math.max(0, this.playedFaces.length - this.selected.size),
      reactions: this.getEffects().reactions.length,
      benched: r ? Math.max(0, r.baseCount - this.selected.size) : 0,
      hpRatio: this.player.hp.div(Decimal.max(this.player.maxHp, 1)).toNumber(),
      enemyPoisoned: this.enemy.poison.turnsLeft > 0,
      enemyShielded: this.enemy.shield.gt(0),
      charged: this.chargedRoll
    });
  }

  /** Stato dell'overflow del lancio corrente */
  public get overflow(): { active: boolean; mult: Decimal } {
    return this.overflowOf(this.selected);
  }

  /** Danno del lancio corrente con un dato vettore mossa (anteprima e
   *  risoluzione usano lo STESSO calcolo, overflow incluso). */
  public calcDamage(skillMod: Decimal, skillId: SkillId | null = null): Decimal {
    const r = this.lastRoll;
    if (!r) return new Decimal(0);
    this.ctxSkill = skillId;
    let dmg: Decimal;
    try {
      dmg = this.pipeline.calculateTurnDamage(this.player.stats.str.plus(this.buffNow()), this.playedFaces, skillMod);
    } finally {
      this.ctxSkill = null;
    }
    const ov = this.overflowOf(this.selected);
    if (ov.active) dmg = dmg.times(ov.mult);
    if (this.chargedRoll) dmg = dmg.times(BALANCE.CHARGE_BONUS + this.mods.chargeBonus);
    if (this.turnEvent?.id === 'eco-tuono') dmg = dmg.times(1.5);
    return dmg;
  }

  /** Forza data dalle facce BUFF_STR giocate (vale subito e resta per il combattimento) */
  private buffNow(): Decimal {
    return this.playedFaces.reduce((a, f) => (f.type === FaceType.BUFF_STR ? a.plus(f.value) : a), new Decimal(0));
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
    const buff = this.buffNow();
    if (buff.gt(0)) this.player.stats.str = this.player.stats.str.plus(buff);

    if (skill.carriesRoll) {
      // Carica: nessun attacco e nessun effetto di faccia ora; il lancio resta
      const r = this.lastRoll;
      const keep = r.faces.map((_, i) => i).filter(i => this.selected.has(r.rootOf[i]!));
      const remap = new Map(keep.map((old, n) => [old, n]));
      this.carried = {
        faces: keep.map(i => r.faces[i]!),
        sources: keep.map(i => r.sources[i]!),
        rootOf: keep.map(i => remap.get(r.rootOf[i]!)!),
        pendingOf: keep.map(i => r.pendingOf[i]!)
      };
      await this.emitEvent('onCharge', { count: keep.length });
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
    // Regola del boss: si cura a ogni turno nemico
    const regen = this.bossRules?.regenPct;
    if (regen && this.enemy.hp.gt(0)) {
      this.enemy.hp = Decimal.min(this.enemy.maxHp, this.enemy.hp.plus(this.enemy.maxHp.times(regen)));
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
  private intentFromStep(step: IntentStep): EnemyIntent {
    const m = step.mult ?? 1;
    const st = this.enemy.stats;
    const out: EnemyIntent =
      step.type === IntentType.ATTACK ? { type: step.type, value: st.str.times(2).times(m) } :
      step.type === IntentType.SHIELD ? { type: step.type, value: st.str.times(1.5).times(m) } :
      step.type === IntentType.POISON ? { type: step.type, value: st.int.times(3).times(m), duration: 3 } :
      { type: step.type, value: st.str.times(0.15).times(m) };
    if (step.tag) out.tag = step.tag;
    return out;
  }

  /** I prossimi intenti dello schema (dopo quello corrente), con le statistiche di adesso:
   *  un Potenziamento in mezzo li rende approssimativi. Vuoto senza schema. */
  public peekIntents(count: number): EnemyIntent[] {
    const pat = this.enemyPattern;
    if (!pat) return [];
    const out: EnemyIntent[] = [];
    for (let i = 1; i <= count; i++) {
      out.push(this.intentFromStep(pat.steps[(this.patternIdx + i) % pat.steps.length]!));
    }
    return out;
  }

  private computeEnemyIntent(): EnemyIntent {
    if (this.enemyPattern) {
      const steps = this.enemyPattern.steps;
      // il passo avanza a ogni turno, quindi parte da 0 solo al primo
      this.patternIdx = this.patternTurn++ % steps.length;
      return this.intentFromStep(steps[this.patternIdx]!);
    }
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
