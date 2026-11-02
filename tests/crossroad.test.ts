import { describe, it, expect } from 'vitest';
import Decimal from 'break_infinity.js';
import { seededRNG, CombatantStats } from '../src/core/types';
import { pickDoors, pickEliteRewards, EVENTS, ELITES_PER_ACT, weakestSlot, EventCtx } from '../src/core/crossroad';
import { RunManager } from '../src/core/RunManager';
import { EquipmentManager, ITEMS } from '../src/core/equipment';
import { GoblinDie } from '../src/core/GoblinDie';
import { Rarity } from '../src/core/types';
import { enemyProfileFor } from '../src/core/enemies';

function ctx(seed = 1): EventCtx {
  const run = new RunManager();
  run.state.gold = new Decimal(1e6);
  run.state.encounter = 4;
  const stats: CombatantStats = { str: new Decimal(10), int: new Decimal(1), vit: new Decimal(12), lck: 10 };
  const rng = seededRNG(seed);
  return { run, stats, bag: [new GoblinDie(Rarity.COMUNE, undefined, rng)], equipment: new EquipmentManager(), rng };
}

describe('Bivio', () => {
  it('le due porte sono sempre diverse e una è economica', () => {
    const rng = seededRNG(5);
    for (let i = 0; i < 300; i++) {
      const [a, b] = pickDoors(rng, false, 0.5);
      expect(a).not.toBe(b);
      expect(['shop', 'forge'].some(k => k === a || k === b)).toBe(true);
    }
  });
  it('niente Élite prima di Campione/Boss né oltre il tetto per Atto', () => {
    const rng = seededRNG(9);
    for (let i = 0; i < 300; i++) {
      expect(pickDoors(rng, true, 0.5)).not.toContain('elite');
      expect(pickDoors(rng, false, 0.5, ELITES_PER_ACT)).not.toContain('elite');
    }
  });
  it('il Riposo si offre solo se mancano HP', () => {
    const rng = seededRNG(3);
    for (let i = 0; i < 200; i++) expect(pickDoors(rng, false, 1)).not.toContain('rest');
  });
});

describe('Élite', () => {
  it('ha una regola, un nome e paga più oro; si azzera avanzando', () => {
    const run = new RunManager();
    run.state.encounter = 3;
    const base = run.goldReward();
    run.state.elite = true;
    expect(run.isElite).toBe(true);
    expect(run.goldReward().gt(base)).toBe(true);
    const p = enemyProfileFor(1, 3, false, false, true);
    expect(p.name.startsWith('Élite')).toBe(true);
    expect(p.rules).not.toBeNull();
    run.advance();
    expect(run.isElite).toBe(false);
  });
  it('Campione e Boss non sono mai Élite', () => {
    const run = new RunManager();
    run.state.encounter = 5; run.state.elite = true;
    expect(run.isElite).toBe(false);
  });
  it('offre due oggetti non posseduti e distinti', () => {
    const r = pickEliteRewards(seededRNG(2), ['dadi-truccati']);
    expect(r).toHaveLength(2);
    expect(r[0]!.id).not.toBe(r[1]!.id);
    expect(r.some(i => i.id === 'dadi-truccati')).toBe(false);
  });
  it('con slot pieni sostituisce il meno raro', () => {
    const eq = new EquipmentManager();
    const rar = ITEMS.filter(i => i.rarity === 'raro').slice(0, 2);
    const com = ITEMS.find(i => i.rarity === 'comune')!;
    const ncs = ITEMS.filter(i => i.rarity === 'non-comune').slice(0, 2);
    [rar[0]!, rar[1]!, ncs[0]!, com, ncs[1]!].forEach(i => eq.equip(i));
    expect(eq.slots[weakestSlot(eq)]!.id).toBe(com.id);
  });
});

describe('Eventi', () => {
  it('ogni scelta si applica senza errori e ritorna un testo', () => {
    for (const ev of EVENTS) {
      ev.options.forEach((o, i) => {
        const c = ctx(i + 7);
        c.equipment.equip(ITEMS.find(x => x.rarity === 'comune')!);
        expect(o.blocked?.(c) ?? null).toBeNull();
        expect(typeof o.apply(c)).toBe('string');
        expect(c.run.state.hpRatio).toBeGreaterThan(0);
        expect(c.run.state.gold.gte(0)).toBe(true);
      });
    }
  });
  it('le scelte che costano HP si bloccano a vita bassa', () => {
    const c = ctx(); c.run.state.hpRatio = 0.2;
    const altare = EVENTS.find(e => e.id === 'altare')!;
    expect(altare.options[0]!.blocked!(c)).not.toBeNull();
  });
  it('il dado maledetto aggiunge un dado alla borsa', () => {
    const c = ctx(); const n = c.bag.length;
    EVENTS.find(e => e.id === 'dado-maledetto')!.options[0]!.apply(c);
    expect(c.bag.length).toBe(n + 1);
  });
});

import { RELICS, findItem } from '../src/core/equipment';
import { pickRelics } from '../src/core/crossroad';

describe('Reliquie', () => {
  it('sono 10, rare, trovabili per id e mai nel negozio', () => {
    expect(RELICS).toHaveLength(10);
    expect(new Set(RELICS.map(r => r.id)).size).toBe(10);
    for (const r of RELICS) { expect(r.relic).toBe(true); expect(findItem(r.id)).toBe(r); expect(ITEMS.some(i => i.id === r.id)).toBe(false); }
  });
  it('il Boss ne offre tre diverse e non quelle già possedute', () => {
    const r = pickRelics(seededRNG(4), ['bastione']);
    expect(r).toHaveLength(3);
    expect(new Set(r.map(x => x.id)).size).toBe(3);
    expect(r.some(x => x.id === 'bastione')).toBe(false);
  });
  it('con slot pieni una reliquia non viene sostituita', () => {
    const eq = new EquipmentManager();
    [RELICS[0]!, ITEMS.filter(i => i.rarity === 'raro')[0]!, ITEMS.filter(i => i.rarity === 'raro')[1]!,
      ITEMS.filter(i => i.rarity === 'raro')[2]!, ITEMS.filter(i => i.rarity === 'raro')[3]!].forEach(i => eq.equip(i));
    expect(eq.slots[weakestSlot(eq)]!.relic).not.toBe(true);
  });
});
