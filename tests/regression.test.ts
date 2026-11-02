import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { BattleEngine } from '../src/core/BattleEngine';
import { GoblinDie } from '../src/core/GoblinDie';
import { BattleState, CombatantStats, FaceType, Rarity, SkillId, seededRNG } from '../src/core/types';

const mk = (str = 10, vit = 10, lck = 0): CombatantStats => ({
  str: new Decimal(str), int: new Decimal(1), vit: new Decimal(vit), lck
});
const uniformDie = (type: FaceType, value: number) =>
  new GoblinDie(
    Rarity.COMUNE,
    Array.from({ length: 6 }, () => ({ value: new Decimal(value), type })),
    seededRNG(1)
  );

describe('Regressioni dalla revisione di novembre', () => {
  it('BUFF_STR vale per la battaglia solo se giocato e NON modifica le stat persistenti', async () => {
    const persistent = mk(10);
    const engine = new BattleEngine(persistent, mk(10, 1e9), [uniformDie(FaceType.BUFF_STR, 5)], seededRNG(3));
    await engine.initTurn();
    expect(engine.player.stats.str.toNumber()).toBe(10);  // non ancora giocato
    expect(engine.calcDamage(new Decimal(1)).toNumber()).toBe(15); // ma l'anteprima lo conta
    await engine.resolvePlayerAction(SkillId.SGANCIO_BRUTALE);
    expect(engine.player.stats.str.toNumber()).toBe(15);  // ora vale per la battaglia
    expect(persistent.str.toNumber()).toBe(10);           // ma non trapela nel salvataggio
  });

  it('i lanci extra della ricorsione seguono la loro carta: in panchina non contano', async () => {
    const engine: any = new BattleEngine(mk(), mk(10, 1e9), [uniformDie(FaceType.RECURSIVE, 1), uniformDie(FaceType.RECURSIVE, 1)], seededRNG(5));
    await engine.initTurn();
    const { faces, sources, rootOf, pendingOf } = engine.lastRoll;
    expect(sources.length).toBe(faces.length);
    expect(engine.cards).toHaveLength(2);                   // solo due carte, il resto sono extra
    expect(engine.playedFaces.length).toBe(faces.length);   // all'inizio giocate tutte
    expect(engine.overflow.active).toBe(true);              // la catena infinita sfonda il tetto
    const [a, b] = engine.cards as number[];
    expect(engine.toggleCard(a!)).toBe(true);               // via la prima carta con la sua catena
    const left = faces.filter((_: unknown, i: number) => rootOf[i] === b).length;
    expect(engine.playedFaces).toHaveLength(left);
    expect(engine.playedFaces.length).toBeLessThan(faces.length);
    // l'overflow si ricalcola solo sui dadi pendenti della carta rimasta
    expect(engine.overflow.mult.toNumber()).toBeCloseTo(Math.pow(1.5, pendingOf[b!]), 6);
    expect(engine.toggleCard(b!)).toBe(false);              // mai zero dadi
    expect(engine.state).toBe(BattleState.WAIT_PLAYER_ACTION);
  });

  it('la Fortuna aiuta ma resta limitata (tetto x2 sul peso delle facce speciali)', () => {
    const faces = [
      { value: new Decimal(2), type: FaceType.MULTIPLIER },
      ...Array.from({ length: 5 }, () => ({ value: new Decimal(3), type: FaceType.NORMAL }))
    ];
    const freq = (lck: number) => {
      const die = new GoblinDie(Rarity.COMUNE, faces, seededRNG(11));
      let n = 0;
      for (let i = 0; i < 20000; i++) if (die.roll(lck).type === FaceType.MULTIPLIER) n++;
      return n / 20000;
    };
    const p0 = freq(0), p10 = freq(10), p1000 = freq(1000);
    expect(p10).toBeGreaterThan(p0);        // la Fortuna ha un effetto
    expect(p10).toBeLessThan(0.09);         // ma non porta al 35% come col bug
    expect(p1000).toBeLessThan(0.1);        // e ha un tetto
  });
});
