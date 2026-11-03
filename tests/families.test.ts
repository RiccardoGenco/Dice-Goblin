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

import { Forge, MAX_BAG_DICE } from '../src/core/Forge';
import { GoblinDie } from '../src/core/GoblinDie';
import { Rarity, FaceType } from '../src/core/types';

describe('scolpire un dado nuovo', () => {
  const ctx = { level: 5, purchases: 2, special: false };
  const mkBag = (n: number) => Array.from({ length: n }, () => new GoblinDie(Rarity.COMUNE));
  it('aggiunge un dado proporzionato alla borsa, con una faccia incantata', () => {
    const f = new Forge();
    const bag = mkBag(5);
    for (const d of bag) for (const x of d.faces) x.value = x.value.times(100); // borsa potenziata
    f.apply({ kind: 'scolpire' }, bag);
    expect(bag.length).toBe(6);
    const nd = bag[5]!;
    expect(nd.faces.length).toBe(6);
    expect(nd.faces.filter(x => x.effect).length).toBe(1);
    expect(nd.faces.every(x => x.type === FaceType.NORMAL)).toBe(true);
    const mean = nd.faces.reduce((a, x) => a + x.value.toNumber(), 0) / 6;
    expect(mean).toBeGreaterThan(200); // la borsa vale ~350 a faccia, il dado nuovo ci si avvicina
  });
  it('costa molto più di una Fusione e si ferma a 9 dadi', () => {
    const f = new Forge();
    const bag = mkBag(5);
    const sc = f.quote({ kind: 'scolpire' }, bag, ctx);
    const fu = f.quote({ kind: 'fusione', targetIndex: 0, sacrificeIndex: 1 }, bag, ctx);
    expect(sc.ok).toBe(true);
    expect(sc.cost.gt(fu.cost.times(3))).toBe(true);
    expect(f.quote({ kind: 'scolpire' }, mkBag(MAX_BAG_DICE), ctx).ok).toBe(false);
  });
});
