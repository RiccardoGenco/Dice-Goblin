import { describe, it, expect } from 'vitest';
import Decimal from 'break_infinity.js';
import { formatFaceValue } from '../src/core/format';
import { faceLabel } from '../src/core/RunLog';
import { FaceType } from '../src/core/types';

const f = (n: number) => formatFaceValue(new Decimal(n));

describe('formatFaceValue', () => {
  it('non arrotonda i valori frazionari', () => {
    expect(f(2.5)).toBe('2.5');
    expect(f(1.25)).toBe('1.25');
    expect(f(3.75)).toBe('3.75');
    expect(f(3)).toBe('3');
  });
  it('compatta le migliaia senza il punto italiano ambiguo', () => {
    expect(f(999)).toBe('999');
    expect(f(1234)).toBe('1.2k');
    expect(f(12345)).toBe('12.3k');
    expect(f(999999)).toBe('1m');
  });
  it('usa la notazione scientifica oltre il milione', () => {
    expect(f(4.5e9)).toBe('4.5e9');
    expect(f(9.999e12)).toBe('1e13');
  });
  it('ogni formato resta entro 7 caratteri', () => {
    for (const n of [0.5, 7.25, 99.99, 100, 999.5, 5000, 88888, 1e6, 7.77e15, 1e100]) {
      expect(f(n).length).toBeLessThanOrEqual(7);
    }
  });
  it('un ×2.5 si legge ×2.5 nel registro', () => {
    expect(faceLabel({ value: new Decimal(2.5), type: FaceType.MULTIPLIER })).toBe('×2.5');
  });
});
