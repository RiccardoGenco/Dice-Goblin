import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { summarizeChain, multTier, magnitudeOf } from '../src/core/chain';
import { FaceType } from '../src/core/types';

const f = (type: FaceType, v: number) => ({ type, value: new Decimal(v) });

describe('Riepilogo catena (UI)', () => {
  it('moltiplica solo le facce MULTIPLIER (crescita esponenziale)', () => {
    const s = summarizeChain([f(FaceType.MULTIPLIER, 2), f(FaceType.MULTIPLIER, 3), f(FaceType.NORMAL, 9)]);
    expect(s.multProduct.toNumber()).toBe(6);
    expect(s.multCount).toBe(2);
  });

  it('senza moltiplicatori il prodotto è 1 e il tier è 0', () => {
    const s = summarizeChain([f(FaceType.NORMAL, 4), f(FaceType.BUFF_STR, 2), f(FaceType.RECURSIVE, 1)]);
    expect(s.multProduct.toNumber()).toBe(1);
    expect(s.buffCount).toBe(1);
    expect(s.recursiveCount).toBe(1);
    expect(multTier(s.multProduct)).toBe(0);
  });

  it('k facce ×2 valgono 2^k e il tier cresce con il prodotto', () => {
    const faces = Array.from({ length: 7 }, () => f(FaceType.MULTIPLIER, 2));
    const s = summarizeChain(faces);
    expect(s.multProduct.toNumber()).toBe(128);
    expect(multTier(new Decimal(2))).toBe(1);
    expect(multTier(new Decimal(8))).toBe(2);
    expect(multTier(new Decimal(50))).toBe(3);
    expect(multTier(s.multProduct)).toBe(4);
  });

  it('magnitudeOf è sicuro con zero e valori enormi', () => {
    expect(magnitudeOf(new Decimal(0))).toBe(0);
    expect(magnitudeOf(new Decimal(1000))).toBeCloseTo(3, 5);
    expect(Number.isFinite(magnitudeOf(new Decimal('1e300')))).toBe(true);
  });
});
