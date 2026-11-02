import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { BattleEngine } from '../src/core/BattleEngine';
import { GoblinDie } from '../src/core/GoblinDie';
import { BALANCE, BattleState, CombatantStats, FaceType, Rarity, SkillId, seededRNG } from '../src/core/types';

const mk = (str = 10, vit = 10): CombatantStats => ({
  str: new Decimal(str), int: new Decimal(1), vit: new Decimal(vit), lck: 0
});
const uniform = (v: number) =>
  new GoblinDie(Rarity.COMUNE, Array.from({ length: 6 }, () => ({ value: new Decimal(v), type: FaceType.NORMAL })), seededRNG(1));
const bagOf = (values: number[]) => values.map(uniform);

describe('La mano di dadi', () => {
  it('pesca fino a HAND_DRAW dadi diversi e ne fa giocare HAND_PLAY', async () => {
    const e = new BattleEngine(mk(), mk(10, 1e9), bagOf([1, 2, 3, 4, 5, 6, 7, 8]), seededRNG(2));
    await e.initTurn();
    expect(e.state).toBe(BattleState.WAIT_PLAYER_ACTION);
    expect(e.cards).toHaveLength(BALANCE.HAND_DRAW);
    expect(e.selection).toHaveLength(BALANCE.HAND_PLAY);
    const sources = e.cards.map(c => (e as any).lastRoll.sources[c]);
    expect(new Set(sources).size).toBe(sources.length); // nessun dado ripetuto
  });

  it('con una borsa piccola pesca tutto quello che ha', async () => {
    const e = new BattleEngine(mk(), mk(10, 1e9), bagOf([5, 5]), seededRNG(2));
    await e.initTurn();
    expect(e.cards).toHaveLength(2);
    expect(e.selection).toHaveLength(2);
  });

  it('la scelta di partenza è la mano che fa più danno', async () => {
    const e = new BattleEngine(mk(0), mk(10, 1e9), bagOf([1, 2, 30, 4, 50]), seededRNG(2));
    await e.initTurn();
    expect(e.calcDamage(new Decimal(1)).toNumber()).toBe(30 + 50 + 4);
  });

  it('si può cambiare mano, entro gli slot e mai a zero dadi', async () => {
    const e = new BattleEngine(mk(0), mk(10, 1e9), bagOf([1, 2, 30, 4, 50]), seededRNG(2));
    await e.initTurn();
    const out = e.cards.filter(c => !e.selection.includes(c));
    expect(e.toggleCard(out[0]!)).toBe(false);            // slot pieni
    const inn = e.selection[0]!;
    expect(e.toggleCard(inn)).toBe(true);
    expect(e.toggleCard(out[0]!)).toBe(true);
    expect(e.selection).toHaveLength(BALANCE.HAND_PLAY);
    expect(e.setSelection([])).toBe(false);
    expect(e.setSelection(e.cards)).toBe(false);          // più degli slot
    expect(e.setSelection([e.cards[0]!])).toBe(true);
    expect(e.selection).toHaveLength(1);
  });

  it('il danno dipende solo dai dadi giocati', async () => {
    const e = new BattleEngine(mk(0), mk(10, 1e9), bagOf([10, 10, 10, 1000, 1000]), seededRNG(2));
    await e.initTurn();
    const cheap = e.cards.filter(c => (e as any).lastRoll.faces[c].value.toNumber() === 10);
    e.setSelection(cheap);
    const hp0 = e.enemy.hp;
    await e.resolvePlayerAction(SkillId.SGANCIO_BRUTALE);
    expect(hp0.minus(e.enemy.hp).toNumber()).toBeCloseTo(30 * 1.5, 5);
  });

  it('le azioni non sono ammesse fuori dalla fase di scelta', async () => {
    const e = new BattleEngine(mk(), mk(10, 1e9), bagOf([5, 5]), seededRNG(2));
    expect(e.toggleCard(0)).toBe(false);
  });
});
