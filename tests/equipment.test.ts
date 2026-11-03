import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { formatBigNumber } from '../src/core/format';
import { EquipmentManager, DEMO_ITEMS, MAX_EQUIPMENT_SLOTS, findItem } from '../src/core/equipment';
import { DamagePipeline } from '../src/core/DamagePipeline';

describe('formatBigNumber (GDD §6.1)', () => {
  it('sotto il milione usa il separatore delle migliaia', () => {
    expect(formatBigNumber(new Decimal(999_999))).toContain('999');
    expect(formatBigNumber(new Decimal(0))).toBe('0');
    expect(formatBigNumber(new Decimal(-5))).toBe('0');
  });
  it('oltre il milione passa a mantissa/esponente compatti', () => {
    expect(formatBigNumber(new Decimal('1.5e42'))).toBe('1.50e42');
    expect(formatBigNumber(new Decimal(2_500_000))).toBe('2.50e6');
  });
});

describe('EquipmentManager — regola dei 5 slot (MVP §4)', () => {
  it('rifiuta il sesto oggetto: la scelta è del giocatore', () => {
    const eq = new EquipmentManager();
    const results = DEMO_ITEMS.map(item => eq.equip(item));
    // I primi 5 entrano, il sesto viene rifiutato
    expect(results.filter(Boolean).length).toBe(MAX_EQUIPMENT_SLOTS);
    expect(results[5]).toBe(false);
  });

  it('rifiuta i duplicati', () => {
    const eq = new EquipmentManager();
    expect(eq.equip(DEMO_ITEMS[0]!)).toBe(true);
    expect(eq.equip(DEMO_ITEMS[0]!)).toBe(false);
  });

  it('unequip libera lo slot e syncPipeline riflette gli slot correnti', () => {
    const eq = new EquipmentManager();
    const pipeline = new DamagePipeline();

    // Anello (+8 PRE_ADD) e Idolo (×1.5 MULT), entrambi Furia: bonus di set ×1.08
    // (10+8)*1.5*1.08 = 29.16
    eq.equip(findItem('anello-bruto')!);
    eq.equip(findItem('idolo-goblin')!);
    eq.syncPipeline(pipeline);
    expect(
      pipeline.calculateTurnDamage(new Decimal(10), [], new Decimal(1)).toNumber()
    ).toBeCloseTo(29.16, 6);

    // Rimuovo l'anello: resta un solo oggetto Furia, niente set: 10*1.5 = 15
    eq.unequip(0);
    eq.syncPipeline(pipeline);
    expect(
      pipeline.calculateTurnDamage(new Decimal(10), [], new Decimal(1)).toNumber()
    ).toBeCloseTo(15, 6);
  });

  it("il danno non dipende dall'ordine di equipaggiamento", () => {
    const ids = ['anello-bruto', 'zanna-ricurva', 'lente-avida', 'idolo-goblin', 'talismano-caos'];
    const dmg = (order: number[]) => {
      const eq = new EquipmentManager();
      const p = new DamagePipeline();
      order.forEach(i => eq.equip(findItem(ids[i]!)!));
      eq.syncPipeline(p);
      return p.calculateTurnDamage(new Decimal(10), [], new Decimal(1)).toNumber();
    };
    expect(dmg([0, 2, 3])).toBeCloseTo(dmg([3, 2, 0]), 6);
    expect(dmg([0, 1, 2, 3, 4])).toBeCloseTo(dmg([4, 3, 2, 1, 0]), 6);
  });
});
