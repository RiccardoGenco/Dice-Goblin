import Decimal from 'break_infinity.js';
import {
  DamageMiddleware,
  DamagePayload,
  DieFace,
  FaceType,
  MiddlewarePhase
} from './types';

/* ============================================================
 * DamagePipeline — The Balatro Math Engine (GDD §4, §7.1)
 *
 * QUI avviene lo scaling esponenziale del gioco:
 *
 *   Fase 1 (FLAT)  : crescita ADDITIVA  -> STR + Σ facce NORMAL
 *   Fase 2 (MULT)  : crescita ESPONENZIALE -> Π facce MULTIPLIER
 *   Fase 3 (SKILL) : vettore mossa      -> * skillMod
 *
 * L'ordine è immutabile: sommare prima e moltiplicare dopo è ciò
 * che fa esplodere i numeri (a+b)*m1*m2, esattamente come i Joker
 * di Balatro. Invertire le fasi romperebbe il bilanciamento.
 * ============================================================ */

export class DamagePipeline {
  /** Middleware registrati per fase. L'ordine tra fasi è rigido
   *  (PRE_ADD -> ADD -> MULT -> POST_MULT); l'ordine interno a una
   *  fase è irrilevante perché le operazioni di una stessa fase
   *  sono tra loro commutative (solo somme, o solo prodotti). */
  private middlewares = new Map<MiddlewarePhase, DamageMiddleware[]>();

  public register(phase: MiddlewarePhase, mw: DamageMiddleware): void {
    const list = this.middlewares.get(phase) ?? [];
    list.push(mw);
    this.middlewares.set(phase, list);
  }

  public clear(): void {
    this.middlewares.clear();
  }

  /**
   * Calcolo del danno del turno (GDD §4 — calculateTurnDamage),
   * esteso con la pipeline dei passivi (GDD §7.1).
   */
  public calculateTurnDamage(
    baseStr: Decimal,
    rolledFaces: DieFace[],
    skillMod: Decimal
  ): Decimal {
    let payload: DamagePayload = {
      baseStr: new Decimal(baseStr),
      flatAdded: new Decimal(0),
      multiplier: new Decimal(1),
      finalDamage: new Decimal(0)
    };

    // --- PRE_ADD: buff flat dei passivi prima di ogni calcolo
    payload = this.run(MiddlewarePhase.PRE_ADD, payload);

    // --- 1. FASE FLAT: somma STR e facce NORMAL (lineare)
    let totalDamage = payload.baseStr.plus(payload.flatAdded);
    for (const face of rolledFaces) {
      if (face.type === FaceType.NORMAL) {
        totalDamage = totalDamage.plus(face.value);
      }
    }

    // --- ADD: flat aggiuntivi legati alla mossa
    payload.finalDamage = totalDamage;
    payload = this.run(MiddlewarePhase.ADD, payload);
    totalDamage = payload.finalDamage;

    // --- 2. FASE MOLTIPLICATIVA (cuore dello scaling esponenziale):
    //     ogni faccia MULTIPLIER moltiplica il TOTALE corrente.
    //     Con k facce x2 il danno cresce come 2^k: per questo si
    //     usa Decimal e per questo esiste il Dopamine Cap sui
    //     dadi ricorsivi che possono generare altre MULTIPLIER.
    for (const face of rolledFaces) {
      if (face.type === FaceType.MULTIPLIER) {
        totalDamage = totalDamage.times(face.value);
      }
    }

    // --- MULT: moltiplicatori percentuali dei passivi
    payload.finalDamage = totalDamage;
    payload = this.run(MiddlewarePhase.MULT, payload);
    totalDamage = payload.finalDamage.times(payload.multiplier);

    // --- 3. FASE VETTORE MOSSA: moltiplicatore dell'abilità scelta
    totalDamage = totalDamage.times(skillMod);

    // --- POST_MULT: effetti finali (lifesteal, riduzioni, cap)
    payload.finalDamage = totalDamage;
    payload = this.run(MiddlewarePhase.POST_MULT, payload);

    return payload.finalDamage;
  }

  private run(phase: MiddlewarePhase, payload: DamagePayload): DamagePayload {
    const list = this.middlewares.get(phase);
    if (!list) return payload;
    return list.reduce((acc, mw) => mw(acc), payload);
  }
}
