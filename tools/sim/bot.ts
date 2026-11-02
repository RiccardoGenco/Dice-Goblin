import Decimal from 'break_infinity.js';
import { enemyProfileFor } from '../../src/core/enemies';
import { GoblinDie } from '../../src/core/GoblinDie';
import { POTION_HEAL } from '../../src/core/Shop';
import { RunManager, CHAMPION_STAT_MULTIPLIER, BOSS_HP_MULTIPLIER, BOSS_STR_MULTIPLIER } from '../../src/core/RunManager';
import { Forge } from '../../src/core/Forge';
import { BattleEngine } from '../../src/core/BattleEngine';
import { Shop } from '../../src/core/Shop';
import { EquipmentManager, findItem } from '../../src/core/equipment';
import { BALANCE, BattleState, FaceType, IntentType, Rarity, SkillId, seededRNG } from '../../src/core/types';
import { SKILLS } from '../../src/core/skills';
import { UNLOCKABLE_DICE } from '../../src/core/diceCatalog';

/* ============================================================
 * Bot di bilanciamento: gioca run complete con il motore vero
 * (azioni, oggetti, mercante, forgia, HP persistenti).
 *  - 'smart': sceglie l'azione in base all'intento del nemico,
 *    rilancia le facce deboli, compra oggetti e statistiche.
 *  - 'naive': solo Sgancio Brutale, nessun rilancio.
 * Serve ai test di regressione (tests/balance.test.ts) e alla
 * taratura da riga di comando (tools/sim/cli.ts).
 * ============================================================ */

export interface BotOptions {
  policy: 'smart' | 'naive';
  /** gli HP si portano tra gli incontri (come nel gioco) */
  carryHp: boolean;
}

export interface FightLog {
  level: number;
  turns: number;
  hpLost: number;
  damage: number;
  enemyHp: number;
  str: number;
  vit: number;
  items: number;
  used: Record<number, number>;
}

export interface RunResult { diedAt: number; log: FightLog[] }

function makeBag(rng: ReturnType<typeof seededRNG>): GoblinDie[] {
  const special = [
    { value: new Decimal(5), type: FaceType.NORMAL }, { value: new Decimal(10), type: FaceType.NORMAL },
    { value: new Decimal(2), type: FaceType.MULTIPLIER }, { value: new Decimal(3), type: FaceType.MULTIPLIER },
    { value: new Decimal(2), type: FaceType.BUFF_STR }, { value: new Decimal(1), type: FaceType.RECURSIVE }
  ];
  const bag = [
    new GoblinDie(Rarity.COMUNE, undefined, rng), new GoblinDie(Rarity.NON_COMUNE, undefined, rng),
    new GoblinDie(Rarity.RARO, undefined, rng), new GoblinDie(Rarity.EPICO, undefined, rng),
    new GoblinDie(Rarity.LEGGENDARIO, special, rng)
  ];
  // come buildBag del gioco: facce incantate di partenza
  const fx: [number, number, 'veleno' | 'scudo' | 'fuoco'][] =
    [[0, 4, 'veleno'], [0, 5, 'fuoco'], [1, 4, 'scudo'], [1, 5, 'veleno'], [2, 4, 'fuoco'], [2, 5, 'scudo']];
  for (const [d, f, e] of fx) {
    const face = bag[d]!.faces[f]!;
    if (face.type === FaceType.NORMAL) face.effect = e;
  }
  return bag;
}

async function fight(
  stats: any, bag: GoblinDie[], eq: EquipmentManager, run: RunManager,
  hpRatio: number, seed: number, policy: BotOptions['policy']
) {
  const L = run.level;
  const hpM = run.isActBoss ? BOSS_HP_MULTIPLIER : run.isChampion ? CHAMPION_STAT_MULTIPLIER : 1;
  const strM = run.isActBoss ? BOSS_STR_MULTIPLIER : run.isChampion ? CHAMPION_STAT_MULTIPLIER : 1;
  const hpG = new Decimal(BALANCE.ENEMY_HP_GROWTH).pow(L), strG = new Decimal(BALANCE.ENEMY_STR_GROWTH).pow(L);
  const enemy = {
    str: new Decimal(BALANCE.ENEMY_BASE_STR).times(strG).times(strM),
    int: new Decimal(1).times(strG).times(strM),
    vit: new Decimal(BALANCE.ENEMY_BASE_VIT).times(hpG).times(hpM),
    lck: 0
  };
  const eng = new BattleEngine(stats, enemy, bag, seededRNG(seed));
  const prof = enemyProfileFor(run.state.act, run.state.encounter, run.isChampion, run.isActBoss);
  eng.enemyPattern = prof.pattern; eng.bossRules = prof.rules;
  eq.syncPipeline(eng.pipeline, () => eng.itemCtx());
  eng.mods = eq.mods();
  eng.player.hp = eng.player.maxHp.times(hpRatio);
  const startHp = eng.player.hp;
  await eng.initTurn();
  const damage = eng.calcDamage(SKILLS[SkillId.SGANCIO_BRUTALE].skillMod, SkillId.SGANCIO_BRUTALE).toNumber();
  const enemyHp = eng.enemy.maxHp.toNumber();
  const used: Record<number, number> = {};
  let turns = 0;
  const calc = (id: SkillId) => eng.calcDamage(SKILLS[id].skillMod, id);

  while (eng.state === BattleState.WAIT_PLAYER_ACTION && turns < 60) {
    turns++;
    let pick = SkillId.SGANCIO_BRUTALE;
    if (policy === 'smart') {
      const sg = calc(SkillId.SGANCIO_BRUTALE), pa = calc(SkillId.PARATA);
      const bava = calc(SkillId.BAVA).times(0.6).times(Decimal.max(eng.player.stats.int, 1)).times(3 + eng.mods.poisonTurns);
      const intent = eng.currentIntent;
      const incoming = intent && intent.type === IntentType.ATTACK ? intent.value : new Decimal(0);
      const effHp = eng.player.hp.plus(eng.player.shield);
      const enemyEff = eng.enemy.hp.plus(eng.enemy.shield);
      const hpFrac = eng.player.hp.div(eng.player.maxHp).toNumber();
      if (sg.gte(enemyEff)) pick = SkillId.SGANCIO_BRUTALE;
      else if (incoming.gt(0) && incoming.gte(effHp.times(0.45)) && pa.gte(incoming.times(0.6))) pick = SkillId.PARATA;
      else if (bava.gt(sg.times(1.3)) && enemyEff.gt(sg.times(2.5)) && eng.enemy.poison.turnsLeft === 0) pick = SkillId.BAVA;
      else if (!incoming.gt(0) && enemyEff.gt(sg.times(2)) && hpFrac > 0.6 && eng.carriedCount === 0 && !eng.charged) pick = SkillId.CARICA;
    }
    if (policy === 'smart' && (pick === SkillId.PARATA || pick === SkillId.BAVA)) {
      // per Parata e Bava conviene la mano che rende di più quella skill
      const cards = eng.cards, k = Math.min(eng.playSlots, cards.length);
      let best = eng.selection, bestV: Decimal | null = null;
      const walk = (start: number, pk: number[]) => {
        if (pk.length === k) {
          eng.setSelection(pk);
          const v = calc(pick);
          if (!bestV || v.gt(bestV)) { bestV = v; best = [...pk]; }
          return;
        }
        for (let i = start; i < cards.length; i++) walk(i + 1, [...pk, cards[i]!]);
      };
      walk(0, []);
      eng.setSelection(best);
    }
    used[pick] = (used[pick] ?? 0) + 1;
    await eng.resolvePlayerAction(pick);
  }
  const won = eng.state === BattleState.VICTORY;
  const endHp = won ? Decimal.max(eng.player.hp, 0) : new Decimal(0);
  return {
    won, turns, used, damage, enemyHp,
    hpRatio: endHp.div(eng.player.maxHp).toNumber(),
    hpLost: startHp.minus(endHp).div(eng.player.maxHp).toNumber()
  };
}

function forgeVisit(forge: Forge, bag: GoblinDie[], run: RunManager, special: boolean): void {
  const ctx = { level: run.shopLevel, purchases: run.state.purchases, special };
  for (let op = 0; op < forge.opsPerVisit(special); op++) {
    let done = false;
    for (let di = 0; di < bag.length && !done; di++) {
      const die = bag[di]!;
      if (die.faces.filter(f => f.type !== FaceType.NORMAL).length >= 3) continue;
      let fi = -1;
      die.faces.forEach((f, i) => {
        if (f.type === FaceType.NORMAL && !f.effect && (fi === -1 || f.value.lt(die.faces[fi]!.value))) fi = i;
      });
      if (fi === -1) continue;
      const o = { kind: 'trasmutazione' as const, dieIndex: di, faceIndex: fi, target: FaceType.MULTIPLIER };
      const q = forge.quote(o, bag, ctx);
      if (q.ok && run.spendGold(q.cost)) { forge.apply(o, bag); done = true; }
    }
    if (!done) {
      outer: for (let di = 0; di < bag.length; di++) {
        for (let fi = 0; fi < bag[di]!.faces.length; fi++) {
          if (bag[di]!.faces[fi]!.type !== FaceType.MULTIPLIER) continue;
          const o = { kind: 'tempra' as const, dieIndex: di, faceIndex: fi };
          const q = forge.quote(o, bag, ctx);
          if (q.ok && run.spendGold(q.cost)) { forge.apply(o, bag); break outer; }
        }
      }
    }
  }
}

/** Solo per esperimenti: SIM_NOSHOP=1 salta negozio e forgia (misura quanto pesano) */
const NOSHOP = !!(globalThis as any).process?.env?.SIM_NOSHOP;

const RARITY_ORDER: Record<string, number> = { 'comune': 0, 'non-comune': 1, 'raro': 2 };

function shopVisit(shop: Shop, stats: any, bag: GoblinDie[], eq: EquipmentManager, run: RunManager, special: boolean): void {
  // come nel gioco: offerte generate per visita, ognuna comprabile una volta; rilancio a costo crescente
  const available: any[] = [];
  let rerolls = 0;
  let offers = shop.generateOffers(run.shopLevel, run.state.purchases, bag, available, special, eq.ownedIds, run.state.hpRatio);
  const rank = (o: any) => {
    if (o.kind === 'item') return 10 + RARITY_ORDER[o.rarity]!;
    if (o.kind === 'upgrade-face') return bag[o.dieIndex]?.faces[o.faceIndex]?.type === FaceType.MULTIPLIER ? 12.5 : 4;
    if (o.kind === 'potion' || o.kind === 'elixir') return 20; // le cure prima, ma solo se servono (vedi sotto)
    return 1;
  };
  for (let round = 0; round < 4; round++) {
    offers.sort((a, b) => rank(b) - rank(a));
    for (const o of offers) {
      if (run.state.gold.lt(o.cost)) continue;
      if (o.kind === 'potion') {
        if (run.state.hpRatio < 0.75 && run.spendGold(o.cost, false)) run.state.hpRatio = Math.min(1, run.state.hpRatio + POTION_HEAL);
        continue;
      }
      if (o.kind === 'elixir') {
        if (run.state.hpRatio < 0.5 && run.spendGold(o.cost, false)) run.state.hpRatio = 1;
        continue;
      }
      if (o.kind === 'item') {
        if (eq.freeSlots === 0) {
          if (o.rarity !== 'raro') continue;
          const idx = eq.slots.findIndex(s => s && s.rarity === 'comune');
          if (idx < 0) continue;
          run.addGold(shop.sellValue(eq.slots[idx]!, run.shopLevel));
          eq.unequip(idx);
        }
        const item = findItem(o.itemId ?? '');
        if (item && run.spendGold(o.cost)) eq.equip(item);
        continue;
      }
      if (run.spendGold(o.cost)) shop.apply(o, { stats, bag, blueprints: UNLOCKABLE_DICE });
    }
    // rilancia solo se l'oro avanzato è molto più del prezzo del rilancio
    const rc = shop.rerollCost(run.shopLevel, rerolls);
    if (run.state.gold.lt(rc.times(3))) break;
    if (!run.spendGold(rc, false)) break;
    rerolls++;
    offers = shop.generateMerchandise(run.shopLevel, run.state.purchases, bag, available, special, eq.ownedIds);
  }
}

export async function simulateRun(seed: number, opts: BotOptions): Promise<RunResult> {
  const rng = seededRNG(seed * 7919);
  const stats = { str: new Decimal(10), int: new Decimal(1), vit: new Decimal(12), lck: 10 };
  const bag = makeBag(rng);
  const run = new RunManager();
  const forge = new Forge();
  const shop = new Shop(seededRNG(seed * 31));
  const eq = new EquipmentManager();
  let forgeNext = false;
  const log: FightLog[] = [];

  for (let e = 0; e < 30; e++) {
    const L = run.level;
    const special = run.isBossFight;
    const hp0 = opts.carryHp ? run.state.hpRatio : 1;
    const r = await fight(stats, bag, eq, run, hp0, seed * 1000 + e, opts.policy);
    log.push({
      level: L, turns: r.turns, hpLost: r.hpLost, damage: r.damage, enemyHp: r.enemyHp,
      str: stats.str.toNumber(), vit: stats.vit.toNumber(), items: eq.ownedIds.length, used: r.used
    });
    if (!r.won) return { diedAt: L, log };
    run.state.hpRatio = special ? 1 : Math.min(1, Math.max(0.05, r.hpRatio) + BALANCE.HEAL_PER_WIN);
    run.addGold(run.goldReward());
    run.applyInterest();
    stats.str = stats.str.times(BALANCE.WIN_STR_GROWTH);
    stats.vit = stats.vit.times(BALANCE.WIN_VIT_GROWTH);
    run.advance();
    const visitShop = special || !forgeNext;
    const visitForge = special || forgeNext;
    forgeNext = !forgeNext;
    if (visitForge && !NOSHOP) forgeVisit(forge, bag, run, special);
    if (visitShop && !NOSHOP) shopVisit(shop, stats, bag, eq, run, special);
  }
  return { diedAt: 30, log };
}

export interface BalanceReport {
  seeds: number;
  completion: number;
  reach: (level: number) => number;
  medianDeath: number;
  avgTurns: (from: number, to: number) => number;
  avgHpLost: (from: number, to: number) => number;
  results: RunResult[];
}

export async function simulateMany(seeds: number, opts: BotOptions): Promise<BalanceReport> {
  const results: RunResult[] = [];
  for (let s = 1; s <= seeds; s++) results.push(await simulateRun(s, opts));
  const deaths = results.map(r => r.diedAt).sort((a, b) => a - b);
  const fights = (from: number, to: number) =>
    results.flatMap(r => r.log.filter(l => l.level >= from && l.level <= to));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  return {
    seeds,
    completion: deaths.filter(d => d === 30).length / seeds,
    reach: level => deaths.filter(d => d >= level).length / seeds,
    medianDeath: deaths[Math.floor(seeds / 2)]!,
    avgTurns: (a, b) => mean(fights(a, b).map(f => f.turns)),
    avgHpLost: (a, b) => mean(fights(a, b).map(f => f.hpLost)),
    results
  };
}
