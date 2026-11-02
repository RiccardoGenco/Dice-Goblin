import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { BattleEngine } from '../src/core/BattleEngine';
import { GoblinDie } from '../src/core/GoblinDie';
import {
  BattleState, CombatantStats, DieFace, FaceType, IntentType, Rarity, SkillId, seededRNG
} from '../src/core/types';

const mk = (str = 10, vit = 10, int = 1): CombatantStats => ({
  str: new Decimal(str), int: new Decimal(int), vit: new Decimal(vit), lck: 0
});
const face = (value: number): DieFace => ({ value: new Decimal(value), type: FaceType.NORMAL });
const uniform = (value: number) =>
  new GoblinDie(Rarity.COMUNE, Array.from({ length: 6 }, () => face(value)), seededRNG(1));

/** Nemico che non muore mai e al turno dopo fa l'intento dato */
async function setup(intent: IntentType, value = 40, vit = 1e9) {
  const engine = new BattleEngine(mk(0), mk(10, vit), [uniform(10), uniform(10)], seededRNG(3));
  await engine.initTurn();
  engine.currentIntent = { type: intent, value: new Decimal(value) };
  return engine;
}

describe('Azioni di combattimento', () => {
  it('Sgancio Brutale infligge ×1.5 e Bava nessun danno diretto', async () => {
    const a = await setup(IntentType.SHIELD);
    const base = a.calcDamage(new Decimal(1));
    const hp0 = a.enemy.hp;
    await a.resolvePlayerAction(SkillId.SGANCIO_BRUTALE);
    expect(hp0.minus(a.enemy.hp).toNumber()).toBeCloseTo(base.times(1.5).toNumber(), 5);

    const b = await setup(IntentType.SHIELD);
    const hpB = b.enemy.hp;
    const dmg = b.calcDamage(new Decimal(1));
    await b.resolvePlayerAction(SkillId.BAVA);
    // il primo tick del veleno arriva all'inizio del nuovo turno
    expect(hpB.minus(b.enemy.hp).toNumber()).toBeCloseTo(dmg.times(0.6).toNumber(), 5);
    expect(b.enemy.poison.turnsLeft).toBe(2);
  });

  it('Bava ignora lo scudo del nemico', async () => {
    const engine = await setup(IntentType.SHIELD);
    engine.enemy.shield = new Decimal(1e6);
    const hp0 = engine.enemy.hp;
    await engine.resolvePlayerAction(SkillId.BAVA);
    expect(hp0.minus(engine.enemy.hp).gt(0)).toBe(true);
  });

  it('Parata: lo scudo assorbe l\'attacco e il 50% rimbalza sul nemico', async () => {
    const engine = await setup(IntentType.ATTACK, 40);
    const shield = engine.calcDamage(new Decimal(1)); // 20 (10+10, str 0)
    const hpP = engine.player.hp;
    const hpE = engine.enemy.hp;
    await engine.resolvePlayerAction(SkillId.PARATA);
    const blocked = Decimal.min(shield, new Decimal(40));
    expect(engine.player.hp.toNumber()).toBe(hpP.minus(new Decimal(40).minus(blocked)).toNumber());
    expect(hpE.minus(engine.enemy.hp).toNumber()).toBeCloseTo(blocked.times(0.5).toNumber(), 5);
  });

  it('Parata non rimbalza se il nemico non attacca', async () => {
    const engine = await setup(IntentType.SHIELD);
    const hpE = engine.enemy.hp;
    await engine.resolvePlayerAction(SkillId.PARATA);
    expect(engine.enemy.hp.toNumber()).toBe(hpE.toNumber());
  });

  it('Carica: nessun danno, il nemico colpisce e le facce restano nel turno dopo', async () => {
    const engine = await setup(IntentType.ATTACK, 40);
    const before = engine.calcDamage(new Decimal(1));
    const hpP = engine.player.hp;
    const hpE = engine.enemy.hp;
    await engine.resolvePlayerAction(SkillId.CARICA);
    expect(engine.state).toBe(BattleState.WAIT_PLAYER_ACTION);
    expect(engine.enemy.hp.toNumber()).toBe(hpE.toNumber());
    expect(engine.player.hp.toNumber()).toBe(hpP.minus(40).toNumber());
    // 2 facce tenute + 2 dadi pescati: 4 carte, se ne giocano 3, col bonus della Carica
    expect(engine.charged).toBe(true);
    expect(engine.cards).toHaveLength(4);
    expect(engine.playedFaces).toHaveLength(3);
    expect(engine.calcDamage(new Decimal(1)).toNumber()).toBeGreaterThanOrEqual(before.times(1.5).toNumber());
    await engine.resolvePlayerAction(SkillId.SGANCIO_BRUTALE);
    expect(engine.charged).toBe(false); // il bonus vale per un solo lancio
  });

  it('Carica non applica gli effetti di faccia finché non le usi', async () => {
    const fx = new GoblinDie(Rarity.COMUNE, Array.from({ length: 6 }, () => ({
      value: new Decimal(5), type: FaceType.NORMAL, effect: 'veleno' as const
    })), seededRNG(1));
    const engine = new BattleEngine(mk(0), mk(10, 1e9), [fx], seededRNG(3));
    await engine.initTurn();
    await engine.resolvePlayerAction(SkillId.CARICA);
    expect(engine.enemy.poison.turnsLeft).toBe(0);
    expect(engine.getEffects().poison.toNumber()).toBe(10); // 2 facce veleno
  });
});
