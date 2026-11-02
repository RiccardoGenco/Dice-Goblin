import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { BattleEngine } from '../src/core/BattleEngine';
import { GoblinDie } from '../src/core/GoblinDie';
import { BALANCE, BattleState, CombatantStats, FaceType, Rarity, SkillId, seededRNG } from '../src/core/types';

const mk = (str = 10, vit = 10): CombatantStats => ({
  str: new Decimal(str), int: new Decimal(1), vit: new Decimal(vit), lck: 0
});
const die = (seed = 1) =>
  new GoblinDie(
    Rarity.COMUNE,
    Array.from({ length: 6 }, (_, i) => ({ value: new Decimal(i + 1), type: FaceType.NORMAL })),
    seededRNG(seed)
  );
const bag = () => [die(1), die(2), die(3), die(4), die(5)];

describe('Rilanci gratuiti', () => {
  it('ogni turno dà i rilanci previsti e ognuno ne consuma uno', async () => {
    const engine = new BattleEngine(mk(), mk(10, 1e9), bag(), seededRNG(9));
    await engine.initTurn();
    expect(engine.state).toBe(BattleState.WAIT_PLAYER_ACTION);
    expect(engine.rerolls).toBe(BALANCE.REROLLS_PER_TURN);
    expect(engine.rerollSelected([0, 1])).toBe(true);
    expect(engine.rerolls).toBe(BALANCE.REROLLS_PER_TURN - 1);
    expect(engine.rerollSelected([2])).toBe(true);
    expect(engine.rerollSelected([3])).toBe(false); // finiti
  });

  it('i dadi non scelti restano identici', async () => {
    const engine: any = new BattleEngine(mk(), mk(10, 1e9), bag(), seededRNG(4));
    await engine.initTurn();
    const before = [...engine.lastRoll.faces];
    engine.rerollSelected([0, 1]);
    for (let i = 2; i < 5; i++) expect(engine.lastRoll.faces[i]).toBe(before[i]);
  });

  it('indici non validi o lista vuota non consumano rilanci', async () => {
    const engine = new BattleEngine(mk(), mk(10, 1e9), bag(), seededRNG(4));
    await engine.initTurn();
    expect(engine.rerollSelected([])).toBe(false);
    expect(engine.rerollSelected([99, -1])).toBe(false);
    expect(engine.rerolls).toBe(BALANCE.REROLLS_PER_TURN);
  });

  it('il rilancio di una faccia BUFF_STR non accumula forza', async () => {
    const buff = new GoblinDie(
      Rarity.COMUNE,
      Array.from({ length: 6 }, () => ({ value: new Decimal(5), type: FaceType.BUFF_STR })),
      seededRNG(1)
    );
    const engine = new BattleEngine(mk(10), mk(10, 1e9), [buff], seededRNG(2));
    await engine.initTurn();
    expect(engine.player.stats.str.toNumber()).toBe(15);
    engine.rerollSelected([0]);
    engine.rerollSelected([0]);
    expect(engine.player.stats.str.toNumber()).toBe(15);
  });

  it('i rilanci si ricaricano ogni turno', async () => {
    const engine = new BattleEngine(mk(), mk(10, 1e9), bag(), seededRNG(6));
    await engine.initTurn();
    await engine.resolvePlayerAction(SkillId.SGANCIO_BRUTALE);
    expect(engine.rerolls).toBe(BALANCE.REROLLS_PER_TURN);
  });
});
