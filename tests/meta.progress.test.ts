import { describe, it, expect } from 'vitest';
import { BAGS, GOALS, buildStarterBag, completedGoals, freshMetaStats, getBag } from '../src/core/meta';
import { SaveManager } from '../src/core/SaveManager';
import { UNLOCKABLE_DICE, createDieFromBlueprint } from '../src/core/diceCatalog';
import { findItem } from '../src/core/equipment';
import { seededRNG } from '../src/core/types';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('Borse di partenza', () => {
  it('ogni borsa ha 5 dadi e sei facce incantate (4 dell\'elemento principale, tranne la classica)', () => {
    for (const b of BAGS) {
      const bag = buildStarterBag(b.id, seededRNG(1));
      expect(bag).toHaveLength(5);
      const fx = bag.flatMap(d => d.faces).filter(f => f.effect);
      expect(fx).toHaveLength(6);
      if (b.id !== 'classica') {
        const main = b.id;
        expect(fx.filter(f => f.effect === main).length).toBe(4);
      }
    }
  });
  it('gli oggetti di partenza esistono', () => {
    for (const b of BAGS) if (b.item) expect(findItem(b.item)).toBeDefined();
  });
  it('una borsa sconosciuta torna alla classica', () => {
    expect(getBag('boh').id).toBe('classica');
  });
});

describe('Obiettivi', () => {
  it('partono tutti da fare e si completano con le statistiche', () => {
    expect(completedGoals(freshMetaStats())).toHaveLength(0);
    const s = { elites: 1, bestAct: 3, bosses: 1, wins: 1 };
    expect(completedGoals(s)).toHaveLength(GOALS.length);
  });
  it('ogni premio punta a qualcosa che esiste', () => {
    for (const g of GOALS) {
      if (g.reward.bag) expect(BAGS.some(b => b.id === g.reward.bag)).toBe(true);
      if (g.reward.die) expect(UNLOCKABLE_DICE.some(d => d.id === g.reward.die)).toBe(true);
    }
  });
  it('le statistiche si salvano e si rileggono', () => {
    const sm = new SaveManager(mem());
    const s = freshMetaStats(); s.elites = 4; s.bestAct = 2;
    sm.saveStats(s);
    expect(sm.loadStats()).toEqual(s);
    expect(new SaveManager(mem()).loadStats()).toEqual(freshMetaStats());
  });
  it('il Dado Prisma ha le tre facce incantate', () => {
    const die = createDieFromBlueprint(UNLOCKABLE_DICE.find(d => d.id === 'dado-prisma')!);
    expect(die.faces.filter(f => f.effect).map(f => f.effect).sort()).toEqual(['fuoco', 'scudo', 'veleno']);
  });
});
