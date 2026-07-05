import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { Forge, ForgeContext, MAX_SPECIAL_FACES, specialFaceCount } from '../src/core/Forge';
import { GoblinDie } from '../src/core/GoblinDie';
import { DieFace, FaceType, Rarity } from '../src/core/types';

const ctx = (special = false, level = 0): ForgeContext => ({ level, purchases: 0, special });
const forge = () => new Forge();

const face = (value: number, type: FaceType): DieFace => ({ value: new Decimal(value), type });

/** Dado con facce esplicite per test deterministici */
const die = (faces: DieFace[], rarity = Rarity.COMUNE) => new GoblinDie(rarity, faces);

describe('Forge — Tempra', () => {
  it('NORMAL ×1.5 (floor) e MULTIPLIER +0.5', () => {
    const f = forge();
    const bag = [die([face(7, FaceType.NORMAL), face(2, FaceType.MULTIPLIER),
      face(1, FaceType.NORMAL), face(2, FaceType.NORMAL), face(3, FaceType.NORMAL), face(4, FaceType.NORMAL)])];

    expect(f.quote({ kind: 'tempra', dieIndex: 0, faceIndex: 0 }, bag, ctx()).ok).toBe(true);
    f.apply({ kind: 'tempra', dieIndex: 0, faceIndex: 0 }, bag);
    expect(bag[0]!.faces[0]!.value.toNumber()).toBe(10); // floor(7*1.5)

    f.apply({ kind: 'tempra', dieIndex: 0, faceIndex: 1 }, bag);
    expect(bag[0]!.faces[1]!.value.toNumber()).toBeCloseTo(2.5, 6);
  });

  it('rifiuta la tempra sulle facce ricorsive', () => {
    const f = forge();
    const bag = [die([face(1, FaceType.RECURSIVE), ...Array(5).fill(face(1, FaceType.NORMAL))])];
    const q = f.quote({ kind: 'tempra', dieIndex: 0, faceIndex: 0 }, bag, ctx());
    expect(q.ok).toBe(false);
  });
});

describe('Forge — Trasmutazione (il guardrail dell\'esponenziale)', () => {
  it('trasmuta solo facce NORMALI e applica il valore iniziale', () => {
    const f = forge();
    const bag = [die(Array(6).fill(0).map(() => face(5, FaceType.NORMAL)))];
    const op = { kind: 'trasmutazione' as const, dieIndex: 0, faceIndex: 0, target: FaceType.MULTIPLIER };
    expect(f.quote(op, bag, ctx()).ok).toBe(true);
    f.apply(op, bag);
    expect(bag[0]!.faces[0]!.type).toBe(FaceType.MULTIPLIER);
    expect(bag[0]!.faces[0]!.value.toNumber()).toBe(1.5);

    // Una faccia già speciale non è ritrasmutabile
    expect(f.quote(op, bag, ctx()).ok).toBe(false);
  });

  it(`CAP: mai più di ${MAX_SPECIAL_FACES} facce speciali per dado`, () => {
    const f = forge();
    const bag = [die(Array(6).fill(0).map(() => face(5, FaceType.NORMAL)))];
    for (let i = 0; i < MAX_SPECIAL_FACES; i++) {
      const op = { kind: 'trasmutazione' as const, dieIndex: 0, faceIndex: i, target: FaceType.MULTIPLIER };
      expect(f.quote(op, bag, ctx()).ok).toBe(true);
      f.apply(op, bag);
    }
    expect(specialFaceCount(bag[0]!)).toBe(MAX_SPECIAL_FACES);
    // La quarta trasmutazione è RIFIUTATA
    const fourth = { kind: 'trasmutazione' as const, dieIndex: 0, faceIndex: 3, target: FaceType.RECURSIVE };
    const q = f.quote(fourth, bag, ctx());
    expect(q.ok).toBe(false);
    expect(q.reason).toContain('Cap');
  });
});

describe('Forge — Fusione (qualità in cambio di quantità)', () => {
  it('il target eredita la faccia migliore al posto della peggiore, sale di rarità e la borsa perde un dado', () => {
    const f = forge();
    const sacrifice = die([face(3, FaceType.MULTIPLIER), ...Array(5).fill(face(1, FaceType.NORMAL))]);
    const target = die([face(1, FaceType.NORMAL), face(10, FaceType.NORMAL),
      ...Array(4).fill(face(5, FaceType.NORMAL))], Rarity.RARO);
    const bag = [target, sacrifice];

    const op = { kind: 'fusione' as const, targetIndex: 0, sacrificeIndex: 1 };
    expect(f.quote(op, bag, ctx()).ok).toBe(true);
    f.apply(op, bag);

    expect(bag.length).toBe(1); // il sacrificato è sparito
    expect(bag[0]!.rarity).toBe(Rarity.EPICO); // RARO + 1
    // La faccia peggiore (1) è stata sostituita dalla ×3
    expect(bag[0]!.faces.some(fc => fc.type === FaceType.MULTIPLIER && fc.value.eq(3))).toBe(true);
    expect(bag[0]!.faces.filter(fc => fc.value.eq(1) && fc.type === FaceType.NORMAL).length).toBe(0);
  });

  it('rifiuta la fusione che sfonderebbe il cap di facce speciali', () => {
    const f = forge();
    const sacrifice = die([face(2, FaceType.MULTIPLIER), ...Array(5).fill(face(1, FaceType.NORMAL))]);
    // Target già al cap: 3 speciali + 3 normali
    const target = die([
      face(2, FaceType.MULTIPLIER), face(2, FaceType.MULTIPLIER), face(1, FaceType.RECURSIVE),
      face(5, FaceType.NORMAL), face(6, FaceType.NORMAL), face(7, FaceType.NORMAL)
    ]);
    const bag = [target, sacrifice];
    const q = f.quote({ kind: 'fusione', targetIndex: 0, sacrificeIndex: 1 }, bag, ctx());
    expect(q.ok).toBe(false); // peggiore = NORMAL 5, ereditata = MULT -> 4 speciali
  });
});

describe('Forge — Riforgiatura (esclusiva Gran Forgia)', () => {
  it('rifiutata nella forgia normale, ×1.25 su tutte le NORMALI in quella speciale', () => {
    const f = forge();
    const bag = [die([face(8, FaceType.NORMAL), face(2, FaceType.MULTIPLIER),
      face(4, FaceType.NORMAL), face(100, FaceType.NORMAL), face(1, FaceType.NORMAL), face(1, FaceType.NORMAL)])];
    const op = { kind: 'riforgiatura' as const, dieIndex: 0 };

    expect(f.quote(op, bag, ctx(false)).ok).toBe(false);
    expect(f.quote(op, bag, ctx(true)).ok).toBe(true);

    f.apply(op, bag);
    expect(bag[0]!.faces[0]!.value.toNumber()).toBe(10);  // floor(8*1.25)
    expect(bag[0]!.faces[3]!.value.toNumber()).toBe(125);
    expect(bag[0]!.faces[1]!.value.toNumber()).toBe(2);   // la MULT non si tocca
  });
});

describe('Forge — Costi sulla curva della run', () => {
  it('i costi crescono di 1.5^level e la Gran Forgia dimezza la Trasmutazione', () => {
    const f = forge();
    const c0 = f.cost('tempra', ctx(false, 0));
    const c6 = f.cost('tempra', ctx(false, 6));
    expect(c6.div(c0).toNumber()).toBeGreaterThan(1.5 ** 5);

    const normal = f.cost('trasmutazione', ctx(false, 3));
    const gran = f.cost('trasmutazione', ctx(true, 3));
    expect(gran.toNumber()).toBe(Math.floor(normal.toNumber() / 2));
  });
});
