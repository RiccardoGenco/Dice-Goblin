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
  pushLog,
  CombatantView,
  DieChip
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

  constructor(canvas: HTMLCanvasElement) {
    this.diceWorld = new DiceWorld(canvas);
    this.buildBag();
    this.newBattle(0);
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
    actLevel.set(level);
    battleResult.set(null);
    uiMode.set('idle');

    /* SCALING ESPONENZIALE DELLA DIFFICOLTÀ (GDD §4.2):
       HP = vit*10 e vit_nemica = base * 1.6^level
       → gli HP nemici seguono esattamente HPbase * 1.6^level. */
    const growth = new Decimal(BALANCE.ENEMY_HP_GROWTH).pow(level);
    const enemyStats: CombatantStats = {
      str: new Decimal(3).times(growth),
      int: new Decimal(1).times(growth),
      vit: new Decimal(8).times(growth),
      lck: 0
    };

    this.engine = new BattleEngine(this.playerStats, enemyStats, this.bag);
    this.equipment.syncPipeline(this.engine.pipeline);
    this.registerListeners();
    pushLog(`— Atto ${level + 1}: un Avventuriero si avvicina —`);
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
    });
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
  }

  public unequipSlot(slotIndex: number): void {
    const removed = this.equipment.unequip(slotIndex);
    if (removed) {
      this.equipment.syncPipeline(this.engine.pipeline);
      pushLog(`🗑️ Rimosso: ${removed.name}`);
    }
    equipVersion.update(v => v + 1);
  }

  /* ---------------- Fine battaglia ---------------- */

  public nextAct(): Promise<void> {
    this.newBattle(this.level + 1);
    return this.start();
  }

  public retry(): Promise<void> {
    this.newBattle(this.level);
    return this.start();
  }

  public resize(w: number, h: number): void {
    this.diceWorld.resize(w, h);
  }
}
