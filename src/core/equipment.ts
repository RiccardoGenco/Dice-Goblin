import Decimal from 'break_infinity.js';
import { DamageMiddleware, DamagePayload, DieFace, FaceType, MiddlewarePhase, SkillId } from './types';
import { DamagePipeline } from './DamagePipeline';
import { FAMILIES, FUSION_BOOST, familiesOf, fusionName, activeSetBonuses } from './families';
import type { FamilyId } from './families';

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
  /** dadi pescati ma lasciati in panchina */
  benched: number;
  hpRatio: number;
  enemyPoisoned: boolean;
  enemyShielded: boolean;
  charged: boolean;
}

export function neutralCtx(): ItemCtx {
  return {
    skill: null, faces: [], poisonFaces: 0, shieldFaces: 0, fireFaces: 0, enchantedFaces: 0,
    multFaces: 0, extraDice: 0, reactions: 0, benched: 0, hpRatio: 1,
    enemyPoisoned: false, enemyShielded: false, charged: false
  };
}

/** Regole del combattimento modificate dagli oggetti */
export interface ItemMods {
  /** dadi giocabili in più per turno */
  extraPlay: number;
  /** dadi pescati in più per turno */
  extraDraw: number;
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
    extraPlay: 0, extraDraw: 0, poisonTurns: 0, fireFactor: 0, shieldMult: 1,
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
  /** Reliquia: solo dai Boss d'Atto, mai in vendita */
  relic?: boolean;
  /** Fusione di due oggetti: porta con sé le parti e occupa uno slot solo */
  fusion?: boolean;
  parts?: Pick<EquipmentItem, 'phase' | 'apply' | 'mods' | 'name' | 'description'>[];
  families?: FamilyId[];
}

/** Le parti che producono davvero effetti (una fusione ne ha più d'una) */
export function itemParts(item: EquipmentItem): Pick<EquipmentItem, 'phase' | 'apply' | 'mods' | 'name' | 'description'>[] {
  return item.parts ?? [item];
}

/* ---------------- Fusione di oggetti ---------------- */

export const FUSION_PREFIX = 'fusion:';

export function canFuse(a: EquipmentItem, b: EquipmentItem): string | null {
  if (a.id === b.id) return 'Servono due oggetti diversi';
  if (a.relic || b.relic) return 'Le reliquie non si fondono';
  if (a.fusion || b.fusion) return 'Una fusione non si fonde di nuovo';
  return null;
}

/** Due oggetti diventano uno: gli effetti di entrambi, più un bonus per ogni famiglia */
export function fuseItems(a: EquipmentItem, b: EquipmentItem): EquipmentItem {
  const fa = familiesOf(a)[0], fb = familiesOf(b)[0];
  const fams = [fa, fb].filter((f): f is FamilyId => !!f);
  const boosts = fams.map(f => FUSION_BOOST[f]);
  const name = fams.length === 2 ? fusionName(fams[0]!, fams[1]!) : `${a.name} + ${b.name}`;
  return {
    id: `${FUSION_PREFIX}${a.id}+${b.id}`,
    name,
    icon: a.icon,
    rarity: 'raro',
    fusion: true,
    families: fams,
    description: `${a.name}: ${a.description}. ${b.name}: ${b.description}.` +
      (boosts.length ? ` Bonus di fusione: ${fams.length === 2 && fams[0] === fams[1] ? `${boosts[0]!.text} (doppio)` : boosts.map(x => x.text).join(', ')}.` : ''),
    parts: [a, b, ...boosts.map((x, i) => ({ ...x.part, name: name, description: boosts[i]!.text }))]
  };
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
  { id: 'anello-bruto', name: 'Anello del Mercenario', icon: '💍', rarity: 'comune',
    description: '+8 danno piatto', phase: P.PRE_ADD, apply: flat(() => 8) },
  { id: 'zanna-ricurva', name: 'Zanna di Worg', icon: '🦷', rarity: 'comune',
    description: '+15 danno alla mossa', phase: P.ADD, apply: addDmg(() => 15) },
  { id: 'lente-avida', name: "Monocolo dell'Assassino", icon: '🔍', rarity: 'comune',
    description: '×1.25 al danno', phase: P.MULT, apply: mult(() => 1.25) },
  { id: 'unghia-sporca', name: 'Artiglio Stregato', icon: '🪝', rarity: 'comune',
    description: '+4 danno per ogni faccia incantata nel lancio', phase: P.PRE_ADD,
    apply: flat(c => 4 * c.enchantedFaces) },
  { id: 'cintura-sacche', name: "Bandoliera dell'Avventuriero", icon: '🎒', rarity: 'comune',
    description: '+2 danno per ogni dado nel lancio', phase: P.PRE_ADD,
    apply: flat(c => 2 * c.faces.length) },
  { id: 'mazza-chiodata', name: 'Stella del Mattino', icon: '🔨', rarity: 'comune',
    description: 'Sgancio Brutale ×1.4 se nel lancio non ci sono facce incantate', phase: P.MULT,
    apply: mult(c => (c.skill === SkillId.SGANCIO_BRUTALE && c.enchantedFaces === 0 ? 1.4 : 1)) },
  { id: 'fiala-velenosa', name: 'Fiala di Veleno Drow', icon: '🧪', rarity: 'comune',
    description: 'Ogni veleno dura 1 turno in più', mods: { poisonTurns: 1 } },
  { id: 'scudo-pentola', name: 'Targa del Soldato', icon: '🛡️', rarity: 'comune',
    description: 'Parata ×1.5', phase: P.MULT,
    apply: mult(c => (c.skill === SkillId.PARATA ? 1.5 : 1)) },
  { id: 'carbone-ardente', name: 'Tizzone Infernale', icon: '🪨', rarity: 'comune',
    description: '+6 danno per ogni faccia di fuoco nel lancio', phase: P.PRE_ADD,
    apply: flat(c => 6 * c.fireFaces) },

  // ---------------- Non comuni: premiano una build ----------------
  { id: 'fungo-marcio', name: 'Spora del Sottosuolo', icon: '🍄', rarity: 'non-comune',
    description: 'Bava ×1.5', phase: P.MULT,
    apply: mult(c => (c.skill === SkillId.BAVA ? 1.5 : 1)) },
  { id: 'pentolino-fumante', name: 'Turibolo Ardente', icon: '♨️', rarity: 'non-comune',
    description: 'Il fuoco fa ×3 invece di ×2', mods: { fireFactor: 1 } },
  { id: 'pelle-spessa', name: 'Pelle di Troll', icon: '🦎', rarity: 'non-comune',
    description: 'Lo scudo delle facce vale +50%', mods: { shieldMult: 1.5 } },
  { id: 'scudo-chiodato', name: 'Scudo Spinato', icon: '📌', rarity: 'non-comune',
    description: 'La Parata rimbalza il 75% invece del 50%', mods: { reflectBonus: 0.25 } },
  { id: 'dadi-truccati', name: "Dadi dell'Imbroglione", icon: '🎲', rarity: 'raro',
    description: 'Giochi 1 dado in più per turno', mods: { extraPlay: 1 } },
  { id: 'mano-larga', name: 'Guanto del Prestigiatore', icon: '🖐️', rarity: 'non-comune',
    description: 'Peschi 1 dado in più per turno (serve una borsa con più di 5 dadi)', mods: { extraDraw: 1 } },
  { id: 'nervi-saldi', name: 'Sangue Freddo', icon: '🧊', rarity: 'non-comune',
    description: '×1.5 se non giochi nessuna faccia incantata', phase: P.MULT,
    apply: mult(c => (c.enchantedFaces === 0 ? 1.5 : 1)) },
  { id: 'ruota-fortuna', name: 'Ruota del Fato', icon: '🎡', rarity: 'non-comune',
    description: '×1.2 per ogni dado lasciato in panchina', phase: P.MULT,
    apply: mult(c => Math.pow(1.2, c.benched)) },
  { id: 'predatore', name: 'Zanna del Ragno Gigante', icon: '🐺', rarity: 'non-comune',
    description: '×1.4 se il nemico è avvelenato', phase: P.MULT,
    apply: mult(c => (c.enemyPoisoned ? 1.4 : 1)) },
  { id: 'frantumascudi', name: 'Ascia Spaccascudi', icon: '🪓', rarity: 'non-comune',
    description: '×1.5 se il nemico ha uno scudo', phase: P.MULT,
    apply: mult(c => (c.enemyShielded ? 1.5 : 1)) },
  { id: 'dente-oro', name: "Dracma d'Oro", icon: '🥇', rarity: 'non-comune',
    description: '×1.25 se nel lancio c\'è almeno una faccia moltiplicatore', phase: P.MULT,
    apply: mult(c => (c.multFaces > 0 ? 1.25 : 1)) },
  { id: 'catena-arrugginita', name: 'Catena del Carceriere', icon: '⛓️', rarity: 'non-comune',
    description: '×1.15 per ogni lancio extra della ricorsione', phase: P.MULT,
    apply: mult(c => Math.pow(1.15, c.extraDice)) },
  { id: 'cuore-carica', name: 'Cuore del Campione', icon: '🫀', rarity: 'non-comune',
    description: 'Il lancio dopo una Carica vale ×2 invece di ×1.5', mods: { chargeBonus: 0.5 } },
  { id: 'calderone', name: 'Calderone della Strega', icon: '🫕', rarity: 'non-comune',
    description: 'Le reazioni fanno +50% di danno', mods: { reactionMult: 1.5 } },

  // ---------------- Rari: cambiano il modo di giocare ----------------
  { id: 'idolo-goblin', name: 'Idolo di Maglubiyet', icon: '🗿', rarity: 'raro',
    description: '×1.5 al danno', phase: P.MULT, apply: mult(() => 1.5) },
  { id: 'talismano-caos', name: 'Talismano del Caos', icon: '🌀', rarity: 'raro',
    description: '×1.04 per ogni dado nel lancio (a fine calcolo)', phase: P.POST_MULT,
    apply: post(c => Math.pow(1.04, c.faces.length)) },
  { id: 'pietra-catalizzatore', name: "Gemma dell'Arcanista", icon: '💠', rarity: 'raro',
    description: '×1.5 per ogni reazione nel lancio', phase: P.MULT,
    apply: mult(c => Math.pow(1.5, c.reactions)) },
  { id: 'rabbia-goblin', name: 'Ira del Berserker', icon: '😡', rarity: 'raro',
    description: '×1.6 se hai meno della metà degli HP', phase: P.MULT,
    apply: mult(c => (c.hpRatio < 0.5 ? 1.6 : 1)) }
];

/** Compatibilità: l'elenco completo (prima era "demo") */
export const DEMO_ITEMS = ITEMS;

/** Reliquie: premio dei Boss d'Atto (1 su 3). Tutte rare, ognuna costruisce una build. */
export const RELICS: EquipmentItem[] = [
  { id: 'corona-veleno', name: 'Corona della Regina Ragno', icon: '🐍', rarity: 'raro', relic: true,
    description: 'Bava ×1.6 e ogni veleno dura 2 turni in più', phase: P.MULT,
    apply: mult(c => (c.skill === SkillId.BAVA ? 1.6 : 1)), mods: { poisonTurns: 2 } },
  { id: 'bastione', name: 'Bastione del Re Nano', icon: '🏰', rarity: 'raro', relic: true,
    description: 'Parata ×2 e rimbalza il 25% in più', phase: P.MULT,
    apply: mult(c => (c.skill === SkillId.PARATA ? 2 : 1)), mods: { reflectBonus: 0.25 } },
  { id: 'cuore-fuoco', name: 'Cuore di Efreeti', icon: '🔥', rarity: 'raro', relic: true,
    description: 'Il fuoco fa ×4 invece di ×2 e +8 danno per ogni faccia di fuoco', phase: P.PRE_ADD,
    apply: flat(c => 8 * c.fireFaces), mods: { fireFactor: 2 } },
  { id: 'mano-giocatore', name: 'Mano del Lich', icon: '🃏', rarity: 'raro', relic: true,
    description: 'Peschi 2 dadi in più per turno (serve una borsa grande)', mods: { extraDraw: 2 } },
  { id: 'specchio-ricorsivo', name: "Specchio dell'Eco Eterno", icon: '🪞', rarity: 'raro', relic: true,
    description: '×1.4 per ogni lancio extra della ricorsione', phase: P.MULT,
    apply: mult(c => Math.pow(1.4, c.extraDice)) },
  { id: 'trono-moltiplicatori', name: "Trono dell'Arcidiavolo", icon: '👑', rarity: 'raro', relic: true,
    description: '×2 se nel lancio ci sono almeno 2 facce moltiplicatore', phase: P.MULT,
    apply: mult(c => (c.multFaces >= 2 ? 2 : 1)) },
  { id: 'pelle-drago', name: 'Scaglie di Drago Antico', icon: '🐉', rarity: 'raro', relic: true,
    description: 'Lo scudo delle facce vale il doppio', mods: { shieldMult: 2 } },
  { id: 'calice-arcano', name: "Calice dell'Arcimago", icon: '🏆', rarity: 'raro', relic: true,
    description: 'Le reazioni fanno il doppio del danno e ×1.3 per ogni reazione', phase: P.MULT,
    apply: mult(c => Math.pow(1.3, c.reactions)), mods: { reactionMult: 2 } },
  { id: 'stendardo-carica', name: 'Stendardo del Condottiero', icon: '🚩', rarity: 'raro', relic: true,
    description: 'Il lancio dopo una Carica vale ×2.5 invece di ×1.5', mods: { chargeBonus: 1 } },
  { id: 'panchina-oro', name: "Scranno d'Oro", icon: '🪑', rarity: 'raro', relic: true,
    description: '×1.15 per ogni dado lasciato in panchina', phase: P.MULT,
    apply: mult(c => Math.pow(1.15, c.benched)) }
];

export function findItem(id: string): EquipmentItem | undefined {
  if (id.startsWith(FUSION_PREFIX)) {
    const [x, y] = id.slice(FUSION_PREFIX.length).split('+');
    const a = x ? findItem(x) : undefined, b = y ? findItem(y) : undefined;
    return a && b ? fuseItems(a, b) : undefined;
  }
  return ITEMS.find(i => i.id === id) ?? RELICS.find(i => i.id === id);
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
  const expanded: Pick<EquipmentItem, 'phase' | 'apply' | 'mods' | 'name' | 'description'>[] = [];
  for (const it of items) if (it) expanded.push(...itemParts(it));
  for (const b of activeSetBonuses(items)) expanded.push({ ...b.part, name: `${FAMILIES[b.family].name} ×${b.need}`, description: b.text });
  for (const it of expanded) {
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

  /** Parti attive: quelle degli oggetti (le fusioni ne hanno più d'una) e i bonus di set */
  private allParts(): Pick<EquipmentItem, 'phase' | 'apply' | 'mods'>[] {
    const items = this.slots.filter((s): s is EquipmentItem => s !== null);
    return [...items.flatMap(itemParts), ...activeSetBonuses(items).map(b => b.part)];
  }

  /** Famiglie e quanti oggetti ne hai */
  public get items(): EquipmentItem[] { return this.slots.filter((s): s is EquipmentItem => s !== null); }

  /** Somma dei mods di tutti gli oggetti equipaggiati */
  public mods(): ItemMods {
    const m = neutralMods();
    const parts = this.allParts();
    for (const item of parts) {
      if (!item?.mods) continue;
      const x = item.mods;
      m.extraPlay += x.extraPlay ?? 0;
      m.extraDraw += x.extraDraw ?? 0;
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
    for (const item of this.allParts()) {
      if (!item?.apply || item.phase === undefined) continue;
      const apply = item.apply;
      const mw: DamageMiddleware = pl => apply(pl, ctx());
      pipeline.register(item.phase, mw);
    }
  }
}

