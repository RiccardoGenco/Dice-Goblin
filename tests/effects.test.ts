import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { BattleEngine } from '../src/core/BattleEngine';
import { GoblinDie } from '../src/core/GoblinDie';
import { Forge } from '../src/core/Forge';
import { summarizeEffects } from '../src/core/effects';
import { hydrateDie, serializeDie } from '../src/core/SaveManager';
import { CombatantStats, DieFace, FaceEffect, FaceType, Rarity, SkillId, seededRNG } from '../src/core/types';

const mk = (str = 10, vit = 10): CombatantStats => ({
  str: new Decimal(str), int: new Decimal(1), vit: new Decimal(vit), lck: 0
});
const face = (value: number, effect?: FaceEffect): DieFace =>
  ({ value: new Decimal(value), type: FaceType.NORMAL, effect });
/** dado con TUTTE le facce uguali: il lancio è deterministico */
const uniform = (value: number, effect?: FaceEffect) =>
  new GoblinDie(Rarity.COMUNE, Array.from({ length: 6 }, () => face(value, effect)), seededRNG(1));

describe('Effetti delle facce', () => {
  it('somma gli effetti e ricava le reazioni', () => {
    const s = summarizeEffects([face(4, 'veleno'), face(6, 'veleno'), face(5, 'fuoco'), face(3)]);
    expect(s.poison.toNumber()).toBe(10);
    expect(s.fire.toNumber()).toBe(10); // 5 x2
    expect(s.shield.toNumber()).toBe(0);
    expect(s.reactions.map(r => r.id)).toEqual(['vapori']);
  });

  it('tre effetti insieme fanno scattare tutte e tre le reazioni', () => {
    const s = summarizeEffects([face(1, 'veleno'), face(1, 'scudo'), face(1, 'fuoco')]);
    expect(s.reactions.map(r => r.id).sort()).toEqual(['scudo-ardente', 'spore', 'vapori']);
  });

  it('senza effetti niente reazioni', () => {
    expect(summarizeEffects([face(5), face(2)]).reactions).toEqual([]);
  });

  it('veleno, scudo e fuoco agiscono alla risoluzione', async () => {
    const bag = [uniform(5, 'veleno'), uniform(4, 'scudo'), uniform(3, 'fuoco')];
    const engine = new BattleEngine(mk(0), mk(1, 1e9), bag, seededRNG(1));
    await engine.initTurn();
    const hp0 = engine.enemy.hp;
    await engine.resolvePlayerAction(SkillId.SCUDO_GOBLIN); // il danno delle facce diventa scudo
    // fuoco: 3 x2 = 6 diretto; vapori: tick del veleno (5); scudo ardente: 4
    expect(hp0.minus(engine.enemy.hp).toNumber()).toBeGreaterThanOrEqual(6 + 5 + 4);
    expect(engine.enemy.poison.perTurn.toNumber()).toBe(5);
    // spore: 3 turni base + 2 (il tick del nuovo turno ne ha già consumato 1)
    expect(engine.enemy.poison.turnsLeft).toBe(3 + 2 - 1);
  });

  it('il fuoco ignora lo scudo nemico', async () => {
    const engine = new BattleEngine(mk(0), mk(1, 1e9), [uniform(10, 'fuoco')], seededRNG(1));
    await engine.initTurn();
    engine.enemy.shield = new Decimal(1e6);
    const hp0 = engine.enemy.hp;
    await engine.resolvePlayerAction(SkillId.SGANCIO_BRUTALE);
    expect(hp0.minus(engine.enemy.hp).toNumber()).toBeGreaterThanOrEqual(20);
  });
});

describe('Forgia: Incanto e salvataggio', () => {
  const ctx = { level: 0, purchases: 0, special: false };

  it('incanta una faccia NORMALE e rifiuta le altre', () => {
    const forge = new Forge();
    const bag = [uniform(5)];
    expect(forge.quote({ kind: 'incanto', dieIndex: 0, faceIndex: 0, effect: 'fuoco' }, bag, ctx).ok).toBe(true);
    forge.apply({ kind: 'incanto', dieIndex: 0, faceIndex: 0, effect: 'fuoco' }, bag);
    expect(bag[0]!.faces[0]!.effect).toBe('fuoco');
    expect(forge.quote({ kind: 'incanto', dieIndex: 0, faceIndex: 0, effect: 'fuoco' }, bag, ctx).ok).toBe(false);
    bag[0]!.faces[1]!.type = FaceType.MULTIPLIER;
    expect(forge.quote({ kind: 'incanto', dieIndex: 0, faceIndex: 1, effect: 'veleno' }, bag, ctx).ok).toBe(false);
  });

  it('la trasmutazione toglie l\'incanto', () => {
    const forge = new Forge();
    const bag = [uniform(5, 'scudo')];
    forge.apply({ kind: 'trasmutazione', dieIndex: 0, faceIndex: 0, target: FaceType.MULTIPLIER }, bag);
    expect(bag[0]!.faces[0]!.effect).toBeUndefined();
  });

  it('gli effetti sopravvivono al salvataggio', () => {
    const die = uniform(5);
    die.faces[2]!.effect = 'veleno';
    const back = hydrateDie(JSON.parse(JSON.stringify(serializeDie(die))));
    expect(back.faces[2]!.effect).toBe('veleno');
    expect(back.faces[0]!.effect).toBeUndefined();
  });
});
