import Decimal from 'break_infinity.js';
import { GoblinDie } from './GoblinDie';
import { ITEMS, EquipmentManager, EquipmentItem } from './equipment';
import { RunManager, ELITE_HP_MULT, ELITE_STR_MULT, ELITE_GOLD_MULT } from './RunManager';
import { upgradedFaceValue } from './format';
import { CombatantStats, FaceType, Rarity, RNG } from './types';
import type { BossRules } from './enemies';

/* ============================================================
 * Crossroad — il bivio tra gli incontri
 *
 * Dopo ogni vittoria compaiono due porte, mai uguali. Una è sempre
 * "economica" (Bottega o Fucina), l'altra cambia il tipo di partita:
 *   Riposo  — cura, ma niente potenziamenti
 *   Élite   — il PROSSIMO incontro è un nemico forte con una regola
 *             speciale; in cambio oro in più e un oggetto raro a scelta
 *   Evento  — una scelta a rischio e ricompensa
 * L'Élite sostituisce un incontro normale: l'Atto resta di 10 incontri.
 * ============================================================ */

export type DoorKind = 'shop' | 'forge' | 'rest' | 'elite' | 'event';

export const DOOR_META: Record<DoorKind, { icon: string; label: string; hint: string }> = {
  shop: { icon: '🛒', label: 'La Bottega', hint: 'Stat, oggetti e dadi' },
  forge: { icon: '🔨', label: 'La Forgia', hint: 'Scolpisci le facce dei dadi' },
  rest: { icon: '🏕️', label: 'Il Riposo', hint: 'Recuperi molti HP, ma nessun potenziamento' },
  elite: { icon: '👹', label: 'La Sfida Élite', hint: 'Il prossimo nemico è più forte e ha una regola. Premio: oro +50% e un oggetto a scelta tra due non comuni' },
  event: { icon: '❓', label: 'L\'Imprevisto', hint: 'Un incontro strano: scegli se rischiare' }
};

export const REST_HEAL = 0.4;
export { ELITE_HP_MULT, ELITE_STR_MULT, ELITE_GOLD_MULT };

/** Due porte diverse. `nextIsBoss`: il prossimo incontro è Campione/Boss (niente Élite). */
export const ELITES_PER_ACT = 2;

export function pickDoors(rng: RNG, nextIsBoss: boolean, hpRatio: number, elitesInAct = 0): [DoorKind, DoorKind] {
  const first: DoorKind = rng.next() < 0.5 ? 'shop' : 'forge';
  const other: DoorKind = first === 'shop' ? 'forge' : 'shop';
  const pool: [DoorKind, number][] = [[other, 2], ['event', 3]];
  if (hpRatio < 0.95) pool.push(['rest', hpRatio < 0.7 ? 3 : 1.5]);
  if (!nextIsBoss && elitesInAct < ELITES_PER_ACT) pool.push(['elite', 2.5]);
  const total = pool.reduce((a, [, w]) => a + w, 0);
  let r = rng.next() * total;
  let second = pool[0]![0];
  for (const [k, w] of pool) { r -= w; if (r < 0) { second = k; break; } }
  return rng.next() < 0.5 ? [first, second] : [second, first];
}

/* ---------------- Élite ---------------- */

const ELITE_RULES: BossRules[] = [
  { regenPct: 0.025, text: 'Élite corazzato: recupera il 2,5% degli HP a ogni turno' },
  { handPenalty: 1, text: 'Élite molesto: peschi un dado in meno a ogni turno' }
];

export function eliteRule(act: number, encounter: number): BossRules {
  return ELITE_RULES[(act * 7 + encounter) % ELITE_RULES.length]!;
}

/** Due oggetti per il premio: rari se possibile, poi non comuni. */
export function pickEliteRewards(rng: RNG, ownedIds: readonly string[]): EquipmentItem[] {
  const pool = ITEMS.filter(i => !ownedIds.includes(i.id));
  const out: EquipmentItem[] = [];
  // due non comuni: una scelta vera tra due oggetti buoni, senza il raro garantito
  for (const rarity of ['non-comune', 'raro', 'comune'] as const) {
    const cands = pool.filter(i => i.rarity === rarity && !out.includes(i));
    while (out.length < 2 && cands.length > 0) out.push(cands.splice(Math.floor(rng.next() * cands.length), 1)[0]!);
  }
  return out;
}

/** L'oggetto da sostituire quando gli slot sono pieni: il meno raro. */
export function weakestSlot(eq: EquipmentManager): number {
  const score = (r: string) => (r === 'comune' ? 0 : r === 'non-comune' ? 1 : 2);
  let idx = -1, best = 99;
  eq.slots.forEach((s, i) => {
    if (s && score(s.rarity) < best) { best = score(s.rarity); idx = i; }
  });
  return idx;
}

/* ---------------- Eventi ---------------- */

export interface EventCtx {
  run: RunManager;
  stats: CombatantStats;
  bag: GoblinDie[];
  equipment: EquipmentManager;
  rng: RNG;
}

export interface EventOption {
  label: string;
  hint: string;
  /** Motivo per cui non si può scegliere, o null */
  blocked?: (c: EventCtx) => string | null;
  /** Applica e ritorna il testo dell'esito */
  apply: (c: EventCtx) => string;
}

export interface EventDef {
  id: string;
  icon: string;
  title: string;
  text: string;
  options: EventOption[];
}

const unit = (c: EventCtx): Decimal => RunManager.incomeAt(c.run.shopLevel);
const loseHp = (c: EventCtx, x: number): void => { c.run.state.hpRatio = Math.max(0.05, c.run.state.hpRatio - x); };
const gainHp = (c: EventCtx, x: number): void => { c.run.state.hpRatio = Math.min(1, c.run.state.hpRatio + x); };
const needHp = (min: number) => (c: EventCtx): string | null => c.run.state.hpRatio > min ? null : 'Hai troppo pochi HP';
const needGold = (mult: number) => (c: EventCtx): string | null => c.run.state.gold.gte(unit(c).times(mult).floor()) ? null : 'Oro insufficiente';

/** Migliora una faccia: preferisce i moltiplicatori, poi i numeri semplici. Ritorna la descrizione. */
function upgradeOneFace(c: EventCtx): string {
  const cands: { die: number; face: number; mult: boolean }[] = [];
  c.bag.forEach((d, di) => d.faces.forEach((f, fi) => {
    if (f.type === FaceType.MULTIPLIER) cands.push({ die: di, face: fi, mult: true });
  }));
  if (cands.length === 0) {
    c.bag.forEach((d, di) => d.faces.forEach((f, fi) => {
      if (f.type === FaceType.NORMAL) cands.push({ die: di, face: fi, mult: false });
    }));
  }
  if (cands.length === 0) return 'Nessuna faccia da migliorare';
  const pick = cands[Math.floor(c.rng.next() * cands.length)]!;
  const face = c.bag[pick.die]!.faces[pick.face]!;
  const before = face.value.toString();
  face.value = pick.mult ? face.value.plus(0.5) : upgradedFaceValue(face.value);
  return `una faccia del dado D${pick.die + 1} passa da ${before} a ${face.value.toString()}`;
}

function curseDie(): GoblinDie {
  const faces = [
    { value: new Decimal(14), type: FaceType.NORMAL },
    { value: new Decimal(10), type: FaceType.NORMAL },
    { value: new Decimal(7), type: FaceType.NORMAL },
    { value: new Decimal(3), type: FaceType.MULTIPLIER },
    { value: new Decimal(2), type: FaceType.MULTIPLIER },
    { value: new Decimal(1), type: FaceType.NORMAL }
  ];
  return new GoblinDie(Rarity.RARO, faces);
}

export const EVENTS: EventDef[] = [
  {
    id: 'altare', icon: '🩸', title: 'L\'Altare di Sangue',
    text: 'Un altare di pietra rossa ti chiama. Una ciotola attende il tuo sangue.',
    options: [
      { label: 'Offri il sangue', hint: 'Perdi il 25% degli HP, +12% Forza per sempre', blocked: needHp(0.45),
        apply: c => { loseHp(c, 0.25); c.stats.str = c.stats.str.times(1.12); return 'La Forza sale del 12%. Gli HP calano del 25%.'; } },
      { label: 'Vai oltre', hint: 'Non succede niente', apply: () => 'Lasci l\'altare dov\'è.' }
    ]
  },
  {
    id: 'mendicante', icon: '🧓', title: 'Il Mendicante',
    text: 'Un vecchio ti tende la mano. Sotto gli stracci luccica qualcosa.',
    options: [
      { label: 'Dai un bottino', hint: 'Paghi 1 bottino, ricevi un oggetto non comune', blocked: c => c.equipment.freeSlots === 0 ? 'Slot pieni' : needGold(1)(c),
        apply: c => {
          const pool = ITEMS.filter(i => i.rarity === 'non-comune' && !c.equipment.owns(i.id));
          if (pool.length === 0) return 'Il vecchio sorride ma non ha nulla da darti.';
          c.run.spendGold(unit(c).floor(), false);
          const it = pool[Math.floor(c.rng.next() * pool.length)]!;
          c.equipment.equip(it);
          return `Il vecchio ti consegna: ${it.name}.`;
        } },
      { label: 'Tira dritto', hint: 'Non succede niente', apply: () => 'Il mendicante borbotta e si volta.' }
    ]
  },
  {
    id: 'fonte', icon: '⛲', title: 'La Fonte',
    text: 'Acqua chiara tra le rocce. Puoi berne o bagnarci i tuoi dadi.',
    options: [
      { label: 'Bevi', hint: 'Recuperi il 40% degli HP', apply: c => { gainHp(c, 0.4); return 'Ti senti rinato: +40% HP.'; } },
      { label: 'Bagna i dadi', hint: 'Una faccia della borsa migliora', apply: c => `Le facce si rinfrescano: ${upgradeOneFace(c)}.` }
    ]
  },
  {
    id: 'scommessa', icon: '🎲', title: 'La Scommessa',
    text: 'Un goblin con tre denti ti sfida: "Metà dell\'oro, testa o croce".',
    options: [
      { label: 'Punta metà dell\'oro', hint: '50%: vinci più del doppio, 50%: perdi la posta',
        blocked: c => c.run.state.gold.gt(0) ? null : 'Non hai oro',
        apply: c => {
          const bet = c.run.state.gold.div(2).floor();
          if (c.rng.next() < 0.5) { c.run.addGold(bet.times(2.2).floor()); return 'Vinci! Il goblin impreca e paga.'; }
          c.run.spendGold(bet, false); return 'Perdi. Il goblin ride e si tiene la posta.';
        } },
      { label: 'Rifiuta', hint: 'Non succede niente', apply: () => 'Il goblin sputa per terra.' }
    ]
  },
  {
    id: 'dado-maledetto', icon: '💀', title: 'Il Dado Maledetto',
    text: 'Un dado nero sul sentiero. Si dice che chi lo prende paghi in sangue.',
    options: [
      { label: 'Prendilo', hint: 'Perdi il 25% degli HP, un nuovo dado con due moltiplicatori entra in borsa', blocked: needHp(0.45),
        apply: c => { loseHp(c, 0.25); c.bag.push(curseDie()); return 'Il dado è tuo. Il polso brucia.'; } },
      { label: 'Lascialo', hint: 'Non succede niente', apply: () => 'Qualcuno lo prenderà. Non tu.' }
    ]
  },
  {
    id: 'fabbro', icon: '🔨', title: 'Il Fabbro Errante',
    text: 'Un fabbro con l\'incudine sulla schiena si offre di lavorare i tuoi dadi.',
    options: [
      { label: 'Paga 1 bottino', hint: 'Migliora due facce della borsa', blocked: needGold(1),
        apply: c => { c.run.spendGold(unit(c).floor(), false); return `Martellate nette: ${upgradeOneFace(c)}; ${upgradeOneFace(c)}.`; } },
      { label: 'Rifiuta', hint: 'Non succede niente', apply: () => 'Il fabbro si rimette in cammino.' }
    ]
  },
  {
    id: 'funghi', icon: '🍄', title: 'Funghi Strani',
    text: 'Funghi viola brillano in una radura. Odorano di muschio e potenza.',
    options: [
      { label: 'Mangiane', hint: 'Perdi il 15% degli HP, +10% Vitalità per sempre', blocked: needHp(0.3),
        apply: c => { loseHp(c, 0.15); c.stats.vit = c.stats.vit.times(1.1); return 'La Vitalità sale del 10%. Lo stomaco protesta.'; } },
      { label: 'Lasciali stare', hint: 'Non succede niente', apply: () => 'Meglio non rischiare.' }
    ]
  },
  {
    id: 'tesoro', icon: '📦', title: 'Il Forziere in Trappola',
    text: 'Un forziere chiuso, con un ago ben visibile sulla serratura.',
    options: [
      { label: 'Apri a mani nude', hint: '60%: 2 bottini, 40%: perdi il 20% degli HP', blocked: needHp(0.3),
        apply: c => {
          if (c.rng.next() < 0.6) { c.run.addGold(unit(c).times(2).floor()); return 'Click. Dentro: oro a manciate.'; }
          loseHp(c, 0.2); return 'L\'ago era avvelenato. Il forziere è vuoto.';
        } },
      { label: 'Disinnesca (½ bottino)', hint: 'Sicuro: 2 bottini', blocked: needGold(0.5),
        apply: c => { c.run.spendGold(unit(c).times(0.5).floor(), false); c.run.addGold(unit(c).times(2).floor()); return 'Lavoro pulito: oro a manciate.'; } },
      { label: 'Ignoralo', hint: 'Non succede niente', apply: () => 'Chi si fida dei forzieri?' }
    ]
  },
  {
    id: 'sognatore', icon: '💭', title: 'Il Mercante di Sogni',
    text: 'Una figura incappucciata offre oro vero per un oggetto qualunque.',
    options: [
      { label: 'Vendi l\'oggetto più debole', hint: 'Lo vendi a 3 volte il suo valore', blocked: c => c.equipment.freeSlots === 5 ? 'Non hai oggetti' : null,
        apply: c => {
          const idx = weakestSlot(c.equipment);
          const it = c.equipment.slots[idx]!;
          const value = unit(c).times(it.rarity === 'raro' ? 1.5 : it.rarity === 'non-comune' ? 0.85 : 0.45).times(0.5).times(3).floor();
          c.equipment.unequip(idx); c.run.addGold(value);
          return `${it.name} sparisce nel cappuccio. Oro in cambio.`;
        } },
      { label: 'Declina', hint: 'Non succede niente', apply: () => 'La figura svanisce.' }
    ]
  },
  {
    id: 'santuario', icon: '🗿', title: 'Il Santuario Antico',
    text: 'Una statua di goblin, muschiosa e sorridente. Ai suoi piedi, resti di offerte.',
    options: [
      { label: 'Prega', hint: 'Recuperi il 30% degli HP', apply: c => { gainHp(c, 0.3); return 'Una calma strana. +30% HP.'; } },
      { label: 'Lascia un\'offerta (½ bottino)', hint: '+8% Forza per sempre', blocked: needGold(0.5),
        apply: c => { c.run.spendGold(unit(c).times(0.5).floor(), false); c.stats.str = c.stats.str.times(1.08); return 'La statua sembra annuire. Forza +8%.'; } }
    ]
  }
];

export function pickEvent(rng: RNG, seen: readonly string[]): EventDef {
  const fresh = EVENTS.filter(e => !seen.includes(e.id));
  const pool = fresh.length > 0 ? fresh : EVENTS;
  return pool[Math.floor(rng.next() * pool.length)]!;
}
