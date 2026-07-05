import Decimal from 'break_infinity.js';
import { BattleEngine, Combatant } from '@core/BattleEngine';
import { GoblinDie } from '@core/GoblinDie';
import { formatBigNumber } from '@core/format';
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
import { SaveManager } from '@core/SaveManager';
import { UNLOCKABLE_DICE, UNLOCK_BY_ACT, getBlueprint } from '@core/diceCatalog';
import {
  playerView,
  enemyView,
  intentView,
  battleState,
  rolledChips,
  overflowActive,
  uiMode,
  battleResult,
  actLevel,
  equipVersion,
  uiPhase,
  goldView,
  runLabel,
  shopOffers,
  shopSpecial,
  rewardBanner,
  pushLog,
  CombatantView,
  DieChip,
  ShopOfferView
} from './ui/stores';

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
  private level = 0;

  /* ---- Meta-progressione (commit 11-13) ---- */
  public run = new RunManager();
  private readonly shop = new Shop();
  private readonly saveMgr = new SaveManager();
  private unlocks: string[] = [];
  private currentOffers: ShopOffer[] = [];

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
    uiMode.set('idle');
    uiPhase.set('battle');
    this.refreshRunHeader();

    /* SCALING ESPONENZIALE DELLA DIFFICOLTÀ (GDD §4.2):
       HP = vit*10 e vit_nemica = base * 1.6^level
       → gli HP nemici seguono esattamente HPbase * 1.6^level.
       Boss fight ogni 5 incontri: Campione (5°) x1.8, Boss (10°) x2.5. */
    const growth = new Decimal(BALANCE.ENEMY_HP_GROWTH).pow(level);
    const bossMult = this.run.isActBoss
      ? BOSS_STAT_MULTIPLIER
      : this.run.isChampion
        ? CHAMPION_STAT_MULTIPLIER
        : 1;
    const enemyStats: CombatantStats = {
      str: new Decimal(3).times(growth).times(bossMult),
      int: new Decimal(1).times(growth).times(bossMult),
      vit: new Decimal(8).times(growth).times(bossMult),
      lck: 0
    };

    this.engine = new BattleEngine(this.playerStats, enemyStats, this.bag);
    this.equipment.syncPipeline(this.engine.pipeline);
    this.registerListeners();
    pushLog(
      this.run.isActBoss
        ? `— 👑 ${this.run.label}: il BOSS sbarra la strada! —`
        : this.run.isChampion
          ? `— 🏆 ${this.run.label}: il Campione ti sfida! —`
          : `— ${this.run.label}: un Avventuriero si avvicina —`
    );
  }

  private refreshRunHeader(): void {
    runLabel.set(this.run.label);
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
      this.lastFaces = faces;
      overflowActive.set(false);
      rolledChips.set(faces.map(f => this.toChip(f)));
      // ← Il Visual Blocking Callback: la logica attende il 3D
      p.waitUntilFinished = () => this.diceWorld.throwDice(this.bag, faces);
    });

    e.on('onOverflowTriggered', p => {
      overflowActive.set(true);
      pushLog(`⚠️ OVERFLOW! Catena troncata: danno ×${formatBigNumber(p.multiplier as Decimal)}`);
    });

    e.on('onDamageDealt', p => {
      pushLog(`💥 ${formatBigNumber(p.amount as Decimal)} danni all'Avventuriero`);
      this.refreshCombatants();
    });

    e.on('onShieldGained', p => {
      pushLog(`🛡️ Scudo del Goblin: ${formatBigNumber(p.amount as Decimal)} punti`);
      this.refreshCombatants();
    });

    e.on('onPoisonApplied', p => {
      pushLog(`☠️ Veleno: ${formatBigNumber(p.perTurn as Decimal)}/turno × ${p.turns as number}`);
    });

    e.on('onEnemyAction', p => {
      const intent = p.intent as EnemyIntent;
      const meta = INTENT_META[intent.type];
      pushLog(`${meta.icon} L'Avventuriero usa ${meta.label} (${formatBigNumber(intent.value)})`);
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

    // Le boss fight (Campione e Boss d'Atto) aprono l'intermezzo
    // SPECIALE: Mercante Reale (sconto + offerta premium)
    const wasBossFight = this.run.isBossFight;
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
    this.openShop(wasBossFight);
  }

  private toChip(face: DieFace): DieChip {
    const v = formatBigNumber(face.value);
    const text =
      face.type === FaceType.MULTIPLIER ? `×${v}` :
      face.type === FaceType.BUFF_STR ? `+STR ${v}` :
      face.type === FaceType.RECURSIVE ? `↻` : v;
    return { text, cssClass: CHIP_CLASS[face.type] };
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

    if (id === SkillId.TIRO_TRUCCATO) {
      // Entra in modalità reroll: la UI seleziona fino a 2 chip
      uiMode.set('reroll');
      return;
    }
    await this.engine.resolvePlayerAction(id);
  }

  /** Conferma del Tiro Truccato: rilancia i dadi scelti, ripete
   *  visivamente il lancio, poi risolve con skillMod 0.5. */
  public async confirmRerolls(indices: number[]): Promise<void> {
    uiMode.set('idle');
    if (indices.length > 0) {
      this.engine.rerollDice(indices, SkillId.TIRO_TRUCCATO);
      // lastFaces è la STESSA reference mutata dall'engine
      rolledChips.set(this.lastFaces.map(f => this.toChip(f)));
      pushLog(`🎲 Tiro Truccato: rilanciati ${indices.length} dadi`);
      await this.diceWorld.throwDice(this.bag, this.lastFaces);
    }
    await this.engine.resolvePlayerAction(SkillId.TIRO_TRUCCATO);
  }

  public cancelReroll(): void {
    uiMode.set('idle');
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

  /** Chiude lo shop e avvia l'incontro successivo della run */
  public leaveShop(): Promise<void> {
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
