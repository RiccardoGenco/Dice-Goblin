import Decimal from 'break_infinity.js';
import { DieFace, FaceType, Rarity, RNG, defaultRNG } from './types';

/* ============================================================
 * GoblinDie — Il dado del giocatore (GDD §3.2)
 *
 * Il risultato è deciso QUI, a monte: il motore 3D (Fisica
 * Guidata, Approccio B) riceve la faccia già estratta e si
 * limita a "recitare" il lancio. Logica e grafica restano
 * completamente disaccoppiate.
 * ============================================================ */

/** Pesi base dell'estrazione: le facce forti sono rare per design */
const BASE_WEIGHT_NORMAL = 5.0;
const BASE_WEIGHT_SPECIAL = 1.0;
const LCK_SLOPE = 0.15;
const LCK_MAX_FACTOR = 2.0;

export class GoblinDie {
  public readonly id: string;
  public rarity: Rarity;
  public faces: DieFace[];
  /** Id del blueprint di catalogo, se il dado proviene dal pool
   *  sbloccabile (usato da shop e salvataggi). */
  public blueprintId?: string;

  constructor(
    rarity: Rarity,
    customFaces?: DieFace[],
    private readonly rng: RNG = defaultRNG
  ) {
    this.id = globalThis.crypto?.randomUUID?.() ?? `die-${Math.random().toString(36).slice(2)}`;
    this.rarity = rarity;
    this.faces = customFaces ?? this.generateStandardFaces();
  }

  /**
   * Estrazione pesata di una faccia.
   *
   * SCALING & FORTUNA: la Fortuna (lck) MOLTIPLICA il peso delle sole
   * facce non-NORMAL, con crescita logaritmica e tetto:
   *
   *   fattore = min(LCK_MAX_FACTOR, 1 + LCK_SLOPE * ln(1 + lck))
   *
   * Ordine di grandezza: lck 10 -> x1.36, lck 100 -> x1.69, tetto x2.
   * La Fortuna aiuta ma non rende certe le facce MULTIPLIER/RECURSIVE:
   * componendosi moltiplicativamente nella pipeline danno, farebbero
   * esplodere lo scaling esponenziale fuori dalla curva HP nemici.
   * (La versione precedente SOMMAVA un bonus ~12 a peso base 1: a lck 10
   * la probabilita' di una faccia speciale passava dal 4% al 35%.)
   */
  public roll(lckModifier: number): DieFace {
    const lckFactor = Math.min(
      LCK_MAX_FACTOR,
      1 + LCK_SLOPE * Math.log1p(Math.max(0, lckModifier))
    );

    const weights = this.faces.map(face => {
      const baseWeight =
        face.type === FaceType.MULTIPLIER || face.type === FaceType.RECURSIVE
          ? BASE_WEIGHT_SPECIAL
          : BASE_WEIGHT_NORMAL;

      // La fortuna spinge solo le facce non-NORMAL
      return face.type !== FaceType.NORMAL
        ? baseWeight * lckFactor
        : baseWeight;
    });

    // Weighted Random Selection (RNG iniettato -> testabile/riproducibile)
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let randomValue = this.rng.next() * totalWeight;

    for (let i = 0; i < this.faces.length; i++) {
      randomValue -= weights[i]!;
      if (randomValue <= 0) {
        return this.faces[i]!;
      }
    }
    return this.faces[0]!;
  }

  /** Dado standard 1-6: facce NORMAL con valori crescenti,
   *  scalate leggermente dalla rarità. */
  private generateStandardFaces(): DieFace[] {
    const rarityBonus = 1 + this.rarity * 0.25; // COMUNE=1x ... LEGGENDARIO=2x
    const faces: DieFace[] = [];
    for (let v = 1; v <= 6; v++) {
      faces.push({
        value: new Decimal(v).times(rarityBonus),
        type: FaceType.NORMAL
      });
    }
    return faces;
  }
}
