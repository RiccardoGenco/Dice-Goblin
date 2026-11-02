import Decimal from 'break_infinity.js';
import { BattleEngine, Combatant } from '@core/BattleEngine';
import { pipOf } from '@core/combos';
import { GoblinDie } from '@core/GoblinDie';
import { formatBigNumber } from '@core/format';
import { summarizeChain, multTier, magnitudeOf } from '@core/chain';
import { SKILLS } from '@core/skills';
import { EquipmentManager, DEMO_ITEMS, EquipmentItem } from '@core/equipment';
import {
  BALANCE,
  BattleState,
  CombatantStats,
  DieFace,
  EnemyIntent,
  FaceType,
  IntentType,
  Rarity,
  SkillId
} from '@core/types';
import { DiceWorld } from '@graphics/DiceWorld';
import { RunManager, BOSS_STAT_MULTIPLIER, CHAMPION_STAT_MULTIPLIER, freshRunState } from '@core/RunManager';
import { Shop, ShopOffer } from '@core/Shop';
import { Forge, ForgeOperation, ForgeContext } from '@core/Forge';
import { SaveManager } from '@core/SaveManager';
import { UNLOCKABLE_DICE, UNLOCK_BY_ACT, getBlueprint } from '@core/diceCatalog';
import {
  playerView,
  enemyView,
  intentView,
  battleState,
  rolledChips,
  overflowActive,
  rerollsLeft,
  diceBusy,
  comboView,
  battleResult,
  actLevel,
  equipVersion,
  uiPhase,
  goldView,
  runLabel,
  shopOffers,
  shopSpecial,
  crossroadSpecial,
  forgeSpecial,
  forgeOpsLeft,
  forgeVersion,
  rewardBanner,
  pushLog,
  CombatantView,
  DieChip,
  ShopOfferView,
  ForgeQuoteView,
  ForgeDieView,
  enemyInfo,
  emitFx,
  chainView,
  skillPreview,
  rollNonce,
  runProgress
} from './ui/stores';
import { ACT_BOSSES, CLASS_SPRITES } from './ui/spriteCatalog';

/* ============================================================
 * GameManager — Il collante (Piano Fase 5)
 *
 *   BattleEngine (logica) ←→ DiceWorld (3D) ←→ Store Svelte (DOM)
 *
 * - Gli eventi dell'engine aggiornano gli store reattivi.
 * - onDicesRolled riceve come waitUntilFinished la Promise di
 *   DiceWorld.throwDice: il Visual Blocking Callback del GDD §5
 *   si chiude qui, in un'unica riga.
 * ============================================================ */

const CHIP_CLASS: Record<FaceType, string> = {
  [FaceType.NORMAL]: 'normal',
  [FaceType.MULTIPLIER]: 'multiplier',
  [FaceType.BUFF_STR]: 'buff',
  [FaceType.RECURSIVE]: 'recursive'
};

const INTENT_META: Record<IntentType, { icon: string; label: string }> = {
  [IntentType.ATTACK]: { icon: '⚔️', label: 'Attacco' },
  [IntentType.SHIELD]: { icon: '🛡️', label: 'Scudo' },
  [IntentType.POISON]: { icon: '☠️', label: 'Veleno' },
  [IntentType.BUFF]: { icon: '💪', label: 'Potenziamento' }
};

export class GameManager {
  private engine!: BattleEngine;
  private readonly diceWorld: DiceWorld;
  public readonly equipment = new EquipmentManager();
  public readonly inventory: EquipmentItem[] = DEMO_ITEMS;

  /** Statistiche PERSISTENTI del giocatore: passate per riferimento
   *  all'engine, così i BUFF_STR conquistati sopravvivono tra le
   *  battaglie della run. */
  private readonly playerStats: CombatantStats = {
    str: new Decimal(10),
    int: new Decimal(1),
    vit: new Decimal(12),
    lck: 10
  };

  private bag: GoblinDie[] = [];
  private lastFaces: DieFace[] = [];
  /** Dado logico di ciascuna faccia di lastFaces (inclusi i lanci ricorsivi extra) */
  private lastSources: GoblinDie[] = [];
  private level = 0;

  /* ---- Meta-progressione (commit 11-13) ---- */
  public run = new RunManager();
  private readonly shop = new Shop();
  private readonly forge = new Forge();
  private readonly saveMgr = new SaveManager();
  private unlocks: string[] = [];
  private currentOffers: ShopOffer[] = [];
  /** Operazioni di forgia rimaste nella visita corrente */
  private opsLeft = 0;
  /** true = l'intermezzo corrente è speciale (post boss fight) */
  private intermissionSpecial = false;
  /** ACT_TRANSITION: dopo il Mercante Reale si apre la Gran Forgia */
  private grandForgeQueued = false;

  constructor(canvas: HTMLCanvasElement) {
    this.diceWorld = new DiceWorld(canvas);
    this.unlocks = this.saveMgr.loadUnlocks();

    // Ripristino automatico della run salvata (fail-safe: se il
    // salvataggio è corrotto, loadRun ritorna null e si riparte)
    const saved = this.saveMgr.loadRun();
    if (saved) {
      this.run = new RunManager(saved.run);
      this.playerStats.str = saved.playerStats.str;
      this.playerStats.int = saved.playerStats.int;
      this.playerStats.vit = saved.playerStats.vit;
      this.playerStats.lck = saved.playerStats.lck;
      this.bag = saved.bag;
      for (const id of saved.equipmentIds) {
        const item = DEMO_ITEMS.find(i => i.id === id);
        if (item) this.equipment.equip(item);
      }
      pushLog('💾 Run ripristinata dal salvataggio');
    } else {
      this.buildBag();
    }
    this.newBattle(this.run.level);
  }

  /* ---------------- Setup battaglia ---------------- */

  private buildBag(): void {
    const special: DieFace[] = [
      { value: new Decimal(5), type: FaceType.NORMAL },
      { value: new Decimal(10), type: FaceType.NORMAL },
      { value: new Decimal(2), type: FaceType.MULTIPLIER },
      { value: new Decimal(3), type: FaceType.MULTIPLIER },
      { value: new Decimal(2), type: FaceType.BUFF_STR },
      { value: new Decimal(1), type: FaceType.RECURSIVE }
    ];
    this.bag = [
      new GoblinDie(Rarity.COMUNE),
      new GoblinDie(Rarity.NON_COMUNE),
      new GoblinDie(Rarity.RARO),
      new GoblinDie(Rarity.EPICO),
      new GoblinDie(Rarity.LEGGENDARIO, special)
    ];
  }

  public newBattle(level: number): void {
    this.level = level;
    actLevel.set(this.run.state.act - 1);
    battleResult.set(null);
    uiPhase.set('battle');
    this.refreshRunHeader();

    /* SCALING ESPONENZIALE DELLA DIFFICOLTÀ (GDD §4.2):
       HP = vit*10 e vit_nemica = base * 1.6^level
       → gli HP nemici seguono esattamente HPbase * 1.6^level.
       Boss fight ogni 5 incontri: Campione (5°) x1.8, Boss (10°) x2.5. */
    const hpGrowth = new Decimal(BALANCE.ENEMY_HP_GROWTH).pow(level);
    const strGrowth = new Decimal(BALANCE.ENEMY_STR_GROWTH).pow(level);
    const bossMult = this.run.isActBoss
      ? BOSS_STAT_MULTIPLIER
      : this.run.isChampion
        ? CHAMPION_STAT_MULTIPLIER
        : 1;
    const enemyStats: CombatantStats = {
      str: new Decimal(3).times(strGrowth).times(bossMult),
      int: new Decimal(1).times(strGrowth).times(bossMult),
      vit: new Decimal(8).times(hpGrowth).times(bossMult),
      lck: 0
    };

    this.engine = new BattleEngine(this.playerStats, enemyStats, this.bag);
    this.equipment.syncPipeline(this.engine.pipeline);
    this.registerListeners();
    this.pickEnemyLook();
    pushLog(
      this.run.isActBoss
        ? `— 👑 ${this.run.label}: il BOSS sbarra la strada! —`
        : this.run.isChampion
          ? `— 🏆 ${this.run.label}: il Campione ti sfida! —`
          : `— ${this.run.label}: ${this.enemyName} si avvicina —`
    );
  }

  /** Sceglie sprite, nome e tinta del nemico (placeholder Arcana Siege).
   *  Normali: ciclo sulle 6 classi del content_specs; Campione: classe in
   *  tinta oro; Boss d'Atto: identità fissa per Atto. */
  private pickEnemyLook(): void {
    const { act, encounter } = this.run.state;
    if (this.run.isActBoss) {
      const b = ACT_BOSSES[(act - 1) % ACT_BOSSES.length]!;
      this.enemyName = b.name;
      enemyInfo.set({ name: b.name, sprite: b.sprite, tint: b.tint, tier: 'boss', hue: 0 });
      return;
    }
    const cls = CLASS_SPRITES[((act - 1) * 3 + encounter) % CLASS_SPRITES.length]!;
    if (this.run.isChampion) {
      this.enemyName = `Campione — ${cls.name}`;
      enemyInfo.set({ name: `Campione — ${cls.name}`, sprite: cls.sprite, tint: 'champion', tier: 'champion', hue: 0 });
      return;
    }
    // variante cromatica per incontro: stessa sprite, aspetto diverso
    const hue = cls.tint === 'none' ? (((act * 37 + encounter * 53) % 70) - 35) : 0;
    this.enemyName = cls.name;
    enemyInfo.set({ name: cls.name, sprite: cls.sprite, tint: cls.tint, tier: 'normal', hue });
  }

  private enemyName = 'Avventuriero';
  /** Moltiplicatore di overflow del tiro corrente (1 = nessun overflow) */
  private overflowMult = new Decimal(1);

  /** Anteprima per il giocatore: quanto farebbe ogni skill con questo tiro.
   *  Usa la STESSA pipeline della risoluzione (equip e overflow inclusi),
   *  quindi il numero mostrato coincide con quello che poi viene inflitto. */
  private refreshPreview(): void {
    const faces = this.lastFaces;
    if (faces.length === 0) return;
    const calc = (mod: Decimal, power = 1) => this.engine.calcDamage(mod, power);

    const fmt = formatBigNumber;
    const sgancio = calc(SKILLS[SkillId.SGANCIO_BRUTALE].skillMod);
    const scudo = calc(SKILLS[SkillId.SCUDO_GOBLIN].skillMod);
    const sputoBase = calc(SKILLS[SkillId.SPUTO_ACIDO].skillMod);
    const sputo = SKILLS[SkillId.SPUTO_ACIDO];
    const veleno = sputoBase.times(sputo.poisonRatio ?? 0).times(Decimal.max(this.engine.player.stats.int, 1));
    const colpo = SKILLS[SkillId.COLPO_COMBO];
    const combo = calc(colpo.skillMod, colpo.comboPower);

    skillPreview.set({
      [SkillId.SGANCIO_BRUTALE]: `${fmt(sgancio)} danni`,
      [SkillId.SCUDO_GOBLIN]: `+${fmt(scudo)} scudo`,
      [SkillId.SPUTO_ACIDO]: `${fmt(sputoBase)} + ☠${fmt(veleno)}×${sputo.poisonTurns}`,
      [SkillId.COLPO_COMBO]: `${fmt(combo)} danni`
    });

    const s = summarizeChain(faces);
    chainView.set({
      mult: fmt(s.multProduct),
      tier: multTier(s.multProduct),
      power: fmt(calc(new Decimal(1))),
      multCount: s.multCount
    });

    const c = this.engine.getCombo();
    comboView.set(c ? {
      id: c.def.id,
      name: c.def.name,
      mult: String(c.def.mult),
      tier: c.def.mult >= 4 ? 4 : c.def.mult >= 2.5 ? 3 : c.def.mult >= 1.8 ? 2 : c.def.mult > 1 ? 1 : 0
    } : null);
    rerollsLeft.set(this.engine.rerolls);
    const ov = this.engine.overflow;
    overflowActive.set(ov.active);
    this.overflowMult = ov.mult;
  }

  /** Quando i dadi si fermano: il palco annuncia il moltiplicatore totale */
  private announceChain(): void {
    const s = summarizeChain(this.lastFaces);
    const tier = multTier(s.multProduct);
    if (tier > 0) { emitFx('center', 'mult', `×${formatBigNumber(s.multProduct)}`, tier); return; }
    const c = this.engine.getCombo();
    if (c && c.def.id !== 'none' && c.def.mult >= 2.2) emitFx('center', 'mult', c.def.name, c.def.mult >= 4 ? 3 : 2);
  }

  private refreshRunHeader(): void {
    runLabel.set(this.run.label);
    runProgress.set({ act: this.run.state.act, encounter: this.run.state.encounter });
    goldView.set(formatBigNumber(this.run.state.gold));
  }

  public start(): Promise<void> {
    return this.engine.initTurn();
  }

  /* ---------------- Eventi engine -> store ---------------- */

  private registerListeners(): void {
    const e = this.engine;

    e.on('onStateChanged', p => {
      battleState.set(p.state as BattleState);
      rerollsLeft.set(this.engine.rerolls);
      this.refreshCombatants();
    });

    e.on('onEnemyIntent', p => {
      const intent = p.intent as EnemyIntent;
      const meta = INTENT_META[intent.type];
      intentView.set({
        icon: meta.icon,
        label: meta.label,
        value: formatBigNumber(intent.value)
      });
    });

    e.on('onDicesRolled', p => {
      const faces = p.dices as DieFace[];
      const sources = p.sources as GoblinDie[];
      this.lastFaces = faces;
      this.lastSources = sources;
      overflowActive.set(false);
      this.overflowMult = new Decimal(1);
      rolledChips.set(faces.map((f, i) => this.toChip(f, pipOf(sources[i]!, f))));
      rollNonce.update(n => n + 1);
      this.refreshPreview();
      // ← Il Visual Blocking Callback: la logica attende il 3D;
      // quando i dadi si fermano, il palco annuncia il moltiplicatore.
      p.waitUntilFinished = async () => {
        await this.diceWorld.throwDice(sources, faces);
        this.announceChain();
      };
    });

    e.on('onOverflowTriggered', p => {
      overflowActive.set(true);
      this.overflowMult = p.multiplier as Decimal;
      this.refreshPreview();
      emitFx('center', 'overflow', `OVERFLOW ×${formatBigNumber(this.overflowMult)}`, 4);
      pushLog(`⚠️ OVERFLOW! Catena troncata: danno ×${formatBigNumber(this.overflowMult)}`);
    });

    e.on('onDamageDealt', p => {
      emitFx('enemy', 'hit', formatBigNumber(p.amount as Decimal), magnitudeOf(p.amount as Decimal));
      pushLog(`💥 ${formatBigNumber(p.amount as Decimal)} danni a ${this.enemyName}`);
      this.refreshCombatants();
    });

    e.on('onShieldGained', p => {
      emitFx('player', 'shield', `+${formatBigNumber(p.amount as Decimal)}`, magnitudeOf(p.amount as Decimal));
      pushLog(`🛡️ Scudo del Goblin: ${formatBigNumber(p.amount as Decimal)} punti`);
      this.refreshCombatants();
    });

    e.on('onPoisonApplied', p => {
      emitFx('enemy', 'poison', `☠ ${formatBigNumber(p.perTurn as Decimal)}`);
      pushLog(`☠️ Veleno: ${formatBigNumber(p.perTurn as Decimal)}/turno × ${p.turns as number}`);
    });

    e.on('onEnemyAction', p => {
      const intent = p.intent as EnemyIntent;
      const meta = INTENT_META[intent.type];
      if (intent.type === IntentType.ATTACK) emitFx('player', 'hit', formatBigNumber(intent.value), magnitudeOf(intent.value));
      pushLog(`${meta.icon} ${this.enemyName} usa ${meta.label} (${formatBigNumber(intent.value)})`);
      this.refreshCombatants();
    });

    e.on('onBattleEnded', p => {
      battleResult.set(p.winner === 'player' ? 'victory' : 'defeat');
      this.refreshCombatants();
      if (p.winner === 'player') {
        this.onVictory();
      } else {
        // Roguelike: la sconfitta chiude la run (gli sblocchi meta restano)
        this.saveMgr.clearRun();
      }
    });
  }

  /** Vittoria: ricompensa in oro, avanzamento run, eventuale
   *  sblocco permanente del boss, autosave e apertura shop. */
  private onVictory(): void {
    const reward = this.run.goldReward();
    this.run.addGold(reward);
    pushLog(`💰 Bottino: ${formatBigNumber(reward)} oro`);

    // Le boss fight aprono gli intermezzi SPECIALI (specs §7.bis/§10):
    // Campione -> bivio dorato; Boss d'Atto -> Mercante Reale + Gran Forgia
    const wasChampion = this.run.isChampion;
    const wasActBoss = this.run.isActBoss;
    const beatenAct = this.run.state.act;
    const result = this.run.advance();

    if (result === 'act-completed' || result === 'run-completed') {
      // Sblocco ORIZZONTALE permanente (MVP §1): nuovo dado nel pool
      const unlockId = UNLOCK_BY_ACT[beatenAct];
      const bp = unlockId ? getBlueprint(unlockId) : undefined;
      if (bp && !this.unlocks.includes(bp.id)) {
        this.unlocks = this.saveMgr.addUnlock(bp.id);
        rewardBanner.set(`${bp.icon} Sbloccato per sempre: ${bp.name}!`);
        pushLog(`🔓 ${bp.name} aggiunto al pool delle run future`);
      } else {
        rewardBanner.set(null);
      }
    } else {
      rewardBanner.set(null);
    }

    if (result === 'run-completed') {
      this.saveMgr.clearRun(); // la run è finita: si riparte da zero
      uiPhase.set('run-complete');
      return;
    }

    this.autosave();

    if (wasActBoss) {
      // ACT_TRANSITION (specs §10): ENTRAMBI gli intermezzi speciali
      // in sequenza — Mercante Reale, poi Gran Forgia
      this.grandForgeQueued = true;
      this.openShop(true);
    } else {
      // Bivio (specs §7): due porte, se ne sceglie UNA.
      // Dorate dopo il Campione (§7.bis).
      this.openCrossroad(wasChampion);
    }
  }

  /* ---------------- Bivio (Intermission) ---------------- */

  private openCrossroad(special: boolean): void {
    this.intermissionSpecial = special;
    crossroadSpecial.set(special);
    this.refreshRunHeader();
    uiPhase.set('crossroad');
  }

  /** Scelta della porta: la porta non scelta si chiude. */
  public chooseDoor(door: 'shop' | 'forge'): void {
    if (door === 'shop') this.openShop(this.intermissionSpecial);
    else this.openForge(this.intermissionSpecial);
  }

  private toChip(face: DieFace, pip?: number): DieChip {
    const v = formatBigNumber(face.value);
    const text =
      face.type === FaceType.MULTIPLIER ? `×${v}` :
      face.type === FaceType.BUFF_STR ? `+STR ${v}` :
      face.type === FaceType.RECURSIVE ? `↻` : v;
    return { text, cssClass: CHIP_CLASS[face.type], pip };
  }

  private refreshCombatants(): void {
    playerView.set(this.toView(this.engine.player));
    enemyView.set(this.toView(this.engine.enemy));
  }

  private toView(c: Combatant): CombatantView {
    const hp = Decimal.max(c.hp, 0);
    return {
      hp: formatBigNumber(hp),
      maxHp: formatBigNumber(c.maxHp),
      hpRatio: Math.max(0, Math.min(1, hp.div(c.maxHp).toNumber())),
      shield: formatBigNumber(c.shield),
      poisonTurns: c.poison.turnsLeft
    };
  }

  /* ---------------- Azioni UI -> engine ---------------- */

  public async useSkill(id: SkillId): Promise<void> {
    if (this.engine.state !== BattleState.WAIT_PLAYER_ACTION) return;
    await this.engine.resolvePlayerAction(id);
  }

  /** Rilancio gratuito: rilancia i dadi scelti e lascia fermi gli altri */
  public async rerollDice(indices: number[]): Promise<void> {
    if (this.engine.state !== BattleState.WAIT_PLAYER_ACTION) return;
    const before = this.lastFaces.length;
    if (!this.engine.rerollSelected(indices)) return;
    const chosen = new Set(indices);
    const keep = new Set<number>();
    for (let i = 0; i < before; i++) if (!chosen.has(i)) keep.add(i);
    // lastFaces e lastSources sono le STESSE reference mutate dall'engine
    rolledChips.set(this.lastFaces.map((f, i) => this.toChip(f, pipOf(this.lastSources[i]!, f))));
    rollNonce.update(n => n + 1);
    this.refreshPreview();
    pushLog(`🎲 Rilanciati ${chosen.size} dadi (restano ${this.engine.rerolls})`);
    diceBusy.set(true);
    try {
      await this.diceWorld.throwDice(this.lastSources, this.lastFaces, keep);
    } finally {
      diceBusy.set(false);
    }
    this.announceChain();
  }

  /* ---------------- Equipaggiamento ---------------- */

  public equipItem(item: EquipmentItem): void {
    if (this.equipment.equip(item)) {
      this.equipment.syncPipeline(this.engine.pipeline);
      pushLog(`${item.icon} Equipaggiato: ${item.name}`);
    } else {
      pushLog(`✋ Slot pieni (o duplicato): scarta qualcosa prima!`);
    }
    equipVersion.update(v => v + 1);
    this.autosave();
  }

  public unequipSlot(slotIndex: number): void {
    const removed = this.equipment.unequip(slotIndex);
    if (removed) {
      this.equipment.syncPipeline(this.engine.pipeline);
      pushLog(`🗑️ Rimosso: ${removed.name}`);
    }
    equipVersion.update(v => v + 1);
    this.autosave();
  }

  /* ---------------- Shop e persistenza ---------------- */

  private openShop(special: boolean): void {
    const available = UNLOCKABLE_DICE.filter(bp => this.unlocks.includes(bp.id));
    this.currentOffers = this.shop.generateOffers(
      this.run.level,
      this.run.state.purchases,
      this.bag,
      available,
      special
    );
    shopSpecial.set(special);
    this.publishOffers();
    this.refreshRunHeader();
    uiPhase.set('shop');
  }

  private publishOffers(): void {
    const gold = this.run.state.gold;
    shopOffers.set(
      this.currentOffers.map<ShopOfferView>(o => ({
        id: o.id,
        icon: o.icon,
        label: o.label,
        description: o.description,
        cost: formatBigNumber(o.cost),
        affordable: gold.gte(o.cost)
      }))
    );
  }

  /** Acquisto dallo shop: addebita, applica, rigenera le viste.
   *  L'offerta comprata sparisce; le altre restano (ma i prezzi
   *  futuri saliranno di 1.25^acquisti). */
  public buyOffer(offerId: string): void {
    const offer = this.currentOffers.find(o => o.id === offerId);
    if (!offer) return;
    if (!this.run.spendGold(offer.cost)) {
      pushLog(`✋ Oro insufficiente per ${offer.label}`);
      return;
    }
    this.shop.apply(offer, {
      stats: this.playerStats,
      bag: this.bag,
      blueprints: UNLOCKABLE_DICE
    });
    pushLog(`${offer.icon} Acquistato: ${offer.label}`);
    this.currentOffers = this.currentOffers.filter(o => o.id !== offerId);
    this.publishOffers();
    this.refreshRunHeader();
    this.autosave();
  }

  /** Chiude lo shop. In ACT_TRANSITION la catena prosegue con
   *  la Gran Forgia; altrimenti si va al prossimo incontro. */
  public leaveShop(): Promise<void> {
    rewardBanner.set(null);
    if (this.grandForgeQueued) {
      this.grandForgeQueued = false;
      this.openForge(true);
      return Promise.resolve();
    }
    this.newBattle(this.run.level);
    return this.start();
  }

  /* ---------------- Forgia ---------------- */

  private forgeCtx(): ForgeContext {
    return {
      level: this.run.level,
      purchases: this.run.state.purchases,
      special: this.intermissionSpecial
    };
  }

  private openForge(special: boolean): void {
    this.intermissionSpecial = special;
    this.opsLeft = this.forge.opsPerVisit(special);
    forgeSpecial.set(special);
    forgeOpsLeft.set(this.opsLeft);
    forgeVersion.update(v => v + 1);
    this.refreshRunHeader();
    uiPhase.set('forge');
  }

  /** Vista della borsa per la UI della forgia */
  public getForgeBagView(): ForgeDieView[] {
    const RARITY_NAME = ['Comune', 'Non Comune', 'Raro', 'Epico', 'Leggendario'];
    const RARITY_ICON = ['⚪', '🟢', '🔵', '🟣', '🟠'];
    return this.bag.map(die => ({
      icon: RARITY_ICON[die.rarity] ?? '⚪',
      rarityName: RARITY_NAME[die.rarity] ?? '?',
      blueprintName: die.blueprintId
        ? (getBlueprint(die.blueprintId)?.name ?? null)
        : null,
      faces: die.faces.map(f => this.toChip(f)),
      specialCount: die.faces.filter(f => f.type !== FaceType.NORMAL).length
    }));
  }

  private toQuoteView(op: ForgeOperation): ForgeQuoteView {
    const q = this.forge.quote(op, this.bag, this.forgeCtx());
    const view: ForgeQuoteView = { ok: q.ok, cost: formatBigNumber(q.cost) };
    if (q.reason !== undefined) view.reason = q.reason;
    if (q.preview !== undefined) view.preview = q.preview;
    return view;
  }

  public quoteTempra(dieIndex: number, faceIndex: number): ForgeQuoteView {
    return this.toQuoteView({ kind: 'tempra', dieIndex, faceIndex });
  }

  public quoteTrasmutazione(dieIndex: number, faceIndex: number, target: FaceType): ForgeQuoteView {
    return this.toQuoteView({ kind: 'trasmutazione', dieIndex, faceIndex, target });
  }

  public quoteFusione(targetIndex: number, sacrificeIndex: number): ForgeQuoteView {
    return this.toQuoteView({ kind: 'fusione', targetIndex, sacrificeIndex });
  }

  public quoteRiforgiatura(dieIndex: number): ForgeQuoteView {
    return this.toQuoteView({ kind: 'riforgiatura', dieIndex });
  }

  /** Esegue un'operazione di forgia: preventivo -> addebito ->
   *  mutazione -> autosave. Le texture 3D si rigenerano da sole
   *  al prossimo lancio (DieTextureSet per-throw). */
  public applyForge(op: ForgeOperation): void {
    if (this.opsLeft <= 0) {
      pushLog('✋ Operazioni esaurite per questa visita');
      return;
    }
    const q = this.forge.quote(op, this.bag, this.forgeCtx());
    if (!q.ok) {
      pushLog(`✋ ${q.reason ?? 'Operazione non valida'}`);
      return;
    }
    if (!this.run.spendGold(q.cost)) {
      pushLog('✋ Oro insufficiente');
      return;
    }
    this.forge.apply(op, this.bag);
    this.opsLeft--;
    forgeOpsLeft.set(this.opsLeft);
    forgeVersion.update(v => v + 1);
    this.refreshRunHeader();
    this.autosave();
    pushLog(`🔨 Forgia: ${q.preview ?? 'operazione completata'}`);
  }

  /** Chiude la forgia e avvia l'incontro successivo */
  public leaveForge(): Promise<void> {
    rewardBanner.set(null);
    this.newBattle(this.run.level);
    return this.start();
  }

  private autosave(): void {
    this.saveMgr.saveRun({
      run: this.run.state,
      playerStats: this.playerStats,
      bag: this.bag,
      equipmentIds: this.equipment.slots
        .filter((s): s is EquipmentItem => s !== null)
        .map(s => s.id)
    });
  }

  /** Nuova run da zero: reset di stat, borsa, oro e slot.
   *  Gli sblocchi META restano: il pool dadi è più ricco. */
  public newRun(): Promise<void> {
    this.saveMgr.clearRun();
    this.run = new RunManager(freshRunState());
    this.playerStats.str = new Decimal(10);
    this.playerStats.int = new Decimal(1);
    this.playerStats.vit = new Decimal(12);
    this.playerStats.lck = 10;
    for (let i = 0; i < this.equipment.slots.length; i++) this.equipment.unequip(i);
    equipVersion.update(v => v + 1);
    this.buildBag();
    this.newBattle(0);
    return this.start();
  }

  public resize(w: number, h: number): void {
    this.diceWorld.resize(w, h);
  }
}
