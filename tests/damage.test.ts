import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { DamagePipeline } from '../src/core/DamagePipeline';
import { FaceType, MiddlewarePhase } from '../src/core/types';

describe('DamagePipeline — calcolo moltiplicativo a 3 fasi', () => {
  const pipeline = () => new DamagePipeline();

  it('somma STR e facce NORMAL prima di moltiplicare (ordine Balatro)', () => {
    // (STR 10 + 4 + 6) * x2 * x3 * skillMod 1.5 = 20 * 6 * 1.5 = 180
    const dmg = pipeline().calculateTurnDamage(
      new Decimal(10),
      [
        { value: new Decimal(4), type: FaceType.NORMAL },
        { value: new Decimal(6), type: FaceType.NORMAL },
        { value: new Decimal(2), type: FaceType.MULTIPLIER },
        { value: new Decimal(3), type: FaceType.MULTIPLIER }
      ],
      new Decimal(1.5)
    );
    expect(dmg.toNumber()).toBe(180);
  });

  it('i moltiplicatori si compongono esponenzialmente (2^k)', () => {
    const faces = Array.from({ length: 20 }, () => ({
      value: new Decimal(2),
      type: FaceType.MULTIPLIER
    }));
    const dmg = pipeline().calculateTurnDamage(new Decimal(1), faces, new Decimal(1));
    // break_infinity lavora in mantissa/esponente float: tolleranza epsilon
    expect(dmg.toNumber()).toBeCloseTo(2 ** 20, 5); // ~1_048_576
  });

  it('gestisce numeri oltre il limite dei float nativi', () => {
    const faces = Array.from({ length: 1200 }, () => ({
      value: new Decimal(2),
      type: FaceType.MULTIPLIER
    }));
    const dmg = pipeline().calculateTurnDamage(new Decimal(1), faces, new Decimal(1));
    // 2^1200 ≈ 1.7e361 > 1.79e308: solo Decimal può rappresentarlo.
    // Un number nativo qui sarebbe Infinity.
    expect(dmg.exponent).toBeGreaterThan(308);
    expect(Number.isFinite(dmg.exponent)).toBe(true);
    expect(dmg.gt(new Decimal('1e360'))).toBe(true);
  });
});

describe('DamagePipeline — ordinamento rigido dei middleware', () => {
  it('esegue PRE_ADD -> ADD -> MULT -> POST_MULT a prescindere dalla registrazione', () => {
    const p = new DamagePipeline();
    const order: string[] = [];

    // Registrazione volutamente in ordine inverso
    p.register(MiddlewarePhase.POST_MULT, pl => (order.push('POST_MULT'), pl));
    p.register(MiddlewarePhase.MULT, pl => (order.push('MULT'), pl));
    p.register(MiddlewarePhase.ADD, pl => (order.push('ADD'), pl));
    p.register(MiddlewarePhase.PRE_ADD, pl => (order.push('PRE_ADD'), pl));

    p.calculateTurnDamage(new Decimal(1), [], new Decimal(1));
    expect(order).toEqual(['PRE_ADD', 'ADD', 'MULT', 'POST_MULT']);
  });

  it("l'ordine di equip non altera il danno finale (determinismo)", () => {
    const run = (registerFlatFirst: boolean) => {
      const p = new DamagePipeline();
      const flat = (pl: any) => ({ ...pl, flatAdded: pl.flatAdded.plus(10) });
      const mult = (pl: any) => ({ ...pl, multiplier: pl.multiplier.times(2) });
      if (registerFlatFirst) {
        p.register(MiddlewarePhase.PRE_ADD, flat);
        p.register(MiddlewarePhase.MULT, mult);
      } else {
        p.register(MiddlewarePhase.MULT, mult);
        p.register(MiddlewarePhase.PRE_ADD, flat);
      }
      return p.calculateTurnDamage(new Decimal(5), [], new Decimal(1)).toNumber();
    };
    // (5 + 10) * 2 = 30 in entrambi i casi
    expect(run(true)).toBe(30);
    expect(run(false)).toBe(30);
  });
});
