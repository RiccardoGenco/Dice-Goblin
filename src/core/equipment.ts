import Decimal from 'break_infinity.js';
import { DamageMiddleware, DamagePayload, DieFace, FaceType, MiddlewarePhase, SkillId } from './types';
import { DamagePipeline } from './DamagePipeline';

/* ============================================================
 * Equipment — 5 slot, oggetti con condizioni (design_evolution, Fase B)
 *
 * Un oggetto fa due cose possibili:
 *  - `apply`: modifica il danno in una fase rigida della pipeline
 *    (PRE_ADD -> ADD -> MULT -> POST_MULT), leggendo il CONTESTO del
 *    lancio (quali effetti sono usciti, quale azione, rilanci usati...).
 *    Per questo il danno non dipende dall'ordine degli slot.
 *  - `mods`: cambia una regola del combattimento (più rilanci, fuoco
 *    più forte, rimbalzo maggiore...). I mods di più oggetti si sommano.
 *
 * Gli oggetti si comprano dal mercante e si rivendono a metà prezzo.
 * ============================================================ */

export const MAX_EQUIPMENT_SLOTS = 5;

export type ItemRarity = 'comune' | 'non-comune' | 'raro';

export const ITEM_RARITY_META: Record<ItemRarity, { name: string; weight: number }> = {
  'comune': { name: 'Comune', weight: 60 },
  'non-comune': { name: 'Non comune', weight: 30 },
  'raro': { name: 'Raro', weight: 10 }
};

/** Cosa succede nel lancio corrente, visibile agli oggetti */
export interface ItemCtx {
  skill: SkillId | null;
  faces: readonly DieFace[];
  /** facce incantate per effetto */
  poisonFaces: number;
  shieldFaces: number;
  fireFaces: number;
  enchantedFaces: number;
  multFaces: number;
  /** lanci extra generati dalla ricorsione */
  extraDice: number;
  reactions: number;
  rerollsUsed: number;
  hpRatio: number;
  enemyPoisoned: boolean;
  enemyShielded: boolean;
  charged: boolean;
}

export function neutralCtx(): ItemCtx {
  return {
    skill: null, faces: [], poisonFaces: 0, shieldFaces: 0, fireFaces: 0, enchantedFaces: 0,
    multFaces: 0, extraDice: 0, reactions: 0, rerollsUsed: 0, hpRatio: 1,
    enemyPoisoned: false, enemyShielded: false, charged: false
  };
}

/** Regole del combattimento modificate dagli oggetti */
export interface ItemMods {
  extraRerolls: number;
  /** turni in più per ogni veleno applicato */
  poisonTurns: number;
  /** aggiunto al fattore del fuoco (base ×2) */
  fireFactor: number;
  /** moltiplicatore su scudo delle facce */
  shieldMult: number;
  /** moltiplicatore sul danno delle reazioni (Vapori, Scudo ardente) */
  reactionMult: number;
  /** aggiunto alla quota di rimbalzo della Parata */
  reflectBonus: number;
  /** aggiunto al bonus ×1.5 del turno dopo una Carica */
  chargeBonus: number;
}

export function neutralMods(): ItemMods {
  return {
    extraRerolls: 0, poisonTurns: 0, fireFactor: 0, shieldMult: 1,
    reactionMult: 1, reflectBonus: 0, chargeBonus: 0
  };
}

export interface EquipmentItem {
  id: string;
  name: string;
  icon: string;
  description: string;
  rarity: ItemRarity;
  phase?: MiddlewarePhase;
  apply?: (pl: DamagePayload, ctx: ItemCtx) => DamagePayload;
  mods?: Partial<ItemMods>;
}

/* ---- scorciatoie per scrivere gli oggetti ---- */
const flat = (f: (c: ItemCtx) => number) =>
  (pl: DamagePayload, c: ItemCtx): DamagePayload => ({ ...pl, flatAdded: pl.flatAdded.plus(f(c)) });
const addDmg = (f: (c: ItemCtx) => number) =>
  (pl: DamagePayload, c: ItemCtx): DamagePayload => ({ ...pl, finalDamage: pl.finalDamage.plus(f(c)) });
const mult = (f: (c: ItemCtx) => number) =>
  (pl: DamagePayload, c: ItemCtx): DamagePayload => ({ ...pl, multiplier: pl.multiplier.times(f(c)) });
const post = (f: (c: ItemCtx) => number) =>
  (pl: DamagePayload, c: ItemCtx): DamagePayload => ({ ...pl, finalDamage: pl.finalDamage.times(f(c)) });
const P = MiddlewarePhase;

/** Il catalogo. I primi sei id sono quelli storici (salvataggi compatibili). */
export const ITEMS: EquipmentItem[] = [
  // ---------------- Comuni: base solida e semplice ----------------
  { id: 'anello-bruto', name: 'Anello del Bruto', icon: '💍', rarity: 'comune',
    description: '+8 danno piatto', phase: P.PRE_ADD, apply: flat(() => 8) },
  { id: 'zanna-ricurva', name: 'Zanna Ricurva', icon: '🦷', rarity: 'comune',
    description: '+15 danno alla mossa', phase: P.ADD, apply: addDmg(() => 15) },
  { id: 'lente-avida', name: 'Lente Avida', icon: '🔍', rarity: 'comune',
    description: '×1.25 al danno', phase: P.MULT, apply: mult(() => 1.25) },
  { id: 'unghia-sporca', name: 'Unghia Sporca', icon: '🪝', rarity: 'comune',
    description: '+4 danno per ogni faccia incantata nel lancio', phase: P.PRE_ADD,
    apply: flat(c => 4 * c.enchantedFaces) },
  { id: 'cintura-sacche', name: 'Cintura di Sacche', icon: '🎒', rarity: 'comune',
    description: '+2 danno per ogni dado nel lancio', phase: P.PRE_ADD,
    apply: flat(c => 2 * c.faces.length) },
  { id: 'mazza-chiodata', name: 'Mazza Chiodata', icon: '🔨', rarity: 'comune',
    description: 'Sgancio Brutale ×1.4 se nel lancio non ci sono facce incantate', phase: P.MULT,
    apply: mult(c => (c.skill === SkillId.SGANCIO_BRUTALE && c.enchantedFaces === 0 ? 1.4 : 1)) },
  { id: 'fiala-velenosa', name: 'Fiala Velenosa', icon: '🧪', rarity: 'comune',
    description: 'Ogni veleno dura 1 turno in più', mods: { poisonTurns: 1 } },
  { id: 'scudo-pentola', name: 'Scudo di Pentola', icon: '🍲', rarity: 'comune',
    description: 'Parata ×1.5', phase: P.MULT,
    apply: mult(c => (c.skill === SkillId.PARATA ? 1.5 : 1)) },
  { id: 'carbone-ardente', name: 'Carbone Ardente', icon: '🪨', rarity: 'comune',
    description: '+6 danno per ogni faccia di fuoco nel lancio', phase: P.PRE_ADD,
    apply: flat(c => 6 * c.fireFaces) },

  // ---------------- Non comuni: premiano una build ----------------
  { id: 'fungo-marcio', name: 'Fungo Marcio', icon: '🍄', rarity: 'non-comune',
    description: 'Bava ×1.5', phase: P.MULT,
    apply: mult(c => (c.skill === SkillId.BAVA ? 1.5 : 1)) },
  { id: 'pentolino-fumante', name: 'Pentolino Fumante', icon: '♨️', rarity: 'non-comune',
    description: 'Il fuoco fa ×3 invece di ×2', mods: { fireFactor: 1 } },
  { id: 'pelle-spessa', name: 'Pelle Spessa', icon: '🦎', rarity: 'non-comune',
    description: 'Lo scudo delle facce vale +50%', mods: { shieldMult: 1.5 } },
  { id: 'scudo-chiodato', name: 'Scudo Chiodato', icon: '📌', rarity: 'non-comune',
    description: 'La Parata rimbalza il 75% invece del 50%', mods: { reflectBonus: 0.25 } },
  { id: 'dadi-truccati', name: 'Dadi Truccati', icon: '🎲', rarity: 'non-comune',
    description: '+1 rilancio gratuito per turno', mods: { extraRerolls: 1 } },
  { id: 'nervi-saldi', name: 'Nervi Saldi', icon: '🧊', rarity: 'non-comune',
    description: '×1.5 se non hai usato nessun rilancio', phase: P.MULT,
    apply: mult(c => (c.rerollsUsed === 0 ? 1.5 : 1)) },
  { id: 'ruota-fortuna', name: 'Ruota della Fortuna', icon: '🎡', rarity: 'non-comune',
    description: '×1.25 per ogni rilancio usato', phase: P.MULT,
    apply: mult(c => Math.pow(1.25, c.rerollsUsed)) },
  { id: 'predatore', name: 'Dente del Predatore', icon: '🐺', rarity: 'non-comune',
    description: '×1.4 se il nemico è avvelenato', phase: P.MULT,
    apply: mult(c => (c.enemyPoisoned ? 1.4 : 1)) },
  { id: 'frantumascudi', name: 'Frantumascudi', icon: '🪓', rarity: 'non-comune',
    description: '×1.5 se il nemico ha uno scudo', phase: P.MULT,
    apply: mult(c => (c.enemyShielded ? 1.5 : 1)) },
  { id: 'dente-oro', name: "Dente d'Oro", icon: '🥇', rarity: 'non-comune',
    description: '×1.25 se nel lancio c\'è almeno una faccia moltiplicatore', phase: P.MULT,
    apply: mult(c => (c.multFaces > 0 ? 1.25 : 1)) },
  { id: 'catena-arrugginita', name: 'Catena Arrugginita', icon: '⛓️', rarity: 'non-comune',
    description: '×1.15 per ogni lancio extra della ricorsione', phase: P.MULT,
    apply: mult(c => Math.pow(1.15, c.extraDice)) },
  { id: 'cuore-carica', name: 'Cuore di Carica', icon: '🫀', rarity: 'non-comune',
    description: 'Il lancio dopo una Carica vale ×2 invece di ×1.5', mods: { chargeBonus: 0.5 } },
  { id: 'calderone', name: 'Calderone', icon: '🫕', rarity: 'non-comune',
    description: 'Le reazioni fanno +50% di danno', mods: { reactionMult: 1.5 } },

  // ---------------- Rari: cambiano il modo di giocare ----------------
  { id: 'idolo-goblin', name: 'Idolo Goblin', icon: '🗿', rarity: 'raro',
    description: '×1.5 al danno', phase: P.MULT, apply: mult(() => 1.5) },
  { id: 'talismano-caos', name: 'Talismano del Caos', icon: '🌀', rarity: 'raro',
    description: '×1.04 per ogni dado nel lancio (a fine calcolo)', phase: P.POST_MULT,
    apply: post(c => Math.pow(1.04, c.faces.length)) },
  { id: 'pietra-catalizzatore', name: 'Pietra del Catalizzatore', icon: '💠', rarity: 'raro',
    description: '×1.5 per ogni reazione nel lancio', phase: P.MULT,
    apply: mult(c => Math.pow(1.5, c.reactions)) },
  { id: 'rabbia-goblin', name: 'Rabbia del Goblin', icon: '😡', rarity: 'raro',
    description: '×1.6 se hai meno della metà degli HP', phase: P.MULT,
    apply: mult(c => (c.hpRatio < 0.5 ? 1.6 : 1)) }
];

/** Compatibilità: l'elenco completo (prima era "demo") */
export const DEMO_ITEMS = ITEMS;

export function findItem(id: string): EquipmentItem | undefined {
  return ITEMS.find(i => i.id === id);
}

/** Costruisce il contesto da un lancio (usato dal motore) */
export function buildCtx(base: Omit<ItemCtx, 'poisonFaces' | 'shieldFaces' | 'fireFaces' | 'enchantedFaces' | 'multFaces'>): ItemCtx {
  let poison = 0, shield = 0, fire = 0, mults = 0;
  for (const f of base.faces) {
    if (f.effect === 'veleno') poison++;
    else if (f.effect === 'scudo') shield++;
    else if (f.effect === 'fuoco') fire++;
    if (f.type === FaceType.MULTIPLIER) mults++;
  }
  return { ...base, poisonFaces: poison, shieldFaces: shield, fireFaces: fire, enchantedFaces: poison + shield + fire, multFaces: mults };
}

/** Quali oggetti stanno contribuendo al danno nel lancio corrente, e come */
export function describeActiveItems(items: readonly (EquipmentItem | null)[], ctx: ItemCtx): string[] {
  const out: string[] = [];
  const probe: DamagePayload = {
    baseStr: new Decimal(0), flatAdded: new Decimal(0), multiplier: new Decimal(1), finalDamage: new Decimal(100)
  };
  for (const it of items) {
    if (!it) continue;
    if (it.apply) {
      const r = it.apply(probe, ctx);
      const parts: string[] = [];
      if (r.flatAdded.gt(0)) parts.push(`+${r.flatAdded.toNumber().toFixed(0)} piatto`);
      if (!r.multiplier.eq(1)) parts.push(`×${+r.multiplier.toNumber().toFixed(2)}`);
      if (!r.finalDamage.eq(100)) {
        // due sonde distinguono un bonus piatto da un moltiplicatore finale
        const r2 = it.apply({ ...probe, finalDamage: new Decimal(200) }, ctx);
        const d1 = r.finalDamage.minus(100).toNumber();
        const d2 = r2.finalDamage.minus(200).toNumber();
        parts.push(Math.abs(d1 - d2) < 1e-9 ? `+${+d1.toFixed(2)}` : `×${+r.finalDamage.div(100).toNumber().toFixed(3)}`);
      }
      if (parts.length > 0) out.push(`${it.name} (${parts.join(', ')})`);
    }
    if (it.mods) out.push(`${it.name} (regola: ${it.description})`);
  }
  return out;
}

export class EquipmentManager {
  public readonly slots: (EquipmentItem | null)[] = Array.from(
    { length: MAX_EQUIPMENT_SLOTS },
    () => null
  );

  /** Equipaggia nel primo slot libero. Ritorna false se pieno o duplicato. */
  public equip(item: EquipmentItem): boolean {
    if (this.slots.some(s => s?.id === item.id)) return false;
    const free = this.slots.findIndex(s => s === null);
    if (free === -1) return false;
    this.slots[free] = item;
    return true;
  }

  public get freeSlots(): number { return this.slots.filter(s => s === null).length; }
  public owns(id: string): boolean { return this.slots.some(s => s?.id === id); }
  public get ownedIds(): string[] { return this.slots.filter((s): s is EquipmentItem => s !== null).map(s => s.id); }

  public unequip(slotIndex: number): EquipmentItem | null {
    const item = this.slots[slotIndex] ?? null;
    if (slotIndex >= 0 && slotIndex < MAX_EQUIPMENT_SLOTS) this.slots[slotIndex] = null;
    return item;
  }

  /** Somma dei mods di tutti gli oggetti equipaggiati */
  public mods(): ItemMods {
    const m = neutralMods();
    for (const item of this.slots) {
      if (!item?.mods) continue;
      const x = item.mods;
      m.extraRerolls += x.extraRerolls ?? 0;
      m.poisonTurns += x.poisonTurns ?? 0;
      m.fireFactor += x.fireFactor ?? 0;
      m.shieldMult *= x.shieldMult ?? 1;
      m.reactionMult *= x.reactionMult ?? 1;
      m.reflectBonus += x.reflectBonus ?? 0;
      m.chargeBonus += x.chargeBonus ?? 0;
    }
    return m;
  }

  /** Ricostruisce i middleware dagli slot correnti. `ctx` fornisce lo stato
   *  del lancio (il motore); senza, gli oggetti vedono un contesto neutro. */
  public syncPipeline(pipeline: DamagePipeline, ctx: () => ItemCtx = neutralCtx): void {
    pipeline.clear();
    for (const item of this.slots) {
      if (!item?.apply || item.phase === undefined) continue;
      const apply = item.apply;
      const mw: DamageMiddleware = pl => apply(pl, ctx());
      pipeline.register(item.phase, mw);
    }
  }
}

