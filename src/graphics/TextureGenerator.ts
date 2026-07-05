import * as THREE from 'three';
import Decimal from 'break_infinity.js';
import { DieFace, FaceType, Rarity } from '@core/types';
import { GoblinDie } from '@core/GoblinDie';

/* ============================================================
 * TextureGenerator — Facce dinamiche su Canvas 2D (GDD §6.3)
 *
 * Ogni dado 3D usa una BoxGeometry con 6 CanvasTexture.
 * PREVENZIONE MEMORY LEAK: canvas e texture vengono allocati UNA
 * volta per faccia e poi RIUTILIZZATI. Quando una faccia viene
 * potenziata si ridisegna il canvas esistente e si invoca
 * texture.needsUpdate = true: nessuna nuova allocazione GPU.
 * ============================================================ */

const TEXTURE_SIZE = 256;

/** Palette per tipo di faccia (coerente con la pipeline danno) */
const FACE_STYLE: Record<FaceType, { bg: string; fg: string; label: string }> = {
  [FaceType.NORMAL]:     { bg: '#2b2b33', fg: '#e8e8f0', label: '' },
  [FaceType.MULTIPLIER]: { bg: '#3d1f4f', fg: '#ff5c8a', label: '×' }, // viola/rosa: esponenziale!
  [FaceType.BUFF_STR]:   { bg: '#1f3d2a', fg: '#7dff9b', label: '+STR' },
  [FaceType.RECURSIVE]:  { bg: '#173a4d', fg: '#5cd0ff', label: '↻' }
};

/** Colore del bordo/glow in base alla rarità del dado */
const RARITY_GLOW: Record<Rarity, string> = {
  [Rarity.COMUNE]: '#8a8a8a',
  [Rarity.NON_COMUNE]: '#4cc94c',
  [Rarity.RARO]: '#4c8bff',
  [Rarity.EPICO]: '#b04cff',
  [Rarity.LEGGENDARIO]: '#ffb84c'
};

/** Formattazione compatta del valore della faccia sul canvas.
 *  Oltre il milione passa alla notazione scientifica: i valori
 *  delle facce scalano esponenzialmente con i potenziamenti. */
function formatFaceValue(value: Decimal): string {
  if (value.lt(1000)) {
    const n = value.toNumber();
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  if (value.lt(1_000_000)) return value.toNumber().toLocaleString('it-IT');
  return value.toStringWithDecimalPlaces(1); // es. "1.5e9"
}

/** Set riutilizzabile di canvas+texture per le 6 facce di un dado */
export class DieTextureSet {
  private readonly canvases: HTMLCanvasElement[] = [];
  private readonly contexts: CanvasRenderingContext2D[] = [];
  public readonly textures: THREE.CanvasTexture[] = [];
  public readonly materials: THREE.MeshStandardMaterial[] = [];

  constructor(private readonly die: GoblinDie) {
    for (let i = 0; i < 6; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = TEXTURE_SIZE;
      canvas.height = TEXTURE_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context non disponibile');

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;

      this.canvases.push(canvas);
      this.contexts.push(ctx);
      this.textures.push(texture);
      this.materials.push(
        new THREE.MeshStandardMaterial({ map: texture, roughness: 0.35, metalness: 0.15 })
      );
    }
    this.redrawAll();
  }

  /** Ridisegna una singola faccia (chiamare dopo un potenziamento).
   *  Riutilizza canvas e texture esistenti: zero nuove allocazioni. */
  public redrawFace(faceIndex: number): void {
    const face = this.die.faces[faceIndex];
    const ctx = this.contexts[faceIndex];
    const texture = this.textures[faceIndex];
    if (!face || !ctx || !texture) return;

    this.drawFace(ctx, face);
    texture.needsUpdate = true; // aggiornamento GPU in-place
  }

  public redrawAll(): void {
    for (let i = 0; i < 6; i++) this.redrawFace(i);
  }

  private drawFace(ctx: CanvasRenderingContext2D, face: DieFace): void {
    const s = TEXTURE_SIZE;
    const style = FACE_STYLE[face.type];
    const glow = RARITY_GLOW[this.die.rarity];

    // Sfondo con vignettatura radiale
    const grad = ctx.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.7);
    grad.addColorStop(0, style.bg);
    grad.addColorStop(1, '#101014');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    // Bordo di rarità (glow)
    ctx.strokeStyle = glow;
    ctx.lineWidth = s * 0.05;
    ctx.shadowColor = glow;
    ctx.shadowBlur = s * 0.08;
    ctx.strokeRect(s * 0.05, s * 0.05, s * 0.9, s * 0.9);
    ctx.shadowBlur = 0;

    // Etichetta del tipo (×, ↻, +STR) in alto
    if (style.label) {
      ctx.fillStyle = style.fg;
      ctx.font = `bold ${s * 0.16}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(style.label, s / 2, s * 0.12);
    }

    // Valore centrale
    ctx.fillStyle = style.fg;
    ctx.font = `bold ${s * 0.34}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const prefix = face.type === FaceType.MULTIPLIER ? '×' : '';
    ctx.fillText(prefix + formatFaceValue(face.value), s / 2, s * 0.58);
  }

  /** Rilascio esplicito delle risorse GPU alla distruzione del dado */
  public dispose(): void {
    this.textures.forEach(t => t.dispose());
    this.materials.forEach(m => m.dispose());
  }
}
