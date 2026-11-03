import Decimal from 'break_infinity.js';
import { get } from 'svelte/store';
import { BattleEngine, Combatant } from '@core/BattleEngine';
import { GoblinDie } from '@core/GoblinDie';
import { formatBigNumber, formatFaceValue } from '@core/format';
import { summarizeChain, multTier, magnitudeOf } from '@core/chain';
import { SKILLS } from '@core/skills';
import { EFFECT_META, REACTIONS, ReactionId } from '@core/effects';
import { EquipmentManager, findItem, EquipmentItem, describeActiveItems } from '@core/equipment';
import {
  RunLog, faceLabel, saveCurrentLog, loadCurrentLog, saveLastLog, loadLastLog
} from '@core/RunLog';
import {
  BALANCE,
  BattleState,
  defaultRNG,
  CombatantStats,
  DieFace,
  EnemyIntent,
  FaceEffect,
  FaceType,
  IntentType,
  Rarity,
  SkillId
} from '@core/types';
import { DiceWorld } from '@graphics/DiceWorld';
import { RunManager, BOSS_HP_MULTIPLIER, BOSS_STR_MULTIPLIER, CHAMPION_STAT_MULTIPLIER, freshRunState } from '@core/RunManager';
import { Shop, ShopOffer, POTION_HEAL } from '@core/Shop';
import { Forge, ForgeOperation, ForgeContext } from '@core/Forge';
import { SaveManager } from '@core/SaveManager';
import { UNLOCKABLE_DICE, UNLOCK_BY_ACT, getBlueprint } from '@core/diceCatalog';
import {
  playerView,
  enemyView,
  intentView,
  intentQueue,
  bossRuleText,
  battleState,
  rolledChips,
  overflowActive,
  handSelection,
  settings,
  handInfo,
  diceBusy,
  effectsView,
  battleResult,
  actLevel,
  equipVersion,
  uiPhase,
  goldView,
  goldNum,
  runLabel,
  shopOffers,
  shopInfo,
  skillHints,
  shopSpecial,
  crossroadSpecial,
  doors,
  eventView,
  rewardChoices,
  rewardKind,
  bagOptions,
  replacePrompt,
  bagPickerOpen,
  goalsView,
  forgeSpecial,
  forgeOpsLeft,
  forgeVersion,
  rewardBanner,
  pushLog,
  CombatantView,
  DieChip,
  IntentView,
  ShopOfferView,
  ForgeQuoteView,
  ForgeDieView,
  enemyInfo,
  emitFx,
  chainView,
  skillPreview,
  rollNonce,
  runProgress,
  menuOpen,
  menuInfo,
  runSummary,
  RunSummaryView
} from './ui/stores';
import { ACT_BOSSES, CLASS_SPRITES } from './ui/spriteCatalog';
import { BAGS, GOALS, buildStarterBag, getBag, completedGoals, MetaStats } from '@core/meta';
import { DoorKind, DOOR_META, REST_HEAL, ELITE_HP_MULT, ELITE_STR_MULT, pickDoors, pickEvent, pickEliteRewards, pickRelics, weakestSlot, EventDef } from '@core/crossroad';
import { enemyProfileFor, EnemyProfile } from './core/enemies';
import { sfx } from './audio';

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

const INTENT_META: Record<IntentType, { icon: string; label: string; kind: IntentView['kind']; tip: string }> = {
  [IntentType.ATTACK]: { icon: '⚔️', label: 'Attacco', kind: 'attack', tip: 'Para o chiudi in fretta' },
  [IntentType.SHIELD]: { icon: '🛡️', label: 'Scudo', kind: 'shield', tip: 'Non para: colpisci' },
  [IntentType.POISON]: { icon: '☠️', label: 'Veleno', kind: 'poison', tip: 'Lo scudo non serve' },
  [IntentType.BUFF]: { icon: '💪', label: 'Potenziamento', kind: 'buff', tip: 'Non attacca: colpisci' }
};

function intentToView(i: EnemyIntent): IntentView {
  const m = INTENT_META[i.type];
  return { icon: m.icon, label: i.tag ?? m.label, value: formatBigNumber(i.value), kind: m.kind, tip: m.tip };
}

export class GameManager {
  private engine!: BattleEngine;
  private readonly diceWorld: DiceWorld;
  public readonly equipment = new EquipmentManager();

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
  /** Registro della run: ogni scelta e conseguenza, esportabile */
  private log!: RunLog;
  private turnNo = 0;
  private prevPlayerHp = new Decimal(0);
  private started = false;
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
  private shopRerolls = 0;
  private shopIsSpecial = false;
  /** Operazioni di forgia rimaste nella visita corrente */
  private opsLeft = 0;
  /** true = l'intermezzo corrente è speciale (post boss fight) */
  private intermissionSpecial = false;
  /** ACT_TRANSITION: dopo il Mercante Reale si apre la Gran Forgia */
  private grandForgeQueued = false;

  constructor(canvas: HTMLCanvasElement) {
    this.diceWorld = new DiceWorld(canvas);
    settings.subscribe(v => { this.diceWorld.timeScale = v.fast ? 2 : 1; });
    this.unlocks = this.saveMgr.loadUnlocks();
    this.publishMeta();

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
        const item = findItem(id);
        if (item) this.equipment.equip(item);
      }
      pushLog('💾 Run ripristinata dal salvataggio');
      this.log = loadCurrentLog() ?? this.freshLog();
    } else {
      this.buildBag();
      this.log = this.freshLog();
    }
    this.newBattle(this.run.level);
    this.publishMenuInfo();
  }

  /* ---------------- Registro della run ---------------- */

  private tuningSnapshot(): Record<string, number | string> {
    return {
      hpGrowth: BALANCE.ENEMY_HP_GROWTH, strGrowth: BALANCE.ENEMY_STR_GROWTH,
      enemyStr: BALANCE.ENEMY_BASE_STR, enemyVit: BALANCE.ENEMY_BASE_VIT,
      champion: CHAMPION_STAT_MULTIPLIER, bossHp: BOSS_HP_MULTIPLIER, bossStr: BOSS_STR_MULTIPLIER, potion: POTION_HEAL,
      gold: BALANCE.GOLD_REWARD_BASE, goldGrowth: BALANCE.GOLD_REWARD_GROWTH,
      costGrowth: BALANCE.SHOP_COST_GROWTH, heal: BALANCE.HEAL_PER_WIN,
      draw: BALANCE.HAND_DRAW, play: BALANCE.HAND_PLAY,
      growStr: BALANCE.WIN_STR_GROWTH, growVit: BALANCE.WIN_VIT_GROWTH,
      interest: BALANCE.INTEREST_RATE, rerollCost: BALANCE.REROLL_COST
    };
  }

  private freshLog(): RunLog {
    const log = new RunLog(this.tuningSnapshot());
    const s = this.playerStats;
    log.add('run', `Partenza: STR ${formatBigNumber(s.str)}, INT ${formatBigNumber(s.int)}, VIT ${formatBigNumber(s.vit)}, LCK ${s.lck}`);
    log.add('run', `Sacchetto: ${this.bag.map((d, i) => `#${i + 1} ${d.faces.map(faceLabel).join(' ')}`).join(' | ')}`);
    return log;
  }

  private hpText(c: Combatant): string {
    const sh = c.shield.gt(0) ? ` +${formatBigNumber(c.shield)} scudo` : '';
    const po = c.poison.turnsLeft > 0 ? ` ☠${formatBigNumber(c.poison.perTurn)}×${c.poison.turnsLeft}` : '';
    return `${formatBigNumber(Decimal.max(c.hp, 0))}/${formatBigNumber(c.maxHp)}${sh}${po}`;
  }

  private state(): string {
    return `goblin ${this.hpText(this.engine.player)} · ${this.enemyName} ${this.hpText(this.engine.enemy)}`;
  }

  private persistLog(): void { saveCurrentLog(this.log); }

  /** Conta i danni subiti dal goblin rispetto all'ultima rilevazione */
  private trackPlayerHp(): void {
    const cur = this.engine.player.hp;
    const lost = this.prevPlayerHp.minus(Decimal.max(cur, 0));
    if (lost.gt(0)) this.log.stats.damageTaken = this.log.stats.damageTaken.plus(lost);
    this.prevPlayerHp = Decimal.max(cur, 0);
  }

  /** Chiude il registro e prepara la schermata finale */
  private endRun(outcome: 'sconfitta' | 'vittoria' | 'abbandonata', killedBy?: string): void {
    if (this.log.finished) return;
    this.log.add('run', `FINE RUN: ${outcome} (${this.run.label})${killedBy ? ` — ucciso da ${killedBy}` : ''}`);
    this.log.finish(outcome, this.run.label, killedBy);
    saveLastLog(this.log);
    if (outcome !== 'abbandonata') runSummary.set(this.buildSummary(outcome, killedBy ?? null));
    this.publishMenuInfo();
  }

  private buildSummary(outcome: 'sconfitta' | 'vittoria', killedBy: string | null): RunSummaryView {
    const st = this.log.stats;
    const totalActions = Object.values(st.actions).reduce((a, b) => a + b, 0) || 1;
    const bagFaces = this.bag.flatMap(d => d.faces);
    const mults = bagFaces.filter(f => f.type === FaceType.MULTIPLIER).length;
    const enchanted = bagFaces.filter(f => f.effect).length;
    return {
      outcome,
      title: outcome === 'vittoria' ? '👑 Run completata!' : '💀 Il Goblin è caduto',
      endLabel: this.run.label,
      killedBy,
      rows: [
        ['Incontri vinti', String(Math.max(0, st.fights - (outcome === 'sconfitta' ? 1 : 0)))],
        ['Turni giocati', String(st.turns)],
        ['Danno inflitto', formatBigNumber(st.damageDealt)],
        ['Colpo più forte', formatBigNumber(st.maxHit)],
        ['Danno subito', formatBigNumber(st.damageTaken)],
        ['Cambi di mano', String(st.handChanges)],
        ['Reazioni scatenate', String(st.reactions)],
        ['Oro guadagnato / speso', `${formatBigNumber(st.goldEarned)} / ${formatBigNumber(st.goldSpent)}`],
        ['Forza / Vitalità', `${formatBigNumber(this.playerStats.str)} / ${formatBigNumber(this.playerStats.vit)}`]
      ],
      actions: Object.entries(st.actions).map(([name, n]) => ({ name, pct: Math.round((n / totalActions) * 100) })),
      items: this.equipment.slots.filter((x): x is EquipmentItem => x !== null).map(i => ({ icon: i.icon, name: i.name })),
      build: `${this.bag.length} dadi · ${mults} facce ×moltiplicatore · ${enchanted} facce incantate`
    };
  }

  private publishMenuInfo(): void {
    menuInfo.set({
      hasSave: this.saveMgr.hasRun() && !this.log.finished,
      inProgress: this.started && !this.log.finished,
      saveLabel: this.run.label,
      gold: formatBigNumber(this.run.state.gold),
      hasLastLog: loadLastLog() !== null || this.log.finished
    });
  }

  /** Testo del registro: quello della run in corso, o dell'ultima conclusa */
  public getLogText(which: 'current' | 'last'): string {
    if (which === 'current') return this.log.toText();
    return (loadLastLog() ?? this.log).toText();
  }

  /* ---------------- Menù ---------------- */

  /** Da menù: riprende la run (o avvia quella appena caricata) */
  public resumeFromMenu(): void {
    menuOpen.set(false);
    if (!this.started) void this.start();
  }

  /** Da menù: nuova run (se non è ancora partito nulla e non c'è un salvataggio, parte subito) */
  public newRunFromMenu(): void {
    menuOpen.set(false);
    if (this.unlockedBagIds().length > 1) { this.publishMeta(); bagPickerOpen.set(true); return; }
    void this.newRun();
  }

  /** Dal selettore: nuova run con la borsa scelta (solo se sbloccata) */
  public chooseBag(id: string): void {
    if (!this.unlockedBagIds().includes(id)) return;
    bagPickerOpen.set(false);
    void this.newRun(id);
  }

  /* ---------------- Setup battaglia ---------------- */

  private bagId = 'classica';

  private buildBag(bagId = 'classica'): void {
    this.bagId = getBag(bagId).id;
    this.bag = buildStarterBag(this.bagId);
  }

  /** Oggetto di partenza della borsa scelta */
  private equipBagItem(): void {
    const id = getBag(this.bagId).item;
    const item = id ? findItem(id) : undefined;
    if (item) this.equipment.equip(item);
  }

  /* ---------------- Meta: borse e obiettivi ---------------- */

  private metaStats: MetaStats = this.saveMgr.loadStats();

  private unlockedBagIds(): string[] {
    return ['classica', ...BAGS.filter(b => this.unlocks.includes(`bag:${b.id}`)).map(b => b.id)];
  }

  private publishMeta(): void {
    const open = this.unlockedBagIds();
    bagOptions.set(BAGS.map(b => {
      const goal = GOALS.find(g => g.reward.bag === b.id);
      return { id: b.id, name: b.name, icon: b.icon, description: b.description,
        locked: !open.includes(b.id), hint: goal ? `Sblocco: ${goal.name} — ${goal.description}` : '' };
    }));
    goalsView.set(GOALS.map(g => {
      const [cur, goal] = g.progress(this.metaStats);
      return { id: g.id, name: g.name, description: g.description, done: this.unlocks.includes(`goal:${g.id}`),
        progress: `${Math.min(cur, goal)}/${goal}`, ratio: Math.min(1, cur / goal), rewardText: g.rewardText };
    }));
  }

  /** Aggiorna le statistiche permanenti e consegna i premi degli obiettivi nuovi */
  private updateMeta(change: (s: MetaStats) => void): void {
    change(this.metaStats);
    this.saveMgr.saveStats(this.metaStats);
    const news: string[] = [];
    for (const id of completedGoals(this.metaStats)) {
      if (this.unlocks.includes(`goal:${id}`)) continue;
      const g = GOALS.find(x => x.id === id)!;
      this.unlocks = this.saveMgr.addUnlock(`goal:${id}`);
      if (g.reward.bag) this.unlocks = this.saveMgr.addUnlock(`bag:${g.reward.bag}`);
      if (g.reward.die) this.unlocks = this.saveMgr.addUnlock(g.reward.die);
      pushLog(`🏅 Obiettivo: ${g.name} — sbloccato: ${g.rewardText}`);
      this.log.add('result', `Obiettivo completato: ${g.name} → ${g.rewardText}`);
      news.push(`🏅 ${g.name}: sbloccato ${g.rewardText}!`);
    }
    if (news.length) {
      const prev = get(rewardBanner);
      rewardBanner.set([prev, ...news].filter(Boolean).join('  ·  '));
      sfx.fanfare();
    }
    this.publishMeta();
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
    const hpMult = this.run.isActBoss ? BOSS_HP_MULTIPLIER : this.run.isChampion ? CHAMPION_STAT_MULTIPLIER : this.run.isElite ? ELITE_HP_MULT : 1;
    const strMult = this.run.isActBoss ? BOSS_STR_MULTIPLIER : this.run.isChampion ? CHAMPION_STAT_MULTIPLIER : this.run.isElite ? ELITE_STR_MULT : 1;
    const enemyStats: CombatantStats = {
      str: new Decimal(BALANCE.ENEMY_BASE_STR).times(strGrowth).times(strMult),
      int: new Decimal(1).times(strGrowth).times(strMult),
      vit: new Decimal(BALANCE.ENEMY_BASE_VIT).times(hpGrowth).times(hpMult),
      lck: 0
    };

    this.engine = new BattleEngine(this.playerStats, enemyStats, this.bag);
    this.enemyProfile = enemyProfileFor(this.run.state.act, this.run.state.encounter, this.run.isChampion, this.run.isActBoss, this.run.isElite);
    this.engine.enemyPattern = this.enemyProfile.pattern;
    this.engine.bossRules = this.enemyProfile.rules;
    bossRuleText.set(this.enemyProfile.rules?.text ?? '');
    intentQueue.set([]);
    this.engine.player.hp = this.engine.player.maxHp.times(this.run.state.hpRatio);
    this.syncEquipment();
    this.registerListeners();
    this.pickEnemyLook();
    pushLog(
      this.run.isActBoss
        ? `— 👑 ${this.run.label}: il BOSS sbarra la strada! —`
        : this.run.isChampion
          ? `— 🏆 ${this.run.label}: il Campione ti sfida! —`
          : this.run.isElite ? `— 👹 ${this.run.label}: ${this.enemyName} ti aspetta! —`
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
    if (this.run.isElite) {
      this.enemyName = `Élite — ${cls.name}`;
      enemyInfo.set({ name: this.enemyName, sprite: cls.sprite, tint: 'champion', tier: 'champion', hue: 0 });
      return;
    }
    // variante cromatica per incontro: stessa sprite, aspetto diverso
    const hue = cls.tint === 'none' ? (((act * 37 + encounter * 53) % 70) - 35) : 0;
    this.enemyName = cls.name;
    enemyInfo.set({ name: cls.name, sprite: cls.sprite, tint: cls.tint, tier: 'normal', hue });
  }

  private enemyName = 'Avventuriero';
  private enemyProfile: EnemyProfile | null = null;
  /** Moltiplicatore di overflow del tiro corrente (1 = nessun overflow) */
  private overflowMult = new Decimal(1);

  /** Anteprima per il giocatore: quanto farebbe ogni skill con questo tiro.
   *  Usa la STESSA pipeline della risoluzione (equip e overflow inclusi),
   *  quindi il numero mostrato coincide con quello che poi viene inflitto. */
  private refreshPreview(): void {
    const faces = this.engine.playedFaces;
    if (this.lastFaces.length === 0) return;
    const calc = (mod: Decimal, id: SkillId | null = null) => this.engine.calcDamage(mod, id);

    const fmt = formatBigNumber;
    const sgancio = calc(SKILLS[SkillId.SGANCIO_BRUTALE].skillMod, SkillId.SGANCIO_BRUTALE);
    const parata = calc(SKILLS[SkillId.PARATA].skillMod, SkillId.PARATA);
    const bavaDef = SKILLS[SkillId.BAVA];
    const bavaBase = calc(bavaDef.skillMod, SkillId.BAVA);
    const bava = bavaBase.times(bavaDef.poisonRatio ?? 0).times(Decimal.max(this.engine.player.stats.int, 1));

    skillPreview.set({
      [SkillId.SGANCIO_BRUTALE]: `${fmt(sgancio)} danni`,
      [SkillId.PARATA]: `+${fmt(parata)} scudo`,
      [SkillId.BAVA]: `☠${fmt(bava)}×${bavaDef.poisonTurns}`,
      [SkillId.CARICA]: `tieni ${faces.length} facce`
    });

    // Avvisi: aiutano a leggere il turno (un colpo letale o uno scudo sprecato non si vedono dai numeri)
    const hints: Record<number, { text: string; kind: 'good' | 'warn' }> = {};
    const en = this.engine.enemy;
    if (sgancio.gte(en.hp.plus(en.shield))) {
      hints[SkillId.SGANCIO_BRUTALE] = { text: '💀 Colpo letale!', kind: 'good' };
    }
    const intentType = this.engine.currentIntent?.type;
    if (intentType === IntentType.POISON) {
      hints[SkillId.PARATA] = { text: '⚠ Il veleno ignora lo scudo', kind: 'warn' };
    } else if (intentType === IntentType.SHIELD || intentType === IntentType.BUFF) {
      hints[SkillId.PARATA] = { text: '⚠ Il nemico non attacca: scudo sprecato', kind: 'warn' };
    }
    skillHints.set(hints);

    const s = summarizeChain(faces);
    chainView.set({
      mult: fmt(s.multProduct),
      tier: multTier(s.multProduct),
      power: fmt(calc(new Decimal(1))),
      powerNum: calc(new Decimal(1)).toNumber(),
      multCount: s.multCount
    });

    const ef = this.engine.getEffects();
    effectsView.set({
      poison: ef.poison.gt(0) ? fmt(ef.poison) : null,
      shield: ef.shield.gt(0) ? fmt(ef.shield) : null,
      fire: ef.fire.gt(0) ? fmt(ef.fire) : null,
      reactions: ef.reactions.map(r => ({ ...r }))
    });
    this.publishHand();
    const ov = this.engine.overflow;
    overflowActive.set(ov.active);
    this.overflowMult = ov.mult;
  }

  /** Quando i dadi si fermano: il palco annuncia il moltiplicatore totale */
  private announceChain(): void {
    const s = summarizeChain(this.engine.playedFaces);
    const tier = multTier(s.multProduct);
    if (tier > 0) emitFx('center', 'mult', `×${formatBigNumber(s.multProduct)}`, tier);

  }

  private refreshRunHeader(): void {
    runLabel.set(this.run.label);
    runProgress.set({ act: this.run.state.act, encounter: this.run.state.encounter });
    goldView.set(formatBigNumber(this.run.state.gold));
    goldNum.set(this.run.state.gold.toNumber());
  }

  public start(): Promise<void> {
    this.started = true;
    this.logFightHeader();
    this.publishMenuInfo();
    return this.engine.initTurn();
  }

  /** Riga di apertura dell'incontro nel registro */
  private logFightHeader(): void {
    const e = this.engine;
    this.turnNo = 0;
    this.prevPlayerHp = Decimal.max(e.player.hp, 0);
    const header = `━━ ${this.run.label} (lv ${this.run.level}) · ${this.enemyName} · HP ${formatBigNumber(e.enemy.maxHp)}, STR ${formatBigNumber(e.enemy.stats.str)} ━━`;
    // dopo un ricaricamento lo stesso incontro riparte da capo: si annota ma non si conta due volte
    const last = [...this.log.entries].reverse().find(x => x.kind === 'fight');
    const resumed = !!last && last.text.replace('↻ Ripresa ', '') === header;
    if (!resumed) this.log.stats.fights++;
    const items = this.equipment.slots.filter((x): x is EquipmentItem => x !== null).map(i => i.name);
    this.log.add('fight', resumed ? `↻ Ripresa ${header}` : header);
    if (this.enemyProfile) {
      const pr = this.enemyProfile;
      this.log.add('note', `Schema ${pr.pattern.name}: ${pr.pattern.steps.map(st => (st.tag ?? INTENT_META[st.type].label)).join(' → ')}${pr.rules ? ` · Regola: ${pr.rules.text}` : ''}`);
    }
    this.log.add('note', `Goblin: HP ${this.hpText(e.player)}, STR ${formatBigNumber(e.player.stats.str)}, VIT ${formatBigNumber(this.playerStats.vit)} · oggetti: ${items.join(', ') || 'nessuno'} · oro ${formatBigNumber(this.run.state.gold)}`);
    this.persistLog();
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
      this.trackPlayerHp();
      this.turnNo++;
      this.log.stats.turns++;
      this.log.add('turn', `Turno ${this.turnNo} — ${this.state()}`);
      this.log.add('enemy', `Intento: ${meta.icon} ${meta.label} ${formatBigNumber(intent.value)}`);
      intentView.set(intentToView(intent));
      intentQueue.set(this.engine.peekIntents(3).map(intentToView));
    });

    e.on('onDicesRolled', p => {
      const faces = p.dices as DieFace[];
      const sources = p.sources as GoblinDie[];
      this.lastFaces = faces;
      this.lastSources = sources;
      overflowActive.set(false);
      this.overflowMult = new Decimal(1);
      this.publishChips();
      this.logRoll(faces);
      rollNonce.update(n => n + 1);
      this.refreshPreview();
      if (this.engine.charged) pushLog(`⚡ Carica pronta: le facce tenute valgono ×1.5`);
      // ← Il Visual Blocking Callback: la logica attende il 3D;
      // quando i dadi si fermano, il palco annuncia il moltiplicatore.
      p.waitUntilFinished = async () => {
        sfx.roll(faces.length);
        await this.diceWorld.throwDice(sources, faces);
        sfx.settle();
        this.diceWorld.setPlayed(new Set(this.engine.playedIndices));
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
      const amt = p.amount as Decimal;
      this.log.stats.damageDealt = this.log.stats.damageDealt.plus(amt);
      if (amt.gt(this.log.stats.maxHit)) this.log.stats.maxHit = amt;
      this.log.add('effect', `Danno inflitto ${formatBigNumber(amt)} → ${this.enemyName} ${this.hpText(this.engine.enemy)}`);
      emitFx('enemy', 'hit', formatBigNumber(p.amount as Decimal), magnitudeOf(p.amount as Decimal));
      pushLog(`💥 ${formatBigNumber(p.amount as Decimal)} danni a ${this.enemyName}`);
      this.refreshCombatants();
    });

    e.on('onShieldGained', p => {
      this.log.add('effect', `Scudo +${formatBigNumber(p.amount as Decimal)} (totale ${formatBigNumber(this.engine.player.shield)})`);
      emitFx('player', 'shield', `+${formatBigNumber(p.amount as Decimal)}`, magnitudeOf(p.amount as Decimal));
      pushLog(`🛡️ Scudo: ${formatBigNumber(p.amount as Decimal)} punti`);
      this.refreshCombatants();
    });

    e.on('onReflect', p => {
      this.log.add('effect', `Parata: rimbalzo ${formatBigNumber(p.amount as Decimal)} sul nemico`);
      emitFx('enemy', 'hit', `↩ ${formatBigNumber(p.amount as Decimal)}`, magnitudeOf(p.amount as Decimal));
      pushLog(`↩️ Parata: ${formatBigNumber(p.amount as Decimal)} danni rimbalzati`);
      this.refreshCombatants();
    });

    e.on('onCharge', p => {
      this.log.add('effect', `Carica: ${p.count as number} facce restano per il turno dopo (×1.5 al prossimo lancio)`);
      sfx.charge();
      emitFx('player', 'shield', `⚡ ${p.count as number} facce`, 2);
      pushLog(`⚡ Carica: ${p.count as number} facce restano per il prossimo turno`);
    });

    e.on('onReaction', p => {
      const r = REACTIONS[p.id as ReactionId];
      this.log.stats.reactions++;
      this.log.add('effect', `Reazione ${r.icon} ${r.name}: ${r.text} (${formatBigNumber(p.amount as Decimal)})`);
      emitFx('center', 'mult', `${r.icon} ${r.name}`, 3);
      sfx.reaction();
      pushLog(`⚗️ ${r.name}: ${r.text}`);
      this.refreshCombatants();
    });

    e.on('onPoisonApplied', p => {
      this.log.add('effect', `Veleno applicato: ${formatBigNumber(p.perTurn as Decimal)}/turno per ${p.turns as number} turni`);
      emitFx('enemy', 'poison', `☠ ${formatBigNumber(p.perTurn as Decimal)}`);
      pushLog(`☠️ Veleno: ${formatBigNumber(p.perTurn as Decimal)}/turno × ${p.turns as number}`);
    });

    e.on('onEnemyAction', p => {
      const intent = p.intent as EnemyIntent;
      const meta = INTENT_META[intent.type];
      this.trackPlayerHp();
      this.log.add('enemy', `${this.enemyName} esegue ${meta.label} ${formatBigNumber(intent.value)} → ${this.state()}`);
      if (intent.type === IntentType.ATTACK) emitFx('player', 'hit', formatBigNumber(intent.value), magnitudeOf(intent.value));
      pushLog(`${meta.icon} ${this.enemyName} usa ${meta.label} (${formatBigNumber(intent.value)})`);
      this.refreshCombatants();
    });

    e.on('onBattleEnded', p => {
      this.trackPlayerHp();
      this.log.add('result', p.winner === 'player'
        ? `VITTORIA in ${this.turnNo} turni — ${this.state()}`
        : `SCONFITTA al turno ${this.turnNo} — ${this.state()}`);
      battleResult.set(p.winner === 'player' ? 'victory' : 'defeat');
      this.refreshCombatants();
      if (p.winner === 'player') {
        sfx.victory();
        this.onVictory();
      } else {
        // Roguelike: la sconfitta chiude la run (gli sblocchi meta restano)
        sfx.defeat();
        this.saveMgr.clearRun();
        this.endRun('sconfitta', this.enemyName);
      }
    });
  }

  /** Vittoria: ricompensa in oro, avanzamento run, eventuale
   *  sblocco permanente del boss, autosave e apertura shop. */
  private onVictory(): void {
    const reward = this.run.goldReward();
    this.run.addGold(reward);
    sfx.loot(this.run.isActBoss ? 5 : this.run.isChampion ? 4 : this.run.isElite ? 3 : 2);
    pushLog(`💰 Bottino: ${formatBigNumber(reward)} oro`);
    this.log.stats.goldEarned = this.log.stats.goldEarned.plus(reward);
    this.log.add('result', `Bottino ${formatBigNumber(reward)} oro (totale ${formatBigNumber(this.run.state.gold)})`);
    const interest = this.run.applyInterest();
    if (interest.gt(0)) {
      pushLog(`🏦 Interesse: +${formatBigNumber(interest)} oro`);
      this.log.stats.goldEarned = this.log.stats.goldEarned.plus(interest);
      this.log.add('result', `Interesse sull'oro non speso: +${formatBigNumber(interest)} (totale ${formatBigNumber(this.run.state.gold)})`);
    }
    // Crescita automatica: Forza e Vitalità non si comprano più, salgono con le vittorie
    this.playerStats.str = this.playerStats.str.times(BALANCE.WIN_STR_GROWTH);
    this.playerStats.vit = this.playerStats.vit.times(BALANCE.WIN_VIT_GROWTH);
    this.log.add('result', `Il goblin cresce: Forza ${formatBigNumber(this.playerStats.str)}, Vitalità ${formatBigNumber(this.playerStats.vit)}`);

    // Le boss fight aprono gli intermezzi SPECIALI (specs §7.bis/§10):
    // Campione -> bivio dorato; Boss d'Atto -> Mercante Reale + Gran Forgia
    const wasBossFight = this.run.isBossFight;
    const ratio = this.engine.player.hp.div(Decimal.max(this.engine.player.maxHp, 1)).toNumber();
    this.run.state.hpRatio = wasBossFight ? 1 : Math.min(1, Math.max(0.05, ratio) + BALANCE.HEAL_PER_WIN);
    pushLog(wasBossFight ? '🩹 Riposo: HP al massimo' : `🩹 Recuperi ${Math.round(BALANCE.HEAL_PER_WIN * 100)}% degli HP`);
    this.log.add('result', wasBossFight ? 'Riposo: HP al massimo' : `Recupero ${Math.round(BALANCE.HEAL_PER_WIN * 100)}% HP → ${Math.round(this.run.state.hpRatio * 100)}%`);
    const wasChampion = this.run.isChampion;
    const wasActBoss = this.run.isActBoss;
    const wasElite = this.run.isElite;
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

    this.updateMeta(s => {
      if (wasElite) s.elites++;
      if (wasActBoss) s.bosses++;
      s.bestAct = Math.max(s.bestAct, this.run.state.act);
      if (result === 'run-completed') s.wins++;
    });

    if (result === 'run-completed') {
      this.endRun('vittoria');
      this.saveMgr.clearRun(); // la run è finita: si riparte da zero
      uiPhase.set('run-complete');
      return;
    }

    this.autosave();
    this.persistLog();

    if (wasActBoss) {
      // ACT_TRANSITION (specs §10): ENTRAMBI gli intermezzi speciali
      // in sequenza — Mercante Reale, poi Gran Forgia
      this.grandForgeQueued = true;
      this.openReward('relic');
    } else if (wasElite) {
      // Premio dell'Élite: un oggetto raro a scelta, poi il bivio
      this.openReward('elite');
    } else {
      // Bivio: due porte diverse, se ne sceglie UNA.
      // Dorate dopo il Campione (§7.bis).
      this.openCrossroad(wasChampion);
    }
  }

  /* ---------------- Bivio (Intermission) ---------------- */

  private openCrossroad(special: boolean): void {
    this.intermissionSpecial = special;
    crossroadSpecial.set(special);
    let kinds: DoorKind[];
    if (special) {
      kinds = ['shop', 'forge'];
      doors.set([
        { kind: 'shop', icon: '👑', label: 'Mercante Reale', hint: 'Sconto 30% e offerta premium' },
        { kind: 'forge', icon: '🔨', label: 'Gran Forgia', hint: '3 operazioni, Trasmutazione -50%' }
      ]);
    } else {
      kinds = pickDoors(defaultRNG, this.run.isBossFight, this.run.state.hpRatio, this.run.state.elitesInAct ?? 0);
      doors.set(kinds.map(k => ({ kind: k, ...DOOR_META[k] })));
    }
    this.log.add('note', `Bivio${special ? ' dorato' : ''}: ${kinds.map(k => DOOR_META[k].label).join(' / ')}`);
    this.refreshRunHeader();
    uiPhase.set('crossroad');
  }

  /** Scelta della porta: l'altra si chiude. */
  public chooseDoor(door: DoorKind): void {
    sfx.door();
    this.log.add('note', `Bivio${this.intermissionSpecial ? ' dorato' : ''}: sceglie ${DOOR_META[door].label}`);
    switch (door) {
      case 'shop': this.openShop(this.intermissionSpecial); break;
      case 'forge': this.openForge(this.intermissionSpecial); break;
      case 'rest': {
        const before = this.run.state.hpRatio;
        this.run.state.hpRatio = Math.min(1, before + REST_HEAL);
        pushLog(`🏕️ Riposo: HP ${Math.round(before * 100)}% → ${Math.round(this.run.state.hpRatio * 100)}%`);
        this.log.add('result', `Riposo: HP ${Math.round(before * 100)}% → ${Math.round(this.run.state.hpRatio * 100)}%`);
        this.autosave();
        void this.nextFight();
        break;
      }
      case 'elite':
        this.run.state.elite = true;
        this.run.state.elitesInAct = (this.run.state.elitesInAct ?? 0) + 1;
        this.log.add('result', 'Sfida Élite accettata: il prossimo incontro è un Élite');
        this.autosave();
        void this.nextFight();
        break;
      case 'event':
        this.openEvent();
        break;
    }
  }

  private nextFight(): Promise<void> {
    rewardBanner.set(null);
    this.newBattle(this.run.level);
    return this.start();
  }

  /* ---------------- Eventi ---------------- */

  private seenEvents: string[] = [];
  private currentEvent: EventDef | null = null;

  private eventCtx() {
    return { run: this.run, stats: this.playerStats, bag: this.bag, equipment: this.equipment, rng: defaultRNG };
  }

  private openEvent(): void {
    const ev = pickEvent(defaultRNG, this.seenEvents);
    this.seenEvents.push(ev.id);
    this.currentEvent = ev;
    this.log.add('note', `Evento: ${ev.title}`);
    this.publishEvent(null);
    uiPhase.set('event');
  }

  private publishEvent(result: string | null): void {
    const ev = this.currentEvent;
    if (!ev) { eventView.set(null); return; }
    const c = this.eventCtx();
    eventView.set({
      icon: ev.icon, title: ev.title, text: ev.text, result,
      options: ev.options.map(o => ({ label: o.label, hint: o.hint, blocked: o.blocked ? o.blocked(c) : null }))
    });
  }

  public chooseEventOption(i: number): void {
    const ev = this.currentEvent;
    const opt = ev?.options[i];
    if (!ev || !opt) return;
    const c = this.eventCtx();
    if (opt.blocked?.(c)) { sfx.denied(); return; }
    sfx.click();
    const text = opt.apply(c);
    this.log.add('result', `Evento ${ev.title} → ${opt.label}: ${text}`);
    pushLog(`${ev.icon} ${text}`);
    equipVersion.update(v => v + 1);
    this.syncEquipment();
    this.refreshRunHeader();
    this.autosave();
    this.persistLog();
    this.currentEvent = null;
    eventView.set({ icon: ev.icon, title: ev.title, text: ev.text, options: [], result: text });
  }

  public leaveEvent(): Promise<void> {
    eventView.set(null);
    return this.nextFight();
  }

  /* ---------------- Premio dell'Élite ---------------- */

  private rewardItems: EquipmentItem[] = [];

  private rewardFrom: 'elite' | 'relic' = 'elite';

  private afterReward(): void {
    if (this.rewardFrom === 'relic') this.openShop(true); else this.openCrossroad(false);
  }

  private openReward(kind: 'elite' | 'relic'): void {
    this.rewardFrom = kind;
    rewardKind.set(kind);
    this.rewardItems = kind === 'relic'
      ? pickRelics(defaultRNG, this.equipment.ownedIds)
      : pickEliteRewards(defaultRNG, this.equipment.ownedIds);
    if (this.rewardItems.length === 0) { this.afterReward(); return; }
    const full = this.equipment.freeSlots === 0;
    rewardChoices.set(this.rewardItems.map(it => ({
      id: it.id, icon: it.icon, name: it.name, description: it.description, rarity: it.rarity, relic: !!it.relic,
      note: full ? 'Slot pieni: sceglierai cosa sacrificare' : ''
    })));
    this.log.add('result', `${kind === 'relic' ? 'Reliquie del Boss' : 'Premio Élite'}: ${this.rewardItems.map(i => i.name).join(' / ')}`);
    this.autosave();
    uiPhase.set('reward');
  }

  /** Valore di vendita: le reliquie non si vendono (sacrificate valgono 0) */
  private valueOfItem(it: EquipmentItem): Decimal {
    return it.relic ? new Decimal(0) : this.shop.sellValue(it, this.run.shopLevel);
  }

  /** Apre la scelta dell'oggetto da sacrificare */
  private askReplace(incoming: EquipmentItem, info: string, canPay: (refund: Decimal) => boolean, then: (slot: number) => void): void {
    this.pendingReplace = then;
    replacePrompt.set({
      incoming: { icon: incoming.icon, name: incoming.name, description: incoming.description, rarity: incoming.rarity, relic: !!incoming.relic },
      info,
      options: this.equipment.slots.map((s, slot) => s ? {
        slot, icon: s.icon, name: s.name, description: s.description, rarity: s.rarity, relic: !!s.relic,
        value: s.relic ? 'Reliquia: va persa' : `+${formatBigNumber(this.valueOfItem(s))} oro`,
        blocked: canPay(this.valueOfItem(s)) ? null : 'Oro insufficiente'
      } : null).filter((x): x is NonNullable<typeof x> => x !== null)
    });
  }

  private pendingReplace: ((slot: number) => void) | null = null;

  /** Dal prompt: sacrifica lo slot scelto e completa l'acquisto o il premio */
  public confirmReplace(slot: number): void {
    const fn = this.pendingReplace;
    this.pendingReplace = null;
    replacePrompt.set(null);
    if (fn) fn(slot);
  }

  public cancelReplace(): void {
    this.pendingReplace = null;
    replacePrompt.set(null);
  }

  /** Toglie l'oggetto dallo slot e ne incassa il valore (0 per le reliquie) */
  private sacrificeSlot(slot: number): void {
    const old = this.equipment.slots[slot];
    if (!old) return;
    const value = this.valueOfItem(old);
    this.equipment.unequip(slot);
    if (value.gt(0)) {
      this.run.addGold(value);
      this.log.stats.goldEarned = this.log.stats.goldEarned.plus(value);
    }
    pushLog(`${old.icon} Sacrificato: ${old.name}${value.gt(0) ? ` (+${formatBigNumber(value)} oro)` : ''}`);
    this.log.add('result', `Sacrificato: ${old.name}${value.gt(0) ? ` per ${formatBigNumber(value)}` : ''}`);
  }

  public chooseReward(id: string): void {
    const it = this.rewardItems.find(i => i.id === id);
    if (!it) return;
    if (this.equipment.freeSlots === 0) {
      this.askReplace(it, 'Premio gratuito: scegli cosa lasciare', () => true, slot => {
        this.sacrificeSlot(slot);
        this.finishReward(it);
      });
      return;
    }
    this.finishReward(it);
  }

  /** Rinuncia al premio e lo vende (gli altri vanno persi) */
  public sellReward(id: string): void {
    const it = this.rewardItems.find(i => i.id === id);
    if (!it) return;
    const value = this.valueOfItem(it).gt(0) ? this.valueOfItem(it) : this.shop.sellValue(it, this.run.shopLevel);
    sfx.sell();
    this.run.addGold(value);
    this.log.stats.goldEarned = this.log.stats.goldEarned.plus(value);
    pushLog(`💰 Premio venduto: ${it.name} (+${formatBigNumber(value)} oro)`);
    this.log.add('result', `Premio venduto: ${it.name} per ${formatBigNumber(value)}`);
    this.rewardItems = [];
    rewardChoices.set([]);
    this.refreshRunHeader();
    this.autosave();
    this.persistLog();
    this.afterReward();
  }

  public rewardSellValue(id: string): string {
    const it = this.rewardItems.find(i => i.id === id);
    return it ? formatBigNumber(this.shop.sellValue(it, this.run.shopLevel)) : '0';
  }

  private finishReward(it: EquipmentItem): void {
    if (it.relic) sfx.fanfare(); else sfx.equip(2);
    this.equipment.equip(it);
    this.syncEquipment();
    equipVersion.update(v => v + 1);
    this.refreshRunHeader();
    pushLog(`${it.icon} ${this.rewardFrom === 'relic' ? 'Reliquia' : 'Premio Élite'}: ${it.name}`);
    this.log.add('result', `Scelto: ${it.name}`);
    this.rewardItems = [];
    rewardChoices.set([]);
    this.autosave();
    this.persistLog();
    this.afterReward();
  }

  private toChip(face: DieFace): DieChip {
    const v = formatFaceValue(face.value);
    const fx = face.effect ? `${EFFECT_META[face.effect].icon} ` : '';
    const body =
      face.type === FaceType.MULTIPLIER ? `×${v}` :
      face.type === FaceType.BUFF_STR ? `+STR ${v}` :
      face.type === FaceType.RECURSIVE ? `↻` : v;
    return { text: fx + body, cssClass: CHIP_CLASS[face.type], card: 0, extra: false };
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
      hpNum: hp.toNumber(),
      maxNum: c.maxHp.toNumber(),
      shield: formatBigNumber(c.shield),
      poisonTurns: c.poison.turnsLeft
    };
  }

  /* ---------------- Azioni UI -> engine ---------------- */

  public async useSkill(id: SkillId): Promise<void> {
    if (this.engine.state !== BattleState.WAIT_PLAYER_ACTION) return;
    sfx.click();
    this.logAction(id);
    await this.engine.resolvePlayerAction(id);
    this.persistLog();
  }

  /** Lancio nel registro: facce, effetti e reazioni */
  /** Riga "Effetti pronti" dello stato attuale (anche dopo un rilancio) */
  private logEffectsLine(always = false): void {
    const e = this.engine;
    const ef = e.getEffects();
    const fx = [
      ef.poison.gt(0) ? `☠${formatBigNumber(ef.poison)}` : '',
      ef.shield.gt(0) ? `🛡${formatBigNumber(ef.shield)}` : '',
      ef.fire.gt(0) ? `🔥${formatBigNumber(ef.fire)}` : ''
    ].filter(Boolean).join(' ');
    if (always || fx || ef.reactions.length) {
      this.log.add('roll', `Effetti pronti: ${fx || '—'}${ef.reactions.length ? ` · reazioni: ${ef.reactions.map(r => r.name).join(', ')}` : ''}`);
    }
  }

  private logRoll(faces: DieFace[]): void {
    const e = this.engine;
    const ef = e.getEffects();
    const fx = [
      ef.poison.gt(0) ? `☠${formatBigNumber(ef.poison)}` : '',
      ef.shield.gt(0) ? `🛡${formatBigNumber(ef.shield)}` : '',
      ef.fire.gt(0) ? `🔥${formatBigNumber(ef.fire)}` : ''
    ].filter(Boolean).join(' ');
    const extra = e.overflow.active ? ` · OVERFLOW ×${formatBigNumber(e.overflow.mult)}` : '';
    const charged = e.charged ? ' · lancio di Carica (×1.5)' : '';
    const roll = (e as any).lastRoll as { rootOf: number[] };
    const cards = e.cards;
    const handTxt = cards.map(c => {
      const kids = faces.map((_, i) => i).filter(i => i !== c && roll.rootOf[i] === c);
      return `[${faceLabel(faces[c]!)}${kids.length ? ' +' + kids.map(i => faceLabel(faces[i]!)).join('+') : ''}]`;
    }).join(' ');
    this.log.add('roll', `Mano (${cards.length} dadi, ${e.playSlots} da giocare): ${handTxt}${charged}`);
    this.log.add('hand', `Scelta di partenza: ${this.handChoiceText()}${extra}`);
    if (fx || ef.reactions.length) {
      this.log.add('roll', `Effetti pronti: ${fx || '—'}${ef.reactions.length ? ` · reazioni: ${ef.reactions.map(r => r.name).join(', ')}` : ''}`);
    }
  }

  /** Scelta dell'azione nel registro, con il calcolo del danno */
  private logAction(id: SkillId): void {
    const e = this.engine;
    const skill = SKILLS[id];
    const faces = e.playedFaces;
    const flat = faces.filter(f => f.type === FaceType.NORMAL).reduce((a, f) => a.plus(f.value), new Decimal(0));
    const mult = summarizeChain(faces).multProduct;
    const dmg = e.calcDamage(skill.skillMod, id);
    const active = describeActiveItems(this.equipment.slots, e.itemCtx(id));
    const ov = e.overflow.active ? ` · overflow ×${formatBigNumber(e.overflow.mult)}` : '';
    const ch = e.charged ? ' · Carica ×1.5' : '';
    const what =
      skill.carriesRoll ? `tieni ${faces.length} facce`
      : skill.convertsToShield ? `scudo ${formatBigNumber(dmg)}`
      : skill.poisonRatio ? `veleno ${formatBigNumber(dmg.times(skill.poisonRatio).times(Decimal.max(e.player.stats.int, 1)))}/turno`
      : `danno ${formatBigNumber(dmg)}`;
    this.log.stats.actions[skill.name] = (this.log.stats.actions[skill.name] ?? 0) + 1;
    this.log.add('action', `AZIONE ${skill.name} (×${skill.skillMod.toString()}) → ${what}`);
    this.log.add('action', `Calcolo: (STR ${formatBigNumber(e.player.stats.str)} + facce ${formatBigNumber(flat)}) × moltiplicatori ×${formatBigNumber(mult)}${ov}${ch} · oggetti: ${active.join('; ') || 'nessuno attivo'}`);
  }

  /** Testo della mano scelta: quali dadi e con che esito */
  private handChoiceText(): string {
    const e = this.engine;
    const sel = e.selection;
    return sel.map(c => faceLabel(this.lastFaces[c]!)).join(' ') + ` (${sel.length}/${e.playSlots})`;
  }

  /** Aggiorna chip e store della mano (carte e lanci extra) */
  private publishChips(): void {
    const roll = (this.engine as any).lastRoll as { rootOf: number[] };
    rolledChips.set(this.lastFaces.map((f, i) => ({
      ...this.toChip(f), card: roll.rootOf[i]!, extra: roll.rootOf[i] !== i
    })));
    this.publishHand();
  }

  private publishHand(): void {
    handSelection.set(this.engine.selection);
    handInfo.set({ slots: this.engine.playSlots, drawn: this.engine.cards.length });
  }

  /** Il giocatore gioca o mette in panchina un dado */
  public toggleCard(card: number): void {
    if (this.engine.state !== BattleState.WAIT_PLAYER_ACTION) return;
    if (!this.engine.toggleCard(card)) {
      const e = this.engine;
      sfx.denied();
      if (!e.selection.includes(card) && e.selection.length >= e.playSlots) {
        pushLog('🎲 Slot pieni: togli prima un dado giocato');
      }
      return;
    }
    sfx.select(this.engine.selection.includes(card));
    this.log.stats.handChanges++;
    this.log.add('hand', `Mano cambiata: ${this.handChoiceText()}`);
    this.logEffectsLine(true);
    this.refreshPreview();
    this.diceWorld.setPlayed(new Set(this.engine.playedIndices));
    this.announceChain();
  }

  /* ---------------- Equipaggiamento ---------------- */

  /** Allinea il motore agli oggetti equipaggiati (danno condizionale e regole) */
  private syncEquipment(): void {
    this.equipment.syncPipeline(this.engine.pipeline, () => this.engine.itemCtx());
    this.engine.mods = this.equipment.mods();
  }

  /** Valore di rivendita dell'oggetto nello slot, o null se vuoto */
  public sellValueOf(slotIndex: number): Decimal | null {
    const item = this.equipment.slots[slotIndex];
    return item ? this.shop.sellValue(item, this.run.shopLevel) : null;
  }

  /** Vende l'oggetto di uno slot: solo dal mercante */
  public sellSlot(slotIndex: number): void {
    if (get(uiPhase) !== 'shop') return;
    const item = this.equipment.slots[slotIndex];
    if (!item) return;
    if (item.relic) { sfx.denied(); pushLog('✋ Le reliquie non si vendono'); return; }
    const value = this.shop.sellValue(item, this.run.shopLevel);
    this.equipment.unequip(slotIndex);
    sfx.sell();
    this.run.addGold(value);
    this.syncEquipment();
    pushLog(`💰 Venduto: ${item.name} (+${formatBigNumber(value)})`);
    this.log.stats.goldEarned = this.log.stats.goldEarned.plus(value);
    this.log.add('shop', `Venduto: ${item.name} per ${formatBigNumber(value)} — oro ${formatBigNumber(this.run.state.gold)}`);
    equipVersion.update(v => v + 1);
    this.publishOffers();
    this.refreshRunHeader();
    this.autosave();
  }

  /* ---------------- Shop e persistenza ---------------- */

  private openShop(special: boolean): void {
    const available = UNLOCKABLE_DICE.filter(bp => this.unlocks.includes(bp.id));
    this.shopRerolls = 0;
    this.shopIsSpecial = special;
    this.currentOffers = this.shop.generateOffers(
      this.run.shopLevel,
      this.run.state.purchases,
      this.bag,
      available,
      special,
      this.equipment.ownedIds,
      this.run.state.hpRatio
    );
    shopSpecial.set(special);
    this.log.add('shop', `${special ? 'Mercante Reale' : 'Mercante'} — oro ${formatBigNumber(this.run.state.gold)} — offerte: ${this.currentOffers.map(o => `${o.label} (${formatBigNumber(o.cost)})`).join('; ')}`);
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
        affordable: gold.gte(o.cost),
        ...(o.rarity ? { rarity: o.rarity } : {}),
        ...(o.kind === 'potion' || o.kind === 'elixir' ? { service: true } : {}),
        ...(o.kind === 'item' && this.equipment.freeSlots === 0 ? { note: 'Slot pieni: sceglierai cosa sacrificare' } : {})
      }))
    );
    const rc = this.shop.rerollCost(this.run.shopLevel, this.shopRerolls);
    shopInfo.set({
      rerollCost: formatBigNumber(rc),
      canReroll: gold.gte(rc),
      rerolls: this.shopRerolls,
      hp: `${Math.round(this.run.state.hpRatio * 100)}%`
    });
  }

  /** Rilancio del banco: rimescola merce (oggetti, faccia, dado), costo crescente nella visita */
  public rerollShop(): void {
    if (get(uiPhase) !== 'shop') return;
    const cost = this.shop.rerollCost(this.run.shopLevel, this.shopRerolls);
    if (!this.run.spendGold(cost, false)) {
      pushLog('✋ Oro insufficiente per rilanciare il banco');
      return;
    }
    this.shopRerolls++;
    this.log.stats.goldSpent = this.log.stats.goldSpent.plus(cost);
    const available = UNLOCKABLE_DICE.filter(bp => this.unlocks.includes(bp.id));
    const fresh = this.shop.generateMerchandise(
      this.run.shopLevel, this.run.state.purchases, this.bag, available, this.shopIsSpecial, this.equipment.ownedIds
    );
    const services = this.currentOffers.filter(o => o.kind === 'potion' || o.kind === 'elixir');
    this.currentOffers = [...fresh, ...services];
    pushLog(`🔄 Banco rilanciato (-${formatBigNumber(cost)})`);
    this.log.add('shop', `Rilancio #${this.shopRerolls} per ${formatBigNumber(cost)} — oro ${formatBigNumber(this.run.state.gold)} — nuove offerte: ${fresh.map(o => `${o.label} (${formatBigNumber(o.cost)})`).join('; ')}`);
    this.publishOffers();
    this.refreshRunHeader();
    this.persistLog();
    this.autosave();
  }

  /** Acquisto dallo shop: addebita, applica, rigenera le viste.
   *  L'offerta comprata sparisce; le altre restano (ma i prezzi
   *  futuri saliranno del 3% per ogni acquisto di merce). */
  public buyOffer(offerId: string, replaceSlot?: number): void {
    const offer = this.currentOffers.find(o => o.id === offerId);
    if (!offer) return;
    if (offer.kind === 'item' && this.equipment.freeSlots === 0) {
      const newItem = findItem(offer.itemId ?? '');
      if (!newItem) return;
      if (replaceSlot === undefined) {
        // slot pieni: il giocatore sceglie quale oggetto sacrificare (viene venduto)
        this.askReplace(newItem, `Costo ${formatBigNumber(offer.cost)} oro`,
          refund => this.run.state.gold.plus(refund).gte(offer.cost),
          slot => this.buyOffer(offerId, slot));
        return;
      }
      const old = this.equipment.slots[replaceSlot];
      if (!old || !this.run.state.gold.plus(this.valueOfItem(old)).gte(offer.cost)) {
        sfx.denied();
        pushLog(`✋ Oro insufficiente per ${offer.label}`);
        return;
      }
      this.sacrificeSlot(replaceSlot);
    }
    const isService = offer.kind === 'potion' || offer.kind === 'elixir';
    if (!this.run.spendGold(offer.cost, !isService)) {
      sfx.denied();
      pushLog(`✋ Oro insufficiente per ${offer.label}`);
      return;
    }
    sfx.coin();
    this.shop.apply(offer, {
      stats: this.playerStats,
      bag: this.bag,
      blueprints: UNLOCKABLE_DICE
    });
    if (isService) {
      const before = this.run.state.hpRatio;
      this.run.state.hpRatio = offer.kind === 'elixir' ? 1 : Math.min(1, before + POTION_HEAL);
      this.log.add('shop', `${offer.kind === 'elixir' ? 'Elisir' : 'Pozione'}: HP ${Math.round(before * 100)}% → ${Math.round(this.run.state.hpRatio * 100)}%`);
    }
    if (offer.kind === 'item') {
      const item = findItem(offer.itemId ?? '');
      if (item) { this.equipment.equip(item); sfx.equip(item.rarity === 'raro' ? 2 : item.rarity === 'non-comune' ? 1 : 0); }
      this.syncEquipment();
      equipVersion.update(v => v + 1);
    }
    pushLog(`${offer.icon} Acquistato: ${offer.label}`);
    this.log.stats.goldSpent = this.log.stats.goldSpent.plus(offer.cost);
    if (offer.kind === 'item') this.log.stats.itemsBought++;
    this.log.add('shop', `Acquisto: ${offer.label} per ${formatBigNumber(offer.cost)} — oro rimasto ${formatBigNumber(this.run.state.gold)}`);
    this.persistLog();
    this.currentOffers = this.currentOffers.filter(o => o.id !== offerId);
    // le cure che non servono più spariscono (nessuna pozione a HP pieni)
    if (isService) {
      const hp = this.run.state.hpRatio;
      this.currentOffers = this.currentOffers.filter(o =>
        !(o.kind === 'potion' && hp >= 0.98) && !(o.kind === 'elixir' && hp >= 0.6));
    }
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
      level: this.run.shopLevel,
      purchases: this.run.state.purchases,
      special: this.intermissionSpecial
    };
  }

  private openForge(special: boolean): void {
    this.intermissionSpecial = special;
    this.opsLeft = this.forge.opsPerVisit(special);
    this.log.add('forge', `${special ? 'Gran Forgia' : 'Forgia'} — ${this.opsLeft} operazioni — oro ${formatBigNumber(this.run.state.gold)}`);
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

  public quoteIncanto(dieIndex: number, faceIndex: number, effect: FaceEffect): ForgeQuoteView {
    return this.toQuoteView({ kind: 'incanto', dieIndex, faceIndex, effect });
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
    this.log.stats.forgeOps++;
    this.log.stats.goldSpent = this.log.stats.goldSpent.plus(q.cost);
    this.log.add('forge', `${q.preview ?? 'operazione'} per ${formatBigNumber(q.cost)} — oro rimasto ${formatBigNumber(this.run.state.gold)}`);
    this.persistLog();
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
  public newRun(bagId = 'classica'): Promise<void> {
    // la run lasciata a metà si chiude nel registro come abbandonata
    if (!this.log.finished && this.log.stats.turns > 0) this.endRun('abbandonata');
    runSummary.set(null);
    this.saveMgr.clearRun();
    this.run = new RunManager(freshRunState());
    this.playerStats.str = new Decimal(10);
    this.playerStats.int = new Decimal(1);
    this.playerStats.vit = new Decimal(12);
    this.playerStats.lck = 10;
    for (let i = 0; i < this.equipment.slots.length; i++) this.equipment.unequip(i);
    equipVersion.update(v => v + 1);
    this.buildBag(bagId);
    this.equipBagItem();
    this.syncEquipment();
    this.log = this.freshLog();
    this.log.add('run', `Borsa: ${getBag(this.bagId).name}${getBag(this.bagId).item ? ` (parti con ${findItem(getBag(this.bagId).item!)?.name})` : ''}`);
    this.newBattle(0);
    this.publishMenuInfo();
    return this.start();
  }

  public resize(w: number, h: number): void {
    this.diceWorld.resize(w, h);
  }
}
