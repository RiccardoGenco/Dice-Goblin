import type { DamagePayload } from './types';
import { MiddlewarePhase, SkillId } from './types';
import type { EquipmentItem, ItemCtx } from './equipment';

/* ============================================================
 * Famiglie di oggetti e bonus di set
 *
 * Ogni oggetto appartiene a una famiglia. Avere 2 o 3 oggetti della stessa
 * famiglia sblocca bonus che i singoli oggetti non danno: da qui nasce una
 * build, e il Mercante tende a proporre oggetti delle famiglie che già hai.
 * Una fusione conta per entrambe le famiglie dei due oggetti che l'hanno
 * generata, e occupa un solo slot.
 * ============================================================ */

export type FamilyId = 'veleno' | 'fuoco' | 'scudo' | 'dadi' | 'furia';

export const FAMILY_ORDER: FamilyId[] = ['veleno', 'fuoco', 'scudo', 'dadi', 'furia'];

export const FAMILIES: Record<FamilyId, { name: string; icon: string; color: string; blurb: string }> = {
  veleno: { name: 'Veleno', icon: '☠️', color: '#7bdc6a', blurb: 'danno nel tempo, ignora lo scudo' },
  fuoco: { name: 'Fuoco', icon: '🔥', color: '#ff8a3d', blurb: 'fuoco e reazioni' },
  scudo: { name: 'Scudo', icon: '🛡️', color: '#6cb4ff', blurb: 'parate e rimbalzo' },
  dadi: { name: 'Dadi', icon: '🎲', color: '#c58bff', blurb: 'catene, moltiplicatori, panchina' },
  furia: { name: 'Furia', icon: '💪', color: '#ff5d6c', blurb: 'danno diretto' }
};

export const ITEM_FAMILY: Record<string, FamilyId> = {
  'fiala-velenosa': 'veleno', 'fungo-marcio': 'veleno', 'predatore': 'veleno', 'corona-veleno': 'veleno',
  'carbone-ardente': 'fuoco', 'pentolino-fumante': 'fuoco', 'calderone': 'fuoco', 'pietra-catalizzatore': 'fuoco',
  'cuore-fuoco': 'fuoco', 'calice-arcano': 'fuoco',
  'scudo-pentola': 'scudo', 'pelle-spessa': 'scudo', 'scudo-chiodato': 'scudo', 'bastione': 'scudo', 'pelle-drago': 'scudo',
  'cintura-sacche': 'dadi', 'unghia-sporca': 'dadi', 'mano-larga': 'dadi', 'dadi-truccati': 'dadi', 'ruota-fortuna': 'dadi',
  'catena-arrugginita': 'dadi', 'dente-oro': 'dadi', 'talismano-caos': 'dadi', 'mano-giocatore': 'dadi',
  'specchio-ricorsivo': 'dadi', 'trono-moltiplicatori': 'dadi', 'panchina-oro': 'dadi',
  'anello-bruto': 'furia', 'zanna-ricurva': 'furia', 'lente-avida': 'furia', 'mazza-chiodata': 'furia',
  'nervi-saldi': 'furia', 'frantumascudi': 'furia', 'cuore-carica': 'furia', 'idolo-goblin': 'furia',
  'rabbia-goblin': 'furia', 'stendardo-carica': 'furia'
};

/** Famiglie di un oggetto (le fusioni ne hanno due) */
export function familiesOf(item: Pick<EquipmentItem, 'id' | 'families'>): FamilyId[] {
  if (item.families) return item.families;
  const f = ITEM_FAMILY[item.id];
  return f ? [f] : [];
}

export function familyCounts(items: readonly (Pick<EquipmentItem, 'id' | 'families'> | null)[]): Record<FamilyId, number> {
  const c: Record<FamilyId, number> = { veleno: 0, fuoco: 0, scudo: 0, dadi: 0, furia: 0 };
  for (const it of items) if (it) for (const f of familiesOf(it)) c[f]++;
  return c;
}

/** Bonus di set: si attiva quando gli oggetti della famiglia sono almeno `need` (i livelli si sommano) */
export interface SetBonus {
  family: FamilyId;
  need: 2 | 3;
  text: string;
  /** una parte di oggetto virtuale: stessa forma degli oggetti veri */
  part: Pick<EquipmentItem, 'phase' | 'apply' | 'mods'>;
}

const P = MiddlewarePhase;
const mult = (f: (c: ItemCtx) => number) =>
  (pl: DamagePayload, c: ItemCtx): DamagePayload => ({ ...pl, multiplier: pl.multiplier.times(f(c)) });

export const SET_BONUSES: SetBonus[] = [
  { family: 'veleno', need: 2, text: 'Ogni veleno dura 1 turno in più', part: { mods: { poisonTurns: 1 } } },
  { family: 'veleno', need: 3, text: 'Bava ×1.3', part: { phase: P.MULT, apply: mult(c => (c.skill === SkillId.BAVA ? 1.3 : 1)) } },
  { family: 'fuoco', need: 2, text: 'Le reazioni fanno +20% di danno', part: { mods: { reactionMult: 1.2 } } },
  { family: 'fuoco', need: 3, text: 'Il fuoco fa un fattore in più', part: { mods: { fireFactor: 1 } } },
  { family: 'scudo', need: 2, text: 'Scudo delle facce +20%, rimbalzo +10%', part: { mods: { shieldMult: 1.2, reflectBonus: 0.1 } } },
  { family: 'scudo', need: 3, text: 'Parata ×1.35', part: { phase: P.MULT, apply: mult(c => (c.skill === SkillId.PARATA ? 1.35 : 1)) } },
  { family: 'dadi', need: 2, text: '+2% al danno per ogni dado nel lancio', part: { phase: P.MULT, apply: mult(c => 1 + 0.02 * c.faces.length) } },
  { family: 'dadi', need: 3, text: '×1.15 se nel lancio c\'è un moltiplicatore, altrimenti ×1.05', part: { phase: P.MULT, apply: mult(c => (c.multFaces > 0 ? 1.15 : 1.05)) } },
  { family: 'furia', need: 2, text: '×1.08 al danno', part: { phase: P.MULT, apply: mult(() => 1.08) } },
  { family: 'furia', need: 3, text: '×1.15 al danno', part: { phase: P.MULT, apply: mult(() => 1.15) } }
];

export function activeSetBonuses(items: readonly (Pick<EquipmentItem, 'id' | 'families'> | null)[]): SetBonus[] {
  const c = familyCounts(items);
  return SET_BONUSES.filter(b => c[b.family] >= b.need);
}

/* ---------------- Fusione ---------------- */

/** Quello che una famiglia aggiunge a una fusione: effetti che i due oggetti da soli non hanno */
export const FUSION_BOOST: Record<FamilyId, { text: string; part: Pick<EquipmentItem, 'phase' | 'apply' | 'mods'> }> = {
  veleno: { text: 'veleno +1 turno', part: { mods: { poisonTurns: 1 } } },
  fuoco: { text: 'reazioni +25%', part: { mods: { reactionMult: 1.25 } } },
  scudo: { text: 'scudo delle facce +25%', part: { mods: { shieldMult: 1.25 } } },
  dadi: { text: '×1.12', part: { phase: P.MULT, apply: mult(() => 1.12) } },
  furia: { text: '×1.12', part: { phase: P.MULT, apply: mult(() => 1.12) } }
};

const FUSION_NAMES: Record<string, string> = {
  'veleno+veleno': 'Alambicco Mortale', 'fuoco+fuoco': "Forgia dell'Inferno", 'scudo+scudo': 'Muraglia Eterna',
  'dadi+dadi': 'Sfera del Destino', 'furia+furia': 'Pugno Ancestrale',
  'veleno+fuoco': 'Vapore Infernale', 'veleno+scudo': 'Spine Velenose', 'dadi+veleno': 'Dado del Sicario',
  'furia+veleno': 'Morso Letale', 'fuoco+scudo': 'Egida Ardente', 'dadi+fuoco': 'Dadi di Fiamma',
  'furia+fuoco': 'Ira del Balor', 'dadi+scudo': 'Egida della Fortuna', 'furia+scudo': "Ariete d'Acciaio",
  'dadi+furia': 'Colpo del Destino'
};

export function fusionName(a: FamilyId, b: FamilyId): string {
  return FUSION_NAMES[`${a}+${b}`] ?? FUSION_NAMES[`${b}+${a}`] ?? 'Fusione';
}
