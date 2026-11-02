import Decimal from 'break_infinity.js';
import { GoblinDie } from './GoblinDie';
import { scaleShopCost } from './BattleEngine';
import { PURCHASE_INFLATION } from './Shop';
import { FaceEffect, FaceType, Rarity } from './types';
import { EFFECT_META } from './effects';

/* ============================================================
 * Forge — La Forgia dei Dadi (game_flow_specs §9 e §9.bis)
 *
 * Qui si scolpisce la borsa. Quattro servizi, tutti su curva
 * Cost(level) = base * 1.5^level * 1.25^acquisti (GDD §4.2).
 *
 * GUARDRAIL DI BILANCIAMENTO (dove agisce ogni servizio):
 * - Tempra su NORMAL: crescita LINEARE (Fase FLAT). Sicura.
 * - Tempra su MULTIPLIER (+0.5 flat) e Trasmutazione: agiscono
 *   sulla Fase MULT, cioè sulla BASE dell'esponenziale. Per
 *   questo Trasmutazione costa 3x la Tempra e vige il cap di
 *   MAX_SPECIAL_FACES (3) facce non-NORMAL per dado: un dado
 *   "tutto moltiplicatore" romperebbe la curva nemici 1.6^lv.
 * - Fusione: qualità in cambio di quantità (borsa -1 dado =
 *   meno lanci/turno). Trade-off reale, non potere gratis.
 * - Riforgiatura (solo Gran Forgia): potenzia la Fase FLAT in
 *   blocco. Forte ma lineare: non tocca l'esponenziale.
 * ============================================================ */

export const MAX_SPECIAL_FACES = 3;
export const OPS_PER_VISIT = 2;
export const OPS_PER_VISIT_SPECIAL = 3; // Gran Forgia

export type ForgeServiceKind = 'tempra' | 'trasmutazione' | 'fusione' | 'riforgiatura' | 'incanto';

const BASE_COST: Record<ForgeServiceKind, number> = {
  tempra: 30,
  trasmutazione: 40, // TUNING: 90 -> 40; dimezzata nella Gran Forgia
  fusione: 60,
  riforgiatura: 70, // esclusiva della Gran Forgia
  incanto: 35
};

export type ForgeOperation =
  | { kind: 'tempra'; dieIndex: number; faceIndex: number }
  | { kind: 'trasmutazione'; dieIndex: number; faceIndex: number; target: FaceType }
  | { kind: 'fusione'; targetIndex: number; sacrificeIndex: number }
  | { kind: 'riforgiatura'; dieIndex: number }
  | { kind: 'incanto'; dieIndex: number; faceIndex: number; effect: FaceEffect };

export interface ForgeContext {
  level: number;
  purchases: number;
  /** true = Gran Forgia (post boss fight) */
  special: boolean;
}

export interface ForgeQuote {
  ok: boolean;
  cost: Decimal;
  /** Motivo del rifiuto, se ok=false */
  reason?: string;
  /** Anteprima prima/dopo, se ok=true */
  preview?: string;
}

/** Valori iniziali delle facce appena trasmutate */
const TRANSMUTE_VALUE: Partial<Record<FaceType, number>> = {
  [FaceType.MULTIPLIER]: 2, // TUNING: 1.5 -> 2 (leva esponenziale reale)
  [FaceType.RECURSIVE]: 1,
  [FaceType.BUFF_STR]: 2
};

export function specialFaceCount(die: GoblinDie): number {
  return die.faces.filter(f => f.type !== FaceType.NORMAL).length;
}

/** Punteggio per determinare la faccia migliore/peggiore (Fusione).
 *  Le MULTIPLIER dominano (agiscono sull'esponenziale), poi le
 *  RECURSIVE, poi le BUFF_STR, infine le NORMAL per valore. */
function faceScore(face: { value: Decimal; type: FaceType; effect?: FaceEffect | undefined }): number {
  const v = Math.min(face.value.toNumber(), 1e6);
  switch (face.type) {
    case FaceType.MULTIPLIER: return 1000 + v;
    case FaceType.RECURSIVE: return 500;
    case FaceType.BUFF_STR: return 300 + v;
    default: return face.effect ? v + 50 : v;
  }
}

export class Forge {
  public opsPerVisit(special: boolean): number {
    return special ? OPS_PER_VISIT_SPECIAL : OPS_PER_VISIT;
  }

  public cost(kind: ForgeServiceKind, ctx: ForgeContext): Decimal {
    let base = BASE_COST[kind];
    // Gran Forgia: l'operazione più potente diventa accessibile
    // SOLO nei momenti giusti della run (dopo le boss fight)
    if (kind === 'trasmutazione' && ctx.special) base = base / 2;
    return scaleShopCost(new Decimal(base), ctx.level)
      .times(new Decimal(PURCHASE_INFLATION).pow(ctx.purchases))
      .floor();
  }

  /* ---------------- Preventivi (validazione) ---------------- */

  public quote(op: ForgeOperation, bag: GoblinDie[], ctx: ForgeContext): ForgeQuote {
    switch (op.kind) {
      case 'tempra': return this.quoteTempra(op, bag, ctx);
      case 'trasmutazione': return this.quoteTrasmutazione(op, bag, ctx);
      case 'fusione': return this.quoteFusione(op, bag, ctx);
      case 'riforgiatura': return this.quoteRiforgiatura(op, bag, ctx);
      case 'incanto': return this.quoteIncanto(op, bag, ctx);
    }
  }

  private quoteIncanto(
    op: Extract<ForgeOperation, { kind: 'incanto' }>,
    bag: GoblinDie[],
    ctx: ForgeContext
  ): ForgeQuote {
    const face = bag[op.dieIndex]?.faces[op.faceIndex];
    if (!face) return this.reject('incanto', ctx, 'Faccia non valida');
    if (face.type !== FaceType.NORMAL) {
      return this.reject('incanto', ctx, 'Solo le facce NORMALI si incantano');
    }
    if (face.effect === op.effect) {
      return this.reject('incanto', ctx, 'La faccia ha già questo effetto');
    }
    const meta = EFFECT_META[op.effect];
    return {
      ok: true,
      cost: this.cost('incanto', ctx),
      preview: `${face.value.toString()} → ${meta.icon} ${meta.name} ${face.value.toString()}`
    };
  }

  private reject(kind: ForgeServiceKind, ctx: ForgeContext, reason: string): ForgeQuote {
    return { ok: false, cost: this.cost(kind, ctx), reason };
  }

  private quoteTempra(
    op: Extract<ForgeOperation, { kind: 'tempra' }>,
    bag: GoblinDie[],
    ctx: ForgeContext
  ): ForgeQuote {
    const face = bag[op.dieIndex]?.faces[op.faceIndex];
    if (!face) return this.reject('tempra', ctx, 'Faccia non valida');
    if (face.type === FaceType.RECURSIVE) {
      return this.reject('tempra', ctx, 'Le facce ↻ non si temprano');
    }
    const after =
      face.type === FaceType.MULTIPLIER
        ? `×${face.value.plus(0.5).toString()}`
        : face.value.times(1.5).floor().toString();
    const before = face.type === FaceType.MULTIPLIER ? `×${face.value.toString()}` : face.value.toString();
    return { ok: true, cost: this.cost('tempra', ctx), preview: `${before} → ${after}` };
  }

  private quoteTrasmutazione(
    op: Extract<ForgeOperation, { kind: 'trasmutazione' }>,
    bag: GoblinDie[],
    ctx: ForgeContext
  ): ForgeQuote {
    const die = bag[op.dieIndex];
    const face = die?.faces[op.faceIndex];
    if (!die || !face) return this.reject('trasmutazione', ctx, 'Faccia non valida');
    if (face.type !== FaceType.NORMAL) {
      return this.reject('trasmutazione', ctx, 'Solo le facce NORMALI si trasmutano');
    }
    if (op.target === FaceType.NORMAL || TRANSMUTE_VALUE[op.target] === undefined) {
      return this.reject('trasmutazione', ctx, 'Tipo di destinazione non valido');
    }
    if (specialFaceCount(die) >= MAX_SPECIAL_FACES) {
      // IL guardrail: mai più di 3 facce non-NORMAL per dado
      return this.reject('trasmutazione', ctx, `Cap raggiunto: max ${MAX_SPECIAL_FACES} facce speciali per dado`);
    }
    const label =
      op.target === FaceType.MULTIPLIER ? '×2' :
      op.target === FaceType.RECURSIVE ? '↻' : '+STR 2';
    return {
      ok: true,
      cost: this.cost('trasmutazione', ctx),
      preview: `${face.value.toString()} → ${label}`
    };
  }

  private quoteFusione(
    op: Extract<ForgeOperation, { kind: 'fusione' }>,
    bag: GoblinDie[],
    ctx: ForgeContext
  ): ForgeQuote {
    if (bag.length < 2) return this.reject('fusione', ctx, 'Servono almeno 2 dadi');
    if (op.targetIndex === op.sacrificeIndex) {
      return this.reject('fusione', ctx, 'Un dado non può fondersi con sé stesso');
    }
    const target = bag[op.targetIndex];
    const sacrifice = bag[op.sacrificeIndex];
    if (!target || !sacrifice) return this.reject('fusione', ctx, 'Dado non valido');

    const best = this.bestFace(sacrifice);
    const worstIdx = this.worstFaceIndex(target);
    const worst = target.faces[worstIdx]!;

    // La faccia ereditata non può sfondare il cap delle speciali
    const resultingSpecials =
      specialFaceCount(target) -
      (worst.type !== FaceType.NORMAL ? 1 : 0) +
      (best.type !== FaceType.NORMAL ? 1 : 0);
    if (resultingSpecials > MAX_SPECIAL_FACES) {
      return this.reject('fusione', ctx, `La fusione supererebbe il cap di ${MAX_SPECIAL_FACES} facce speciali`);
    }

    const fmt = (f: { value: Decimal; type: FaceType }) =>
      f.type === FaceType.MULTIPLIER ? `×${f.value.toString()}` :
      f.type === FaceType.RECURSIVE ? '↻' :
      f.type === FaceType.BUFF_STR ? `+STR ${f.value.toString()}` : f.value.toString();
    return {
      ok: true,
      cost: this.cost('fusione', ctx),
      preview: `Eredita ${fmt(best)} al posto di ${fmt(worst)}, rarità +1. Il dado sacrificato sparisce`
    };
  }

  private quoteRiforgiatura(
    op: Extract<ForgeOperation, { kind: 'riforgiatura' }>,
    bag: GoblinDie[],
    ctx: ForgeContext
  ): ForgeQuote {
    if (!ctx.special) {
      return this.reject('riforgiatura', ctx, 'Disponibile solo nella Gran Forgia');
    }
    const die = bag[op.dieIndex];
    if (!die) return this.reject('riforgiatura', ctx, 'Dado non valido');
    const normals = die.faces.filter(f => f.type === FaceType.NORMAL).length;
    if (normals === 0) {
      return this.reject('riforgiatura', ctx, 'Nessuna faccia NORMALE da riforgiare');
    }
    return {
      ok: true,
      cost: this.cost('riforgiatura', ctx),
      preview: `Tutte le ${normals} facce NORMALI ×1.25`
    };
  }

  /* ---------------- Applicazione (assume quote ok) ---------------- */

  public apply(op: ForgeOperation, bag: GoblinDie[]): void {
    switch (op.kind) {
      case 'tempra': {
        const face = bag[op.dieIndex]!.faces[op.faceIndex]!;
        face.value =
          face.type === FaceType.MULTIPLIER
            ? face.value.plus(0.5)
            : face.value.times(1.5).floor();
        break;
      }
      case 'trasmutazione': {
        const face = bag[op.dieIndex]!.faces[op.faceIndex]!;
        face.type = op.target;
        face.effect = undefined; // l'incanto vale solo sulle facce NORMALI
        face.value = new Decimal(TRANSMUTE_VALUE[op.target]!);
        break;
      }
      case 'fusione': {
        const target = bag[op.targetIndex]!;
        const sacrifice = bag[op.sacrificeIndex]!;
        const best = this.bestFace(sacrifice);
        const worstIdx = this.worstFaceIndex(target);
        target.faces[worstIdx] = { value: new Decimal(best.value), type: best.type, effect: best.effect };
        target.rarity = Math.min(target.rarity + 1, Rarity.LEGGENDARIO) as Rarity;
        bag.splice(op.sacrificeIndex, 1); // la borsa perde un dado
        break;
      }
      case 'incanto': {
        bag[op.dieIndex]!.faces[op.faceIndex]!.effect = op.effect;
        break;
      }
      case 'riforgiatura': {
        for (const face of bag[op.dieIndex]!.faces) {
          if (face.type === FaceType.NORMAL) {
            face.value = face.value.times(1.25).floor();
          }
        }
        break;
      }
    }
  }

  private bestFace(die: GoblinDie): { value: Decimal; type: FaceType; effect?: FaceEffect | undefined } {
    return die.faces.reduce((a, b) => (faceScore(b) > faceScore(a) ? b : a));
  }

  private worstFaceIndex(die: GoblinDie): number {
    let idx = 0;
    for (let i = 1; i < die.faces.length; i++) {
      if (faceScore(die.faces[i]!) < faceScore(die.faces[idx]!)) idx = i;
    }
    return idx;
  }
}
