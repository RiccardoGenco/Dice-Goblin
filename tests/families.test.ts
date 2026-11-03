import { describe, it, expect } from 'vitest';
import { ITEMS, RELICS, EquipmentManager, findItem, fuseItems, canFuse } from '../src/core/equipment';
import { ITEM_FAMILY, familyCounts, activeSetBonuses, familiesOf } from '../src/core/families';

const get = (id: string) => findItem(id)!;

describe('famiglie', () => {
  it('ogni oggetto e ogni reliquia ha una famiglia', () => {
    for (const it of [...ITEMS, ...RELICS]) expect(ITEM_FAMILY[it.id], it.id).toBeDefined();
  });
  it('i bonus di set si attivano a 2 e a 3 oggetti', () => {
    const two = [get('fiala-velenosa'), get('fungo-marcio')];
    expect(activeSetBonuses(two).map(b => b.need)).toEqual([2]);
    const three = [...two, get('predatore')];
    expect(activeSetBonuses(three).map(b => b.need)).toEqual([2, 3]);
  });
  it('il bonus di set cambia le regole del combattimento', () => {
    const m = new EquipmentManager();
    m.equip(get('fiala-velenosa')); m.equip(get('fungo-marcio'));
    expect(m.mods().poisonTurns).toBe(2); // 1 dalla fiala + 1 dal set Veleno x2
  });
});

describe('fusione', () => {
  it('unisce due oggetti in uno solo, con le parti di entrambi', () => {
    const f = fuseItems(get('fiala-velenosa'), get('scudo-pentola'));
    expect(f.fusion).toBe(true);
    expect(f.name).toBe('Spine Velenose');
    expect(familiesOf(f)).toEqual(['veleno', 'scudo']);
    expect(f.parts!.length).toBe(4); // due oggetti + un bonus per famiglia
  });
  it('conta per entrambe le famiglie e occupa un solo slot', () => {
    const f = fuseItems(get('fiala-velenosa'), get('scudo-pentola'));
    const c = familyCounts([f, get('fungo-marcio')]);
    expect(c.veleno).toBe(2);
    expect(c.scudo).toBe(1);
  });
  it('non si fondono reliquie, fusioni o lo stesso oggetto', () => {
    expect(canFuse(get('bastione'), get('anello-bruto'))).not.toBeNull();
    expect(canFuse(get('anello-bruto'), get('anello-bruto'))).not.toBeNull();
    expect(canFuse(fuseItems(get('anello-bruto'), get('lente-avida')), get('zanna-ricurva'))).not.toBeNull();
    expect(canFuse(get('anello-bruto'), get('lente-avida'))).toBeNull();
  });
  it('si ricostruisce dall\'id salvato', () => {
    const f = fuseItems(get('fiala-velenosa'), get('scudo-pentola'));
    const back = findItem(f.id)!;
    expect(back.name).toBe(f.name);
    const m = new EquipmentManager();
    m.equip(back);
    expect(m.mods().poisonTurns).toBeGreaterThanOrEqual(2); // fiala + bonus veleno
  });
});
