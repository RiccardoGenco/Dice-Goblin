import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { BattleEngine } from '../src/core/BattleEngine';
import { GoblinDie } from '../src/core/GoblinDie';
import { COMBOS, detectCombo } from '../src/core/combos';
import { SKILLS } from '../src/core/skills';
import { BALANCE, BattleState, CombatantStats, FaceType, Rarity, SkillId, seededRNG } from '../src/core/types';

const mk = (str = 10, vit = 10): CombatantStats => ({
  str: new Decimal(str), int: new Decimal(1), vit: new Decimal(vit), lck: 0
});
/** dado con facce NORMAL di valore 1..6 (pip = valore) */
const pipDie = (seed = 1) =>
  new GoblinDie(
    Rarity.COMUNE,
    Array.from({ length: 6 }, (_, i) => ({ value: new Decimal(i + 1), type: FaceType.NORMAL })),
    seededRNG(seed)
  );

describe('Combinazioni di dadi', () => {
  it('riconosce le combinazioni e sceglie la più forte', () => {
    expect(detectCombo([1, 2, 3, 4, 5]).id).toBe('straight');
    expect(detectCombo([1, 2, 3, 4, 6]).id).toBe('short-straight');
    expect(detectCombo([2, 2, 5, 6, 1]).id).toBe('pair');
    expect(detectCombo([2, 2, 5, 5, 1]).id).toBe('two-pair');
    expect(detectCombo([3, 3, 3, 5, 1]).id).toBe('three');
    expect(detectCombo([3, 3, 3, 5, 5]).id).toBe('full');
    expect(detectCombo([4, 4, 4, 4, 1]).id).toBe('four');
    expect(detectCombo([6, 6, 6, 6, 6]).id).toBe('five');
    expect(detectCombo([1, 3, 4, 6, 6]).id).toBe('pair');
    expect(detectCombo([1, 3, 5]).id).toBe('none');
    expect(detectCombo([]).id).toBe('none');
  });

  it('i moltiplicatori crescono con la rarità della combinazione', () => {
    expect(COMBOS.pair.mult).toBeLessThan(COMBOS['two-pair'].mult);
    expect(COMBOS['two-pair'].mult).toBeLessThan(COMBOS.three.mult);
    expect(COMBOS.three.mult).toBeLessThan(COMBOS.full.mult);
    expect(COMBOS.full.mult).toBeLessThan(COMBOS.five.mult);
  });
});

describe('Rilanci gratuiti', () => {
  const bag = () => [pipDie(1), pipDie(2), pipDie(3), pipDie(4), pipDie(5)];

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
    expect(engine.player.stats.str.toNumber()).toBe(15); // sempre una sola faccia in gioco
  });

  it('con una combinazione il danno cresce; Colpo Combo la conta al quadrato', async () => {
    // cinque dadi identici con facce tutte uguali: Cinque uguali (x6)
    const same = () => new GoblinDie(
      Rarity.COMUNE,
      Array.from({ length: 6 }, () => ({ value: new Decimal(2), type: FaceType.NORMAL })),
      seededRNG(1)
    );
    // pip diversi per faccia: pip = posizione, quindi l'uguaglianza dipende dalla faccia uscita;
    // usiamo dadi a 1 faccia utile ripetendo la stessa riga di pip forzando il seed
    const engine: any = new BattleEngine(mk(0), mk(10, 1e9), [same(), same(), same(), same(), same()], seededRNG(3));
    await engine.initTurn();
    const combo = engine.getCombo();
    const plain = engine.calcDamage(new Decimal(1), 1);
    const squared = engine.calcDamage(new Decimal(1), 2);
    // flat = 5 dadi x 2 = 10; il rapporto tra le due potenze è la combinazione stessa
    expect(plain.toNumber()).toBeCloseTo(10 * combo.mult.toNumber(), 5);
    expect(squared.toNumber()).toBeCloseTo(10 * combo.mult.pow(2).toNumber(), 5);
    expect(SKILLS[SkillId.COLPO_COMBO].comboPower).toBe(2);
  });
});
