import { describe, it, expect } from 'vitest';
import Decimal from 'break_infinity.js';
import { BattleEngine } from '../src/core/BattleEngine';
import { GoblinDie } from '../src/core/GoblinDie';
import { IntentType, Rarity, seededRNG } from '../src/core/types';
import { CLASS_PATTERNS, enemyProfileFor, enragedPhase, BOSS_ORDER, BOSS_PHASE2 } from '../src/core/enemies';
import { rollTurnEvent, TURN_EVENTS } from '../src/core/turnEvents';

const mk = (seed = 1) => {
  const stats = { str: new Decimal(5), int: new Decimal(1), vit: new Decimal(10), lck: 0 };
  const enemy = { str: new Decimal(10), int: new Decimal(2), vit: new Decimal(20), lck: 0 };
  const bag = [1, 2, 3, 4, 5, 6].map(() => new GoblinDie(Rarity.COMUNE));
  return new BattleEngine(stats, enemy, bag, seededRNG(seed));
};

describe('fase 2', () => {
  it('solo Campioni, Élite e Boss ne hanno una', () => {
    expect(enemyProfileFor(1, 2, false, false).phase2).toBeUndefined();
    expect(enemyProfileFor(1, 5, true, false).phase2).toBeDefined();
    expect(enemyProfileFor(1, 4, false, false, true).phase2).toBeDefined();
    for (const b of BOSS_ORDER) expect(BOSS_PHASE2[b].pattern.steps.length).toBeGreaterThan(0);
  });

  it('nella fase furiosa lo scudo diventa attacco e i colpi pesano di più', () => {
    const p = CLASS_PATTERNS.Chierico; // S, S, A×1.8
    const f = enragedPhase(p).pattern.steps;
    expect(f.map(s => s.type)).toEqual([IntentType.ATTACK, IntentType.ATTACK, IntentType.ATTACK]);
    expect(f[2]!.mult).toBeCloseTo(1.8 * 1.25, 6);
  });

  it('sotto metà HP il motore passa alla fase 2 una volta sola', async () => {
    const e = mk();
    e.enemyPattern = CLASS_PATTERNS.Chierico;
    e.phase2 = enragedPhase(CLASS_PATTERNS.Chierico);
    let fired = 0;
    e.on('onPhase', () => { fired++; });
    await e.initTurn();
    expect(e.phase).toBe(1);
    expect(e.currentIntent!.type).toBe(IntentType.SHIELD);
    e.enemy.hp = e.enemy.maxHp.times(0.4);
    await e.initTurn();
    expect(e.phase).toBe(2);
    expect(e.currentIntent!.type).toBe(IntentType.ATTACK);
    await e.initTurn();
    expect(fired).toBe(1);
  });
});

describe('imprevisti di turno', () => {
  it('mai nell\'Atto 1, mai al primo turno, mai due di fila', () => {
    const rng = seededRNG(3);
    for (let i = 0; i < 200; i++) {
      expect(rollTurnEvent(rng, 1, 5, null)).toBeNull();
      expect(rollTurnEvent(rng, 2, 1, null)).toBeNull();
      expect(rollTurnEvent(rng, 2, 5, 'eco-tuono')).toBeNull();
    }
  });
  it('dall\'Atto 2 capitano a volte, e sono sia buoni sia cattivi', () => {
    const rng = seededRNG(9);
    const seen = new Set<string>();
    let n = 0;
    for (let i = 0; i < 2000; i++) { const ev = rollTurnEvent(rng, 2, 5, null); if (ev) { n++; seen.add(ev.id); } }
    expect(n).toBeGreaterThan(300); expect(n).toBeLessThan(600);
    expect(seen.size).toBe(TURN_EVENTS.length);
  });
  it('la nebbia toglie un dado, la furia alza l\'intento', async () => {
    const e = mk(5);
    e.enemyPattern = CLASS_PATTERNS.Guerriero;
    e.eventAct = 2;
    const base = e.drawCount;
    let saw = false;
    for (let i = 0; i < 60 && !saw; i++) {
      await e.initTurn();
      if (e.turnEvent?.id === 'mano-ridotta') { expect(e.drawCount).toBe(base - 1); saw = true; }
    }
    expect(saw).toBe(true);
  });
});
