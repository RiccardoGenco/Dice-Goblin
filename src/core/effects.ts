import Decimal from 'break_infinity.js';
import { DieFace, FaceEffect } from './types';

/* ============================================================
 * Effetti delle facce e reazioni (design_evolution.md, Fase A2)
 *
 * Una faccia NORMALE può essere incantata con un effetto: oltre ad
 * aggiungere il suo valore al danno, quando esce fa qualcosa in più,
 * con potenza pari al proprio valore (quindi Tempra e Riforgiatura
 * la rinforzano):
 *
 *   ☠ Veleno : veleno al nemico, `valore` per turno
 *   🛡 Scudo  : scudo per il goblin, `valore`
 *   🔥 Fuoco  : danno diretto al nemico, `valore × 2`, ignora lo scudo
 *
 * Se nello stesso lancio escono effetti diversi, REAGISCONO:
 *
 *   ☠+🔥 Vapori        : il veleno scoppia subito (un tick immediato)
 *   🛡+🔥 Scudo ardente : lo scudo guadagnato brucia il nemico, stesso valore
 *   ☠+🛡 Spore         : il veleno dura 2 turni in più
 * ============================================================ */

export const EFFECT_META: Record<FaceEffect, { icon: string; name: string }> = {
  veleno: { icon: '☠', name: 'Veleno' },
  scudo: { icon: '🛡', name: 'Scudo' },
  fuoco: { icon: '🔥', name: 'Fuoco' }
};

export const FIRE_DAMAGE_FACTOR = 2;
export const POISON_BASE_TURNS = 3;
export const SPORE_EXTRA_TURNS = 2;

export type ReactionId = 'vapori' | 'scudo-ardente' | 'spore';

export interface ReactionMeta { id: ReactionId; name: string; icon: string; text: string }

export const REACTIONS: Record<ReactionId, ReactionMeta> = {
  'vapori': { id: 'vapori', name: 'Vapori', icon: '☠🔥', text: 'il veleno scoppia subito' },
  'scudo-ardente': { id: 'scudo-ardente', name: 'Scudo ardente', icon: '🛡🔥', text: 'lo scudo brucia il nemico' },
  'spore': { id: 'spore', name: 'Spore', icon: '☠🛡', text: 'veleno più duraturo' }
};

export interface EffectSummary {
  /** veleno per turno da applicare */
  poison: Decimal;
  /** scudo da guadagnare */
  shield: Decimal;
  /** danno diretto del fuoco (già moltiplicato) */
  fire: Decimal;
  reactions: ReactionMeta[];
}

/** Somma gli effetti di tutte le facce uscite e ricava le reazioni */
export function summarizeEffects(faces: readonly DieFace[]): EffectSummary {
  let poison = new Decimal(0);
  let shield = new Decimal(0);
  let fire = new Decimal(0);
  for (const f of faces) {
    if (!f.effect) continue;
    if (f.effect === 'veleno') poison = poison.plus(f.value);
    else if (f.effect === 'scudo') shield = shield.plus(f.value);
    else if (f.effect === 'fuoco') fire = fire.plus(f.value.times(FIRE_DAMAGE_FACTOR));
  }
  const reactions: ReactionMeta[] = [];
  if (poison.gt(0) && fire.gt(0)) reactions.push(REACTIONS['vapori']);
  if (shield.gt(0) && fire.gt(0)) reactions.push(REACTIONS['scudo-ardente']);
  if (poison.gt(0) && shield.gt(0)) reactions.push(REACTIONS['spore']);
  return { poison, shield, fire, reactions };
}
