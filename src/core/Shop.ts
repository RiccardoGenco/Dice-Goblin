import { upgradedFaceValue } from './format';
import Decimal from 'break_infinity.js';
import { GoblinDie } from './GoblinDie';
import { BALANCE, CombatantStats, FaceType, RNG, defaultRNG } from './types';
import { DieBlueprint, createDieFromBlueprint } from './diceCatalog';
import { EquipmentItem, ITEMS, ItemRarity, findItem } from './equipment';
import { familiesOf, familyCounts } from './families';
import { RunManager } from './RunManager';

/* ============================================================
 * Shop — Economia della run (rework)
 *
 * UNITÀ DI PREZZO: il bottino di un incontro normale a quel livello
 * (RunManager.incomeAt). Ogni prezzo è una frazione di quel numero,
 * quindi il potere d'acquisto è lo stesso all'inizio e alla fine della
 * run: due o tre acquisti sensati a ogni visita.
 *
 * COSA SI COMPRA
 *  - Oggetti, su tre livelli di rarità. Più è alto il livello, più
 *    l'effetto è forte e più costa. La rarità offerta cambia con la
 *    profondità della run: all'inizio quasi solo comuni, alla fine
 *    soprattutto non comuni e rari.
 *  - Potenziare una faccia (le facce ×, più potenti, costano di più).
 *  - Un dado nuovo dal pool sbloccato.
 *  - Servizi: Pozione (+50% HP) ed Elisir (HP al massimo).
 *  - Rilancio del banco: costo che sale a ogni rilancio della visita,
 *    così qualsiasi quantità di oro si trasforma in scelta.
 *  Forza e Vitalità non si comprano più: crescono con le vittorie.
 * ============================================================ */

/** Rincaro composto per ogni acquisto già fatto nella run (solo merce, non servizi) */
export const PURCHASE_INFLATION = 1.03;
/** Sconto del Mercante Reale (dopo le boss fight): prezzi x0.7 */
export const SPECIAL_DISCOUNT = 0.7;
/** Quota degli HP massimi curata da una Pozione */
export const POTION_HEAL = 0.5;

export type OfferKind = 'upgrade-face' | 'new-die' | 'item' | 'potion' | 'elixir';

export interface ShopOffer {
  id: string;
  kind: OfferKind;
  icon: string;
  label: string;
  description: string;
  cost: Decimal;
  /** Riferimenti per upgrade-face */
  dieIndex?: number;
  faceIndex?: number;
  /** Riferimento per new-die */
  blueprintId?: string;
  /** Riferimento per item */
  itemId?: string;
  rarity?: ItemRarity;
}

/** Prezzo come frazione del bottino del livello */
const COST_FRACTION = {
  'face': 0.35,
  'face-mult': 0.8, // una faccia × vale molto più di una normale
  'new-die': 1.0,
  'potion': 0.4,
  'elixir': 0.9
} as const;

export const ITEM_COST_FRACTION: Record<ItemRarity, number> = {
  'comune': 0.45,
  'non-comune': 0.85,
  'raro': 1.5
};
/** Quota del prezzo che si recupera rivendendo un oggetto */
export const SELL_RATIO = 0.5;
/** Oggetti in vendita a ogni visita (il Mercante Reale ne ha uno in più) */
export const ITEMS_PER_VISIT = 3;

/** Pesi di rarità in base alla profondità (livello 0..29) */
export function tierWeights(level: number, special = false): Record<ItemRarity, number> {
  const L = Math.max(0, level);
  return {
    'comune': Math.max(15, 70 - 2 * L),
    'non-comune': Math.min(45, 27 + 0.7 * L),
    'raro': Math.min(40, 3 + 1.4 * L) * (special ? 3 : 1)
  };
}

export class Shop {
  constructor(private readonly rng: RNG = defaultRNG) {}

  private unit(level: number): Decimal {
    return RunManager.incomeAt(level);
  }

  private price(fraction: number, level: number, purchases: number, special: boolean, inflate = true): Decimal {
    let c = this.unit(level).times(fraction);
    if (inflate) c = c.times(new Decimal(PURCHASE_INFLATION).pow(purchases));
    if (special) c = c.times(SPECIAL_DISCOUNT);
    return c.floor();
  }

  public itemCost(item: EquipmentItem, level: number, purchases: number, special = false): Decimal {
    return this.price(ITEM_COST_FRACTION[item.rarity], level, purchases, special);
  }

  /** Quanto si incassa rivendendo l'oggetto (al prezzo del livello attuale, senza rincari) */
  public sellValue(item: EquipmentItem, level: number): Decimal {
    return this.unit(level).times(ITEM_COST_FRACTION[item.rarity]).times(SELL_RATIO).floor();
  }

  /** Costo del rilancio del banco: cresce a ogni rilancio della stessa visita */
  public rerollCost(level: number, rerollsDone: number): Decimal {
    return this.unit(level)
      .times(BALANCE.REROLL_COST)
      .times(new Decimal(BALANCE.REROLL_GROWTH).pow(rerollsDone))
      .floor();
  }

  /** Pesca oggetti non posseduti, pesati per rarità in base alla profondità.
   *  `guaranteeRare`: almeno un raro, se ce n'è ancora. */
  private pickItems(
    count: number, owned: readonly string[], level: number, special: boolean, guaranteeRare: boolean
  ): EquipmentItem[] {
    // Gli oggetti già fusi non tornano in vendita; le famiglie che hai già pesano di più
    const ownedItems = owned.map(findItem).filter((i): i is EquipmentItem => !!i);
    const taken = new Set<string>(owned);
    for (const it of ownedItems) for (const p of it.fusion ? it.parts ?? [] : []) taken.add((p as EquipmentItem).id);
    const have = familyCounts(ownedItems);
    const pool = ITEMS.filter(i => !taken.has(i.id));
    const tier = tierWeights(level, special);
    const famBoost = (i: EquipmentItem): number => {
      const f = familiesOf(i)[0];
      return !f || have[f] === 0 ? 1 : have[f] === 1 ? 2 : 3;
    };
    const weights = { 'comune': tier['comune'], 'non-comune': tier['non-comune'], 'raro': tier['raro'] };
    const wOf = (i: EquipmentItem): number => weights[i.rarity] * famBoost(i);
    const picked: EquipmentItem[] = [];
    const draw = (from: EquipmentItem[]): EquipmentItem => {
      const total = from.reduce((a, i) => a + wOf(i), 0);
      let r = this.rng.next() * total;
      let idx = 0;
      for (; idx < from.length - 1; idx++) {
        r -= wOf(from[idx]!);
        if (r < 0) break;
      }
      return from[idx]!;
    };
    const take = (it: EquipmentItem) => {
      pool.splice(pool.indexOf(it), 1);
      picked.push(it);
    };
    if (guaranteeRare) {
      const rares = pool.filter(i => i.rarity === 'raro');
      if (rares.length > 0) take(draw(rares));
    }
    while (picked.length < count && pool.length > 0) take(draw(pool));
    return picked;
  }

  /** La merce del banco (si rimescola col rilancio) */
  public generateMerchandise(
    level: number,
    purchases: number,
    bag: GoblinDie[],
    unlockedBlueprints: DieBlueprint[],
    special = false,
    ownedItemIds: readonly string[] = []
  ): ShopOffer[] {
    const offers: ShopOffer[] = [];

    // Potenziamento di una faccia casuale della borsa
    const dieIndex = Math.floor(this.rng.next() * bag.length);
    const die = bag[dieIndex];
    if (die) {
      const faceIndex = Math.floor(this.rng.next() * die.faces.length);
      const face = die.faces[faceIndex]!;
      const isMult = face.type === FaceType.MULTIPLIER;
      offers.push({
        id: 'offer-face',
        kind: 'upgrade-face',
        icon: '⬆️',
        label: `Potenzia Dado ${dieIndex + 1}`,
        description: isMult
          ? `Faccia ×${face.value.toString()} -> ×${face.value.plus(0.5).toString()}`
          : `Faccia ${face.value.toString()} -> ${upgradedFaceValue(face.value).toString()}`,
        cost: this.price(isMult ? COST_FRACTION['face-mult'] : COST_FRACTION.face, level, purchases, special),
        dieIndex,
        faceIndex
      });
    }

    // Dado sbloccato dal pool, se non è già in borsa
    const available = unlockedBlueprints.find(bp => !bag.some(d => d.blueprintId === bp.id));
    if (available) {
      offers.push({
        id: `offer-die-${available.id}`,
        kind: 'new-die',
        icon: available.icon,
        label: available.name,
        description: available.description,
        cost: this.price(COST_FRACTION['new-die'], level, purchases, special),
        blueprintId: available.id
      });
    }

    const count = ITEMS_PER_VISIT + (special ? 1 : 0);
    for (const item of this.pickItems(count, ownedItemIds, level, special, special)) {
      offers.push({
        id: `offer-item-${item.id}`,
        kind: 'item',
        icon: item.icon,
        label: item.name,
        description: item.description,
        cost: this.itemCost(item, level, purchases, special),
        itemId: item.id,
        rarity: item.rarity
      });
    }
    return offers;
  }

  /** I servizi (prezzo fisso, non rincarano e non si rimescolano) */
  public generateServices(level: number, special = false, hpRatio = 1): ShopOffer[] {
    const offers: ShopOffer[] = [];
    if (hpRatio < 0.98) {
      offers.push({
        id: 'offer-potion',
        kind: 'potion',
        icon: '🧪',
        label: `Pozione di Cura (+${Math.round(POTION_HEAL * 100)}% HP)`,
        description: 'Cura subito metà degli HP massimi',
        cost: this.price(COST_FRACTION.potion, level, 0, special, false)
      });
    }
    if (hpRatio < 0.6) {
      offers.push({
        id: 'offer-elixir',
        kind: 'elixir',
        icon: '🍷',
        label: 'Elisir di Vita',
        description: 'HP al massimo, subito',
        cost: this.price(COST_FRACTION.elixir, level, 0, special, false)
      });
    }
    return offers;
  }

  /** Tutte le offerte della visita: merce, poi servizi. Con special=true (dopo
   *  una boss fight) applica lo sconto del Mercante Reale: un oggetto in più e
   *  almeno un raro garantito. */
  public generateOffers(
    level: number,
    purchases: number,
    bag: GoblinDie[],
    unlockedBlueprints: DieBlueprint[],
    special = false,
    ownedItemIds: readonly string[] = [],
    hpRatio = 1
  ): ShopOffer[] {
    return [
      ...this.generateMerchandise(level, purchases, bag, unlockedBlueprints, special, ownedItemIds),
      ...this.generateServices(level, special, hpRatio)
    ];
  }

  /** Applica l'offerta. Le cure agiscono sugli HP della run: le gestisce il chiamante. */
  public apply(
    offer: ShopOffer,
    ctx: { stats: CombatantStats; bag: GoblinDie[]; blueprints: DieBlueprint[] }
  ): void {
    switch (offer.kind) {
      case 'upgrade-face': {
        const die = ctx.bag[offer.dieIndex ?? -1];
        const face = die?.faces[offer.faceIndex ?? -1];
        if (die && face) {
          face.value =
            face.type === FaceType.MULTIPLIER
              ? face.value.plus(0.5)
              : upgradedFaceValue(face.value);
        }
        break;
      }
      case 'new-die': {
        const bp = ctx.blueprints.find(b => b.id === offer.blueprintId);
        if (bp) ctx.bag.push(createDieFromBlueprint(bp));
        break;
      }
      default:
        break; // oggetti e cure: gestiti dal chiamante
    }
  }
}
