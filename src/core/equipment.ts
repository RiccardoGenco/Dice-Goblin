import Decimal from 'break_infinity.js';
import { DamageMiddleware, MiddlewarePhase } from './types';
import { DamagePipeline } from './DamagePipeline';

/* ============================================================
 * Equipment — Inventario a slot limitati (MVP Specs §4, Opz. B)
 *
 * 5 slot fissi stile Balatro: il sesto oggetto impone una scelta.
 * Ogni oggetto è un middleware registrato in una fase rigida:
 * grazie alla pipeline PRE_ADD -> ADD -> MULT -> POST_MULT il
 * danno finale NON dipende dall'ordine con cui il giocatore ha
 * riempito gli slot (testato in equipment.test.ts).
 * ============================================================ */

export const MAX_EQUIPMENT_SLOTS = 5;

export interface EquipmentItem {
  id: string;
  name: string;
  /** Icona placeholder (emoji); in produzione: SVG inline come da piano */
  icon: string;
  description: string;
  phase: MiddlewarePhase;
  apply: DamageMiddleware;
}

/** Oggetti demo per l'MVP: uno per fascia della pipeline.
 *  NOTA SCALING: gli oggetti MULT si compongono moltiplicativamente
 *  tra loro e con le facce MULTIPLIER (×1.25 × ×1.5 = ×1.875):
 *  sono la via principale di crescita esponenziale delle build. */
export const DEMO_ITEMS: EquipmentItem[] = [
  {
    id: 'anello-bruto',
    name: 'Anello del Bruto',
    icon: '💍',
    description: '+8 danno piatto (PRE_ADD)',
    phase: MiddlewarePhase.PRE_ADD,
    apply: pl => ({ ...pl, flatAdded: pl.flatAdded.plus(new Decimal(8)) })
  },
  {
    id: 'zanna-ricurva',
    name: 'Zanna Ricurva',
    icon: '🦷',
    description: '+15 danno alla mossa (ADD)',
    phase: MiddlewarePhase.ADD,
    apply: pl => ({ ...pl, finalDamage: pl.finalDamage.plus(new Decimal(15)) })
  },
  {
    id: 'lente-avida',
    name: 'Lente Avida',
    icon: '🔍',
    description: '×1.25 al danno (MULT)',
    phase: MiddlewarePhase.MULT,
    apply: pl => ({ ...pl, multiplier: pl.multiplier.times(new Decimal(1.25)) })
  },
  {
    id: 'idolo-goblin',
    name: 'Idolo Goblin',
    icon: '🗿',
    description: '×1.5 al danno (MULT)',
    phase: MiddlewarePhase.MULT,
    apply: pl => ({ ...pl, multiplier: pl.multiplier.times(new Decimal(1.5)) })
  },
  {
    id: 'talismano-caos',
    name: 'Talismano del Caos',
    icon: '🌀',
    description: '×1.1 finale (POST_MULT)',
    phase: MiddlewarePhase.POST_MULT,
    apply: pl => ({ ...pl, finalDamage: pl.finalDamage.times(new Decimal(1.1)) })
  },
  {
    id: 'unghia-sporca',
    name: 'Unghia Sporca',
    icon: '🪝',
    description: '+3 danno piatto (PRE_ADD)',
    phase: MiddlewarePhase.PRE_ADD,
    apply: pl => ({ ...pl, flatAdded: pl.flatAdded.plus(new Decimal(3)) })
  }
];

export class EquipmentManager {
  public readonly slots: (EquipmentItem | null)[] = Array.from(
    { length: MAX_EQUIPMENT_SLOTS },
    () => null
  );

  /** Equipaggia nel primo slot libero. Ritorna false se pieno:
   *  la UI deve imporre al giocatore la scelta di cosa scartare. */
  public equip(item: EquipmentItem): boolean {
    if (this.slots.some(s => s?.id === item.id)) return false; // no duplicati
    const free = this.slots.findIndex(s => s === null);
    if (free === -1) return false; // 5 slot pieni: scelta obbligata
    this.slots[free] = item;
    return true;
  }

  public unequip(slotIndex: number): EquipmentItem | null {
    const item = this.slots[slotIndex] ?? null;
    if (slotIndex >= 0 && slotIndex < MAX_EQUIPMENT_SLOTS) {
      this.slots[slotIndex] = null;
    }
    return item;
  }

  /** Ricostruisce i middleware della pipeline dagli slot correnti.
   *  Da invocare a ogni modifica dell'equipaggiamento e a ogni
   *  nuova battaglia (la pipeline è per-engine). */
  public syncPipeline(pipeline: DamagePipeline): void {
    pipeline.clear();
    for (const item of this.slots) {
      if (item) pipeline.register(item.phase, item.apply);
    }
  }
}
