import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { BattleEngine, scaleEnemyHp, scaleShopCost } from '../src/core/BattleEngine';
import { GoblinDie } from '../src/core/GoblinDie';
import {
  BALANCE,
  BattleState,
  CombatantStats,
  FaceType,
  Rarity,
  seededRNG
} from '../src/core/types';
import { hydrateCombatantStats, serializeDecimal, hydrateDecimal } from '../src/core/persistence';

const stats = (str = 10, vit = 10): CombatantStats => ({
  str: new Decimal(str),
  int: new Decimal(1),
  vit: new Decimal(vit),
  lck: 0
});

/** Dado "maligno": tutte le facce RECURSIVE per forzare la catena infinita */
const recursiveDie = () =>
  new GoblinDie(
    Rarity.COMUNE,
    Array.from({ length: 6 }, () => ({
      value: new Decimal(1),
      type: FaceType.RECURSIVE
    })),
    seededRNG(42)
  );

describe('Dopamine Cap — protezione anti-loop (GDD §3.3)', () => {
  it('tronca la catena ricorsiva esattamente a MAX_CHAIN dadi', async () => {
    const engine = new BattleEngine(stats(), stats(10, 1e9), [recursiveDie()], seededRNG(7));

    let rolledFaces = 0;
    let overflowFired = false;
    engine.on('onDicesRolled', p => {
      rolledFaces = (p.dices as unknown[]).length;
    });
    engine.on('onOverflowTriggered', () => {
      overflowFired = true;
    });

    await engine.initTurn();

    expect(rolledFaces).toBe(BALANCE.MAX_CHAIN); // 30, non uno di più
    expect(overflowFired).toBe(true);
    expect(engine.state).toBe(BattleState.WAIT_PLAYER_ACTION);
  });

  it("all'overflow applica il moltiplicatore 1.5^pendenti al danno", async () => {
    const engine = new BattleEngine(stats(), stats(10, 1e30), [recursiveDie()], seededRNG(7));
    let dealt = new Decimal(0);
    engine.on('onDamageDealt', p => {
      dealt = p.amount as Decimal;
    });

    await engine.initTurn();
    const { SkillId } = await import('../src/core/types');
    await engine.resolvePlayerAction(SkillId.SGANCIO_BRUTALE);

    // Base senza overflow: STR 10 * skillMod 1.5 = 15 (facce tutte RECURSIVE)
    // Con overflow: 15 * 1.5^pendenti > 15
    expect(dealt.gt(15)).toBe(true);
  });
});

describe('Visual Blocking Callback (GDD §5)', () => {
  it('la logica attende la Promise della UI prima di avanzare', async () => {
    const engine = new BattleEngine(stats(), stats(), [new GoblinDie(Rarity.COMUNE)], seededRNG(1));
    const order: string[] = [];

    engine.on('onDicesRolled', p => {
      p.waitUntilFinished = () =>
        new Promise(res =>
          setTimeout(() => {
            order.push('animazione-finita');
            res();
          }, 10)
        );
    });
    engine.on('onStateChanged', p => {
      if (p.state === BattleState.WAIT_PLAYER_ACTION) order.push('wait-player');
    });

    await engine.initTurn();
    expect(order).toEqual(['animazione-finita', 'wait-player']);
  });
});

describe('Curve di progressione esponenziale (GDD §4.2)', () => {
  it('HP nemici: base * 1.6^level', () => {
    expect(scaleEnemyHp(new Decimal(100), 10).toNumber()).toBeCloseTo(100 * 1.6 ** 10);
  });
  it('costi shop crescono più lentamente degli HP (1.5 < 1.6)', () => {
    const hp = scaleEnemyHp(new Decimal(100), 50);
    const cost = scaleShopCost(new Decimal(100), 50);
    expect(hp.gt(cost)).toBe(true);
  });
});

describe('Persistence — hydration Decimal (GDD §2.2)', () => {
  it('round-trip stringa -> Decimal senza perdita', () => {
    const original = new Decimal('1.5e400');
    const restored = hydrateDecimal(serializeDecimal(original));
    expect(restored.eq(original)).toBe(true);
  });
  it('ripristina mantissa/exponent grezzi da JSON.parse', () => {
    const raw = JSON.parse(JSON.stringify({ str: new Decimal(42), lck: 50 }));
    const restored = hydrateCombatantStats(raw);
    expect(restored.str.eq(42)).toBe(true);
    expect(typeof restored.str.plus).toBe('function'); // il prototipo è tornato
    expect(restored.lck).toBe(50);
  });
});
