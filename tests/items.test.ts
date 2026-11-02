import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { BattleEngine } from '../src/core/BattleEngine';
import { GoblinDie } from '../src/core/GoblinDie';
import { EquipmentManager, ITEMS, ITEM_RARITY_META, findItem } from '../src/core/equipment';
import { Shop, ITEMS_PER_VISIT } from '../src/core/Shop';
import {
  BALANCE, CombatantStats, DieFace, FaceEffect, FaceType, IntentType, Rarity, SkillId, seededRNG
} from '../src/core/types';

const mk = (str = 0, vit = 10): CombatantStats => ({
  str: new Decimal(str), int: new Decimal(1), vit: new Decimal(vit), lck: 0
});
const face = (value: number, effect?: FaceEffect): DieFace =>
  ({ value: new Decimal(value), type: FaceType.NORMAL, effect });
const uniform = (value: number, effect?: FaceEffect) =>
  new GoblinDie(Rarity.COMUNE, Array.from({ length: 6 }, () => face(value, effect)), seededRNG(1));

async function engineWith(ids: string[], bag: GoblinDie[]) {
  const e = new BattleEngine(mk(), mk(10, 1e9), bag, seededRNG(3));
  const eq = new EquipmentManager();
  ids.forEach(id => eq.equip(findItem(id)!));
  eq.syncPipeline(e.pipeline, () => e.itemCtx());
  e.mods = eq.mods();
  await e.initTurn();
  return e;
}

describe('Catalogo oggetti', () => {
  it('id unici e rarità valide', () => {
    expect(new Set(ITEMS.map(i => i.id)).size).toBe(ITEMS.length);
    for (const i of ITEMS) expect(ITEM_RARITY_META[i.rarity]).toBeDefined();
  });
  it('ogni oggetto fa qualcosa (danno o regola)', () => {
    for (const i of ITEMS) expect(!!i.apply || !!i.mods).toBe(true);
  });
});

describe('Oggetti condizionali', () => {
  it('Fungo Marcio vale solo per Bava', async () => {
    const e = await engineWith(['fungo-marcio'], [uniform(10)]);
    const base = e.calcDamage(new Decimal(1)).toNumber();
    expect(e.calcDamage(new Decimal(1), SkillId.SGANCIO_BRUTALE).toNumber()).toBe(base);
    expect(e.calcDamage(new Decimal(1), SkillId.BAVA).toNumber()).toBeCloseTo(base * 1.5, 6);
  });

  it('Unghia Sporca conta le facce incantate', async () => {
    const e = await engineWith(['unghia-sporca'], [uniform(10, 'veleno'), uniform(10)]);
    expect(e.calcDamage(new Decimal(1)).toNumber()).toBe(20 + 4);
  });

  it('Nervi Saldi premia le mani senza facce incantate, Ruota della Fortuna i dadi in panchina', async () => {
    const plain = await engineWith(['nervi-saldi'], [uniform(10)]);
    const fancy = await engineWith(['nervi-saldi'], [uniform(10, 'veleno')]);
    expect(plain.calcDamage(new Decimal(1)).toNumber()).toBeCloseTo(15, 6);
    expect(fancy.calcDamage(new Decimal(1)).toNumber()).toBeCloseTo(10, 6);
    // 5 dadi pescati, 3 giocati: 2 in panchina
    const ruota = await engineWith(['ruota-fortuna'], [1, 2, 3, 4, 5].map(() => uniform(10)));
    expect(ruota.selection).toHaveLength(3);
    expect(ruota.calcDamage(new Decimal(1)).toNumber()).toBeCloseTo(30 * 1.2 * 1.2, 6);
    const solo = await engineWith(['ruota-fortuna'], [uniform(10)]);
    expect(solo.calcDamage(new Decimal(1)).toNumber()).toBeCloseTo(10, 6);
  });

  it('Predatore e Frantumascudi leggono lo stato del nemico', async () => {
    const e = await engineWith(['predatore', 'frantumascudi'], [uniform(10)]);
    expect(e.calcDamage(new Decimal(1)).toNumber()).toBeCloseTo(10, 6);
    e.enemy.poison = { perTurn: new Decimal(1), turnsLeft: 2 };
    expect(e.calcDamage(new Decimal(1)).toNumber()).toBeCloseTo(14, 6);
    e.enemy.shield = new Decimal(5);
    expect(e.calcDamage(new Decimal(1)).toNumber()).toBeCloseTo(21, 6);
  });

  it('Pietra del Catalizzatore scala con le reazioni', async () => {
    const e = await engineWith(['pietra-catalizzatore'], [uniform(4, 'veleno'), uniform(4, 'fuoco')]);
    expect(e.calcDamage(new Decimal(1)).toNumber()).toBeCloseTo(8 * 1.5, 6); // vapori
  });

  it('Rabbia del Goblin scatta sotto metà HP', async () => {
    const e = await engineWith(['rabbia-goblin'], [uniform(10)]);
    expect(e.calcDamage(new Decimal(1)).toNumber()).toBeCloseTo(10, 6);
    e.player.hp = e.player.maxHp.times(0.4);
    expect(e.calcDamage(new Decimal(1)).toNumber()).toBeCloseTo(16, 6);
  });
});

describe('Oggetti che cambiano le regole', () => {
  it('Dadi Truccati fa giocare un dado in più, Mano Larga ne fa pescare uno in più', async () => {
    const e = await engineWith(['dadi-truccati'], [uniform(5)]);
    expect(e.playSlots).toBe(BALANCE.HAND_PLAY + 1);
    const m = await engineWith(['mano-larga'], Array.from({ length: 8 }, () => uniform(5)));
    expect(m.cards).toHaveLength(BALANCE.HAND_DRAW + 1);
  });

  it('Pentolino Fumante: il fuoco fa ×3', async () => {
    const e = await engineWith(['pentolino-fumante'], [uniform(5, 'fuoco')]);
    expect(e.getEffects().fire.toNumber()).toBe(15);
  });

  it('Calderone potenzia le reazioni, Pelle Spessa lo scudo', async () => {
    const bag = [uniform(4, 'veleno'), uniform(6, 'scudo'), uniform(2, 'fuoco')];
    const plain = await engineWith([], bag);
    const boosted = await engineWith(['calderone', 'pelle-spessa'], bag);
    await plain.resolvePlayerAction(SkillId.SGANCIO_BRUTALE);
    await boosted.resolvePlayerAction(SkillId.SGANCIO_BRUTALE);
    expect(boosted.enemy.hp.toNumber()).toBeLessThan(plain.enemy.hp.toNumber());
  });

  it('Scudo Chiodato aumenta il rimbalzo della Parata', async () => {
    const run = async (ids: string[]) => {
      const e = await engineWith(ids, [uniform(10)]);
      e.currentIntent = { type: IntentType.ATTACK, value: new Decimal(100) };
      const hp = e.enemy.hp;
      await e.resolvePlayerAction(SkillId.PARATA);
      return hp.minus(e.enemy.hp).toNumber();
    };
    expect(await run(['scudo-chiodato'])).toBeCloseTo((await run([])) * 1.5, 6);
  });

  it('Cuore di Carica porta il bonus a ×2', async () => {
    const e = await engineWith(['cuore-carica'], [uniform(10)]);
    await e.resolvePlayerAction(SkillId.CARICA);
    expect(e.calcDamage(new Decimal(1)).toNumber()).toBeCloseTo(20 * 2, 6);
  });

  it('Fiala Velenosa allunga il veleno di Bava', async () => {
    const e = await engineWith(['fiala-velenosa'], [uniform(10)]);
    e.currentIntent = { type: IntentType.SHIELD, value: new Decimal(1) };
    await e.resolvePlayerAction(SkillId.BAVA);
    expect(e.enemy.poison.turnsLeft).toBe(3 + 1 - 1);
  });
});

describe('Mercante: oggetti', () => {
  it('offre ITEMS_PER_VISIT oggetti non posseduti', () => {
    const shop = new Shop(seededRNG(5));
    const owned = ['anello-bruto', 'idolo-goblin'];
    const offers = shop.generateOffers(0, 0, [uniform(1)], [], false, owned).filter(o => o.kind === 'item');
    expect(offers.length).toBe(ITEMS_PER_VISIT);
    for (const o of offers) expect(owned).not.toContain(o.itemId);
  });

  it('i rari costano di più e la rivendita è metà prezzo base', () => {
    const shop = new Shop(seededRNG(5));
    const c = shop.itemCost(findItem('lente-avida')!, 0, 0);
    const r = shop.itemCost(findItem('idolo-goblin')!, 0, 0);
    expect(r.gt(c)).toBe(true);
    expect(shop.sellValue(findItem('lente-avida')!, 0).toNumber()).toBe(20); // 0.45 del bottino (90) dimezzato
  });
});
