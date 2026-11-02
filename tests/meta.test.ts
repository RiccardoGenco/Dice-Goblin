import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import {
  RunManager,
  ENCOUNTERS_PER_ACT,
  TOTAL_ACTS,
  freshRunState
} from '../src/core/RunManager';
import { Shop } from '../src/core/Shop';
import { ITEMS } from '../src/core/equipment';
import { SaveManager, memoryStorage, serializeDie, hydrateDie } from '../src/core/SaveManager';
import { GoblinDie } from '../src/core/GoblinDie';
import { UNLOCKABLE_DICE, createDieFromBlueprint } from '../src/core/diceCatalog';
import { BALANCE, CombatantStats, FaceType, Rarity, seededRNG } from '../src/core/types';

describe('RunManager — struttura ad Atti (MVP §1)', () => {
  it('il level globale è continuo tra gli Atti', () => {
    const run = new RunManager();
    expect(run.level).toBe(0);
    run.state.act = 2;
    run.state.encounter = 1;
    expect(run.level).toBe(ENCOUNTERS_PER_ACT); // 10
    run.state.act = 3;
    run.state.encounter = 10;
    expect(run.level).toBe(29);
  });

  it("boss fight ogni 5: il 5° è il Campione (non chiude l'Atto), il 10° il Boss", () => {
    const run = new RunManager();
    // Incontri 1-4: normali
    for (let i = 1; i <= 4; i++) {
      expect(run.isBossFight).toBe(false);
      expect(run.advance()).toBe('next-encounter');
    }
    // 5° incontro: Campione
    expect(run.isBossFight).toBe(true);
    expect(run.isChampion).toBe(true);
    expect(run.isActBoss).toBe(false);
    expect(run.advance()).toBe('next-encounter'); // l'Atto continua
    expect(run.state.act).toBe(1);
    // Incontri 6-9: normali
    for (let i = 6; i <= 9; i++) {
      expect(run.isBossFight).toBe(false);
      run.advance();
    }
    // 10° incontro: Boss d'Atto
    expect(run.isActBoss).toBe(true);
    expect(run.isChampion).toBe(false);
    expect(run.advance()).toBe('act-completed');
    expect(run.state.act).toBe(2);
    expect(run.state.encounter).toBe(1);
  });

  it('Campione paga x2 e Boss x3 rispetto a un incontro normale', () => {
    const at = (encounter: number) =>
      new RunManager({ act: 1, encounter, gold: new Decimal(0), purchases: 0, hpRatio: 1 });
    // Normalizzo per la crescita 1.5^level per isolare i moltiplicatori
    const norm = (enc: number) =>
      at(enc).goldReward().div(new Decimal(1.5).pow(enc - 1)).toNumber();
    expect(norm(5) / norm(4)).toBeCloseTo(2, 6); // Campione
    expect(norm(10) / norm(9)).toBeCloseTo(3, 6); // Boss d'Atto
  });

  it('il terzo boss completa la run', () => {
    const run = new RunManager({ act: TOTAL_ACTS, encounter: ENCOUNTERS_PER_ACT, gold: new Decimal(0), purchases: 0, hpRatio: 1 });
    expect(run.advance()).toBe('run-completed');
  });

  it("la ricompensa cresce di 1.5^level (stessa curva dei costi shop)", () => {
    const runA = new RunManager();
    const runB = new RunManager({ act: 1, encounter: 4, gold: new Decimal(0), purchases: 0, hpRatio: 1 });
    const ratio = runB.goldReward().div(runA.goldReward()).toNumber();
    expect(ratio).toBeCloseTo(1.5 ** 3, 6);
  });

  it('spendGold rifiuta senza addebitare se l\'oro non basta', () => {
    const run = new RunManager();
    run.addGold(new Decimal(10));
    expect(run.spendGold(new Decimal(50))).toBe(false);
    expect(run.state.gold.toNumber()).toBe(10);
    expect(run.spendGold(new Decimal(10))).toBe(true);
    expect(run.state.gold.toNumber()).toBe(0);
    expect(run.state.purchases).toBe(1);
  });
});

describe('Shop — economia su curva esponenziale (GDD §4.2)', () => {
  const stats = (): CombatantStats => ({
    str: new Decimal(10),
    int: new Decimal(1),
    vit: new Decimal(12),
    lck: 0
  });

  it('i costi crescono sulla curva SHOP_COST_GROWTH', () => {
    const shop = new Shop(seededRNG(1));
    const bag = [new GoblinDie(Rarity.COMUNE, undefined, seededRNG(1))];
    const cheap = shop.generateOffers(0, 0, bag, []).find(o => o.kind === 'upgrade-face')!;
    const dear = shop.generateOffers(8, 0, bag, []).find(o => o.kind === 'upgrade-face')!;
    expect(dear.cost.div(cheap.cost).toNumber()).toBeGreaterThan(BALANCE.SHOP_COST_GROWTH ** 7);
    // il prezzo segue il bottino: stessa frazione a ogni livello
    expect(BALANCE.SHOP_COST_GROWTH).toBe(BALANCE.GOLD_REWARD_GROWTH);
  });

  it('gli acquisti ripetuti rincarano le offerte (+3% composto)', () => {
    const shop = new Shop(seededRNG(1));
    const bag = [new GoblinDie(Rarity.COMUNE, undefined, seededRNG(1))];
    const first = shop.generateOffers(0, 0, bag, []).find(o => o.kind === 'upgrade-face')!;
    const later = shop.generateOffers(0, 4, bag, []).find(o => o.kind === 'upgrade-face')!;
    expect(later.cost.gt(first.cost)).toBe(true);
  });

  it('offre un dado del pool solo se non è già in borsa', () => {
    const shop = new Shop(seededRNG(1));
    const golden = UNLOCKABLE_DICE[0]!;
    const emptyBag = [new GoblinDie(Rarity.COMUNE)];
    const withDie = [...emptyBag, createDieFromBlueprint(golden)];

    const offered = shop.generateOffers(0, 0, emptyBag, [golden]);
    const notOffered = shop.generateOffers(0, 0, withDie, [golden]);
    expect(offered.some(o => o.blueprintId === golden.id)).toBe(true);
    expect(notOffered.some(o => o.blueprintId === golden.id)).toBe(false);
  });

  it('Mercante Reale: sconto 30%, un oggetto in più e un raro garantito', () => {
    const shop = new Shop(seededRNG(1));
    const bag = [new GoblinDie(Rarity.COMUNE, undefined, seededRNG(1))];
    const normal = shop.generateOffers(0, 0, bag, []);
    const special = shop.generateOffers(0, 0, bag, [], true);

    const normF = normal.find(o => o.id === 'offer-face')!;
    const specF = special.find(o => o.id === 'offer-face')!;
    expect(Math.abs(specF.cost.toNumber() - normF.cost.toNumber() * 0.7)).toBeLessThanOrEqual(1);
    expect(normal.filter(o => o.kind === 'item').length).toBe(3);
    expect(special.filter(o => o.kind === 'item').length).toBe(4);
    for (let i = 0; i < 20; i++) {
      const s2 = new Shop(seededRNG(i + 10)).generateOffers(0, 0, bag, [], true);
      expect(s2.some(o => o.kind === 'item' && o.rarity === 'raro')).toBe(true);
    }
  });

  it('Forza e Vitalità non sono più in vendita', () => {
    const shop = new Shop(seededRNG(2));
    const bag = [new GoblinDie(Rarity.COMUNE, undefined, seededRNG(1))];
    for (const special of [false, true]) {
      const kinds = new Set(shop.generateOffers(5, 0, bag, [], special).map(o => o.kind));
      expect([...kinds].every(k => ['upgrade-face', 'new-die', 'item', 'potion', 'elixir'].includes(k))).toBe(true);
    }
  });

  it('la rarità offerta sale con la profondità della run', () => {
    const bag = [new GoblinDie(Rarity.COMUNE, undefined, seededRNG(1))];
    const rareShare = (level: number) => {
      let rare = 0, total = 0;
      for (let i = 0; i < 300; i++) {
        for (const o of new Shop(seededRNG(i + 1)).generateOffers(level, 0, bag, [])) {
          if (o.kind === 'item') { total++; if (o.rarity === 'raro') rare++; }
        }
      }
      return rare / total;
    };
    const early = rareShare(0), late = rareShare(25);
    expect(early).toBeLessThan(0.08);
    expect(late).toBeGreaterThan(0.12);
    expect(late).toBeGreaterThan(early * 3);
  });

  it('prezzi legati al bottino: un oggetto comune costa la stessa frazione a ogni livello', () => {
    const shop = new Shop(seededRNG(1));
    const item = ITEMS.find(i => i.rarity === 'comune')!;
    const frac = (L: number) => shop.itemCost(item, L, 0).toNumber() / RunManager.incomeAt(L).toNumber();
    expect(frac(0)).toBeCloseTo(frac(20), 1);
    // più alto il tier, più costa
    const rare = ITEMS.find(i => i.rarity === 'raro')!;
    expect(shop.itemCost(rare, 5, 0).gt(shop.itemCost(item, 5, 0))).toBe(true);
  });

  it('il rilancio del banco costa sempre di più nella stessa visita', () => {
    const shop = new Shop(seededRNG(1));
    const c0 = shop.rerollCost(5, 0).toNumber();
    const c1 = shop.rerollCost(5, 1).toNumber();
    const c3 = shop.rerollCost(5, 3).toNumber();
    expect(c1).toBeGreaterThan(c0);
    expect(c3).toBeGreaterThan(c1 * 2);
  });

  it('pozione ed elisir compaiono solo se si è feriti, e non rincarano con gli acquisti', () => {
    const shop = new Shop(seededRNG(1));
    expect(shop.generateServices(3, false, 1).length).toBe(0);
    expect(shop.generateServices(3, false, 0.8).map(o => o.kind)).toEqual(['potion']);
    expect(shop.generateServices(3, false, 0.4).map(o => o.kind)).toEqual(['potion', 'elixir']);
    const bag = [new GoblinDie(Rarity.COMUNE, undefined, seededRNG(1))];
    const a = shop.generateOffers(3, 0, bag, [], false, [], 0.5).find(o => o.kind === 'potion')!;
    const b = shop.generateOffers(3, 30, bag, [], false, [], 0.5).find(o => o.kind === 'potion')!;
    expect(b.cost.eq(a.cost)).toBe(true);
  });

  it('interesse: 8% dell\'oro non speso, con tetto', () => {
    const run = new RunManager();
    run.state.gold = new Decimal(100);
    expect(run.applyInterest().toNumber()).toBe(8);
    run.state.gold = new Decimal(1e9);
    expect(run.applyInterest().toNumber()).toBe(Math.floor(RunManager.incomeAt(run.level).toNumber() * BALANCE.INTEREST_CAP));
  });

  it('primo negozio (dopo 1 vittoria): con il bottino si comprano almeno due cose', () => {
    const run = new RunManager();
    run.addGold(run.goldReward());
    run.applyInterest();
    run.advance();
    const bag = [new GoblinDie(Rarity.COMUNE, undefined, seededRNG(1))];
    const costs = new Shop(seededRNG(3)).generateOffers(run.shopLevel, run.state.purchases, bag, [])
      .map(o => o.cost.toNumber()).sort((a, b) => a - b);
    expect(costs[0]! + costs[1]!).toBeLessThanOrEqual(run.state.gold.toNumber());
  });

  it('spendGold(…, false) non incrementa gli acquisti', () => {
    const run = new RunManager();
    run.state.gold = new Decimal(100);
    run.spendGold(new Decimal(10), false);
    expect(run.state.purchases).toBe(0);
    run.spendGold(new Decimal(10));
    expect(run.state.purchases).toBe(1);
  });
});

describe('SaveManager — round-trip run e meta (GDD §2.2)', () => {
  it('salva e ricarica una run completa con Decimal reidratati', () => {
    const save = new SaveManager(memoryStorage());
    const bag = [
      new GoblinDie(Rarity.RARO),
      createDieFromBlueprint(UNLOCKABLE_DICE[0]!)
    ];
    save.saveRun({
      run: { act: 2, encounter: 7, gold: new Decimal('3.5e12'), purchases: 3, hpRatio: 0.6 },
      playerStats: { str: new Decimal('1e40'), int: new Decimal(2), vit: new Decimal(50), lck: 30 },
      bag,
      equipmentIds: ['anello-bruto', 'idolo-goblin']
    });

    const loaded = save.loadRun();
    expect(loaded).not.toBeNull();
    expect(loaded!.run.act).toBe(2);
    expect(loaded!.run.hpRatio).toBeCloseTo(0.6, 6); // gli HP si portano nel salvataggio
    expect(loaded!.run.gold.eq(new Decimal('3.5e12'))).toBe(true);
    expect(loaded!.playerStats.str.eq(new Decimal('1e40'))).toBe(true);
    expect(typeof loaded!.playerStats.str.times).toBe('function'); // prototipo OK
    expect(loaded!.bag.length).toBe(2);
    expect(loaded!.bag[1]!.blueprintId).toBe('dado-dorato');
    expect(loaded!.equipmentIds).toEqual(['anello-bruto', 'idolo-goblin']);
  });

  it('il round-trip dei dadi preserva facce, tipi e rarità', () => {
    const original = createDieFromBlueprint(UNLOCKABLE_DICE[2]!); // colossale
    const restored = hydrateDie(JSON.parse(JSON.stringify(serializeDie(original))));
    expect(restored.rarity).toBe(original.rarity);
    restored.faces.forEach((f, i) => {
      expect(f.type).toBe(original.faces[i]!.type);
      expect(f.value.eq(original.faces[i]!.value)).toBe(true);
    });
    expect(restored.faces.some(f => f.type === FaceType.MULTIPLIER)).toBe(true);
  });

  it('un salvataggio corrotto ritorna null senza eccezioni', () => {
    const storage = memoryStorage();
    storage.setItem('goblin-revenge:run', '{corrotto!!!');
    const save = new SaveManager(storage);
    expect(save.loadRun()).toBeNull();
  });

  it('gli sblocchi meta sono permanenti e senza duplicati', () => {
    const save = new SaveManager(memoryStorage());
    expect(save.loadUnlocks()).toEqual([]);
    save.addUnlock('dado-dorato');
    save.addUnlock('dado-dorato');
    save.addUnlock('dado-ricorsivo');
    expect(save.loadUnlocks()).toEqual(['dado-dorato', 'dado-ricorsivo']);
  });
});

describe('Pozione di Cura (sink dell\'oro)', () => {
  it('compare solo se si è feriti e costa più a livelli alti', () => {
    const shop = new Shop();
    const bag = [new GoblinDie(Rarity.COMUNE)];
    expect(shop.generateOffers(0, 0, bag, [], false, [], 1).some(o => o.kind === 'potion')).toBe(false);
    const hurt0 = shop.generateOffers(0, 0, bag, [], false, [], 0.5).find(o => o.kind === 'potion')!;
    const hurt8 = shop.generateOffers(8, 0, bag, [], false, [], 0.5).find(o => o.kind === 'potion')!;
    expect(hurt0).toBeTruthy();
    expect(hurt8.cost.gt(hurt0.cost)).toBe(true);
  });
});
