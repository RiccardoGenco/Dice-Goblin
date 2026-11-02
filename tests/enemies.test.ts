import { describe, it, expect } from 'vitest';
import Decimal from 'break_infinity.js';
import { BattleEngine } from '../src/core/BattleEngine';
import { GoblinDie } from '../src/core/GoblinDie';
import { BALANCE, IntentType, Rarity, seededRNG } from '../src/core/types';
import { CLASS_PATTERNS, BOSS_PROFILES, enemyProfileFor } from '../src/core/enemies';

const mk = () => {
  const stats = { str: new Decimal(5), int: new Decimal(1), vit: new Decimal(10), lck: 0 };
  const enemy = { str: new Decimal(10), int: new Decimal(2), vit: new Decimal(20), lck: 0 };
  const bag = [new GoblinDie(Rarity.COMUNE), new GoblinDie(Rarity.COMUNE)];
  return new BattleEngine(stats, enemy, bag, seededRNG(1));
};

describe('schemi nemici', () => {
  it('ogni classe ha uno schema e i boss hanno regole', () => {
    expect(Object.keys(CLASS_PATTERNS)).toHaveLength(6);
    expect(enemyProfileFor(1, 10, false, true).rules).not.toBeNull();
    expect(enemyProfileFor(1, 2, false, false).rules).toBeNull();
    expect(Object.keys(BOSS_PROFILES)).toHaveLength(3);
  });

  it('gli intenti seguono lo schema in ciclo e peekIntents li anticipa', async () => {
    const e = mk();
    e.enemyPattern = CLASS_PATTERNS.Chierico; // SCUDO, SCUDO, ATTACCO pesante
    await e.initTurn();
    expect(e.currentIntent!.type).toBe(IntentType.SHIELD);
    const next = e.peekIntents(2);
    expect(next.map(i => i.type)).toEqual([IntentType.SHIELD, IntentType.ATTACK]);
    expect(next[1]!.tag).toBe('Colpo pesante');
    expect(next[1]!.value.eq(e.enemy.stats.str.times(2).times(1.8))).toBe(true);
  });

  it('senza schema peekIntents è vuoto', async () => {
    const e = mk();
    await e.initTurn();
    expect(e.peekIntents(2)).toEqual([]);
  });

  it('la penalità del boss toglie un dado alla mano', async () => {
    const stats = { str: new Decimal(5), int: new Decimal(1), vit: new Decimal(10), lck: 0 };
    const e = new BattleEngine(stats, stats, Array.from({ length: 6 }, () => new GoblinDie(Rarity.COMUNE)), seededRNG(1));
    e.bossRules = { handPenalty: 1, text: 'x' };
    await e.initTurn();
    expect(e.cards.length).toBe(BALANCE.HAND_DRAW - 1);
  });
});
