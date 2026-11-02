import Decimal from 'break_infinity.js';
import { GoblinDie } from './GoblinDie';
import { scaleShopCost } from './BattleEngine';
import { CombatantStats, FaceType, RNG, defaultRNG } from './types';
import { DieBlueprint, createDieFromBlueprint } from './diceCatalog';
import { EquipmentItem, ITEMS, ITEM_RARITY_META, ItemRarity } from './equipment';

/* ============================================================
 * Shop — Economia della run (GDD §4.2 + MVP §1)
 *
 * SCALING DEI COSTI: ogni offerta usa la curva ufficiale
 *   Cost(level) = base * 1.5^level        (scaleShopCost)
 * più un rincaro di +25% composto per ogni acquisto già fatto
 * nella run: comprare tutto diventa progressivamente impossibile
 * e il giocatore deve scegliere una direzione di build.
 * ============================================================ */

// TUNING (balance sim): 1.25 -> 1.08. Il rincaro composto per
// sempre a 1.25 distruggeva il potere d'acquisto (~x6e5 a fine run)
export const PURCHASE_INFLATION = 1.05;
/** Quota degli HP massimi curata da una Pozione (sink dell'oro: prima non esisteva cura a pagamento) */
export const POTION_HEAL = 0.5;
/** Sconto del Mercante Reale (dopo le boss fight): prezzi x0.7 */
export const SPECIAL_DISCOUNT = 0.7;

export type OfferKind =
  | 'stat-str'
  | 'stat-str-major' // esclusiva del Mercante Reale
  | 'stat-vit'
  | 'potion'
  | 'upgrade-face'
  | 'new-die'
  | 'item';

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

const BASE_COST: Record<OfferKind, number> = {
  'stat-str': 25,
  'stat-str-major': 60,
  'stat-vit': 20,
  'potion': 40,
  'upgrade-face': 30,
  'new-die': 80,
  'item': 0 // il prezzo dipende dalla rarità (ITEM_BASE_COST)
};

export const ITEM_BASE_COST: Record<ItemRarity, number> = {
  'comune': 30,
  'non-comune': 55,
  'raro': 100
};
/** Quota del prezzo che si recupera rivendendo un oggetto */
export const SELL_RATIO = 0.5;
/** Oggetti in vendita a ogni visita */
export const ITEMS_PER_VISIT = 2;

export class Shop {
  constructor(private readonly rng: RNG = defaultRNG) {}

  private cost(
    kind: OfferKind,
    level: number,
    purchases: number,
    special = false
  ): Decimal {
    let c = scaleShopCost(new Decimal(BASE_COST[kind]), level)
      .times(new Decimal(PURCHASE_INFLATION).pow(purchases));
    // Mercante Reale: il picco d'oro delle boss fight incontra lo sconto
    if (special) c = c.times(SPECIAL_DISCOUNT);
    return c.floor();
  }

  public itemCost(item: EquipmentItem, level: number, purchases: number, special = false): Decimal {
    let c = scaleShopCost(new Decimal(ITEM_BASE_COST[item.rarity]), level)
      .times(new Decimal(PURCHASE_INFLATION).pow(purchases));
    if (special) c = c.times(SPECIAL_DISCOUNT);
    return c.floor();
  }

  /** Quanto si incassa rivendendo l'oggetto (al prezzo del livello attuale, senza rincari) */
  public sellValue(item: EquipmentItem, level: number): Decimal {
    return scaleShopCost(new Decimal(ITEM_BASE_COST[item.rarity]), level).times(SELL_RATIO).floor();
  }

  /** Pesca oggetti non posseduti, pesati per rarità (più rari dal Mercante Reale) */
  private pickItems(count: number, owned: readonly string[], special: boolean): EquipmentItem[] {
    const pool = ITEMS.filter(i => !owned.includes(i.id));
    const picked: EquipmentItem[] = [];
    while (picked.length < count && pool.length > 0) {
      const w = (i: EquipmentItem) => ITEM_RARITY_META[i.rarity].weight * (special && i.rarity === 'raro' ? 3 : 1);
      const total = pool.reduce((a, i) => a + w(i), 0);
      let r = this.rng.next() * total;
      let idx = 0;
      for (; idx < pool.length - 1; idx++) {
        r -= w(pool[idx]!);
        if (r < 0) break;
      }
      picked.push(pool.splice(idx, 1)[0]!);
    }
    return picked;
  }

  /** Genera le offerte della visita. Con special=true (dopo una
   *  boss fight) applica lo sconto del Mercante Reale e aggiunge
   *  l'offerta premium esclusiva. */
  public generateOffers(
    level: number,
    purchases: number,
    bag: GoblinDie[],
    unlockedBlueprints: DieBlueprint[],
    special = false,
    ownedItemIds: readonly string[] = [],
    hpRatio = 1
  ): ShopOffer[] {
    const offers: ShopOffer[] = [];

    if (special) {
      offers.push({
        id: 'offer-str-major',
        kind: 'stat-str-major',
        icon: '💎',
        label: '+60% Forza',
        description: 'Offerta premium del Mercante Reale',
        cost: this.cost('stat-str-major', level, purchases, special)
      });
    }

    offers.push({
      id: 'offer-str',
      kind: 'stat-str',
      icon: '💪',
      label: '+30% Forza',
      description: 'Aumenta la STR base (Fase FLAT della pipeline)',
      cost: this.cost('stat-str', level, purchases, special)
    });

    offers.push({
      id: 'offer-vit',
      kind: 'stat-vit',
      icon: '❤️',
      label: '+25% Vitalità',
      description: 'Più HP massimi dalla prossima battaglia',
      cost: this.cost('stat-vit', level, purchases, special)
    });

    // Pozione: solo se si è feriti (l'offerta ha senso solo se cura qualcosa)
    if (hpRatio < 0.98) {
      offers.push({
        id: 'offer-potion',
        kind: 'potion',
        icon: '🧪',
        label: `Pozione di Cura (+${Math.round(POTION_HEAL * 100)}% HP)`,
        description: 'Cura subito metà degli HP massimi',
        cost: this.cost('potion', level, purchases, special)
      });
    }

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
          : `Faccia ${face.value.toString()} -> ${face.value.times(1.5).floor().toString()}`,
        cost: this.cost('upgrade-face', level, purchases, special),
        dieIndex,
        faceIndex
      });
    }

    // Dado sbloccato dal pool, se non è già in borsa
    const available = unlockedBlueprints.find(
      bp => !bag.some(d => d.blueprintId === bp.id)
    );
    if (available) {
      offers.push({
        id: `offer-die-${available.id}`,
        kind: 'new-die',
        icon: available.icon,
        label: available.name,
        description: available.description,
        cost: this.cost('new-die', level, purchases, special),
        blueprintId: available.id
      });
    }

    for (const item of this.pickItems(ITEMS_PER_VISIT, ownedItemIds, special)) {
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

  /** Applica un'offerta GIÀ pagata (il RunManager gestisce l'oro).
   *
   *  NOTE DI SCALING:
   *  - stat-str/vit crescono del 30%/25% composto: acquisti ripetuti
   *    producono crescita esponenziale allineata alla curva nemici.
   *  - upgrade-face su MULTIPLIER (+0.5 flat) è volutamente più
   *    cauto: quel valore entra in Fase MULT dove si compone
   *    moltiplicativamente con tutto il resto. */
  public apply(
    offer: ShopOffer,
    ctx: { stats: CombatantStats; bag: GoblinDie[]; blueprints: DieBlueprint[] }
  ): void {
    switch (offer.kind) {
      case 'stat-str':
        ctx.stats.str = ctx.stats.str.times(1.3);
        break;
      case 'stat-str-major':
        // Premium: x1.6 in un colpo solo (vs 1.3^2 = 1.69 in due acquisti)
        ctx.stats.str = ctx.stats.str.times(1.6);
        break;
      case 'stat-vit':
        ctx.stats.vit = ctx.stats.vit.times(1.25);
        break;
      case 'upgrade-face': {
        const die = ctx.bag[offer.dieIndex ?? -1];
        const face = die?.faces[offer.faceIndex ?? -1];
        if (die && face) {
          face.value =
            face.type === FaceType.MULTIPLIER
              ? face.value.plus(0.5)
              : face.value.times(1.5).floor();
        }
        break;
      }
      case 'new-die': {
        const bp = ctx.blueprints.find(b => b.id === offer.blueprintId);
        if (bp) ctx.bag.push(createDieFromBlueprint(bp));
        break;
      }
    }
  }
}
