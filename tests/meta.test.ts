import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import {
  RunManager,
  ENCOUNTERS_PER_ACT,
  TOTAL_ACTS,
  freshRunState
} from '../src/core/RunManager';
import { Shop } from '../src/core/Shop';
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
      new RunManager({ act: 1, encounter, gold: new Decimal(0), purchases: 0 });
    // Normalizzo per la crescita 1.5^level per isolare i moltiplicatori
    const norm = (enc: number) =>
      at(enc).goldReward().div(new Decimal(1.5).pow(enc - 1)).toNumber();
    expect(norm(5) / norm(4)).toBeCloseTo(2, 6); // Campione
    expect(norm(10) / norm(9)).toBeCloseTo(3, 6); // Boss d'Atto
  });

  it('il terzo boss completa la run', () => {
    const run = new RunManager({ act: TOTAL_ACTS, encounter: ENCOUNTERS_PER_ACT, gold: new Decimal(0), purchases: 0 });
    expect(run.advance()).toBe('run-completed');
  });

  it("la ricompensa cresce di 1.5^level (stessa curva dei costi shop)", () => {
    const runA = new RunManager();
    const runB = new RunManager({ act: 1, encounter: 4, gold: new Decimal(0), purchases: 0 });
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
    const cheap = shop.generateOffers(0, 0, bag, [])[0]!;
    const dear = shop.generateOffers(8, 0, bag, [])[0]!;
    expect(dear.cost.div(cheap.cost).toNumber()).toBeGreaterThan(BALANCE.SHOP_COST_GROWTH ** 7);
  });

  it('gli acquisti ripetuti rincarano le offerte (+25% composto)', () => {
    const shop = new Shop(seededRNG(1));
    const bag = [new GoblinDie(Rarity.COMUNE, undefined, seededRNG(1))];
    const first = shop.generateOffers(0, 0, bag, [])[0]!;
    const later = shop.generateOffers(0, 4, bag, [])[0]!;
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

  it('Mercante Reale: sconto 30% e offerta premium esclusiva', () => {
    const shop = new Shop(seededRNG(1));
    const bag = [new GoblinDie(Rarity.COMUNE, undefined, seededRNG(1))];
    const normal = shop.generateOffers(0, 0, bag, []);
    const special = shop.generateOffers(0, 0, bag, [], true);

    // L'offerta premium compare solo in modalità speciale
    expect(normal.some(o => o.id === 'offer-str-major')).toBe(false);
    expect(special.some(o => o.id === 'offer-str-major')).toBe(true);

    // Stessa offerta base, prezzo scontato del 30%
    const normStr = normal.find(o => o.id === 'offer-str')!;
    const specStr = special.find(o => o.id === 'offer-str')!;
    expect(specStr.cost.lt(normStr.cost)).toBe(true);
    expect(specStr.cost.toNumber()).toBe(Math.floor(normStr.cost.toNumber() * 0.7));
  });

  it('stat-str compone il 30%: due acquisti = ×1.69', () => {
    const shop = new Shop(seededRNG(1));
    const ctx = { stats: stats(), bag: [] as GoblinDie[], blueprints: UNLOCKABLE_DICE };
    const offer = { id: 'x', kind: 'stat-str' as const, icon: '', label: '', description: '', cost: new Decimal(0) };
    shop.apply(offer, ctx);
    shop.apply(offer, ctx);
    expect(ctx.stats.str.toNumber()).toBeCloseTo(10 * 1.3 * 1.3, 6);
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
      run: { act: 2, encounter: 7, gold: new Decimal('3.5e12'), purchases: 3 },
      playerStats: { str: new Decimal('1e40'), int: new Decimal(2), vit: new Decimal(50), lck: 30 },
      bag,
      equipmentIds: ['anello-bruto', 'idolo-goblin']
    });

    const loaded = save.loadRun();
    expect(loaded).not.toBeNull();
    expect(loaded!.run.act).toBe(2);
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
