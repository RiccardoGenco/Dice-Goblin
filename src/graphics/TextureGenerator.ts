import * as THREE from 'three';
import { DieFace, FaceType, Rarity } from '@core/types';
import { EFFECT_META } from '@core/effects';
import { GoblinDie } from '@core/GoblinDie';
import { formatFaceValue } from '@core/format';
import { iconFor } from '../ui/icons';

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
  [FaceType.MULTIPLIER]: { bg: '#3d1f4f', fg: '#ff5c8a', label: 'MOLT' }, // viola/rosa: esponenziale!
  [FaceType.BUFF_STR]:   { bg: '#1f3d2a', fg: '#7dff9b', label: '+STR' },
  [FaceType.RECURSIVE]:  { bg: '#173a4d', fg: '#5cd0ff', label: '' }
};

const EFFECT_TINT = { veleno: '#7dff4c', scudo: '#4cb4ff', fuoco: '#ff7a2c' } as const;

/** Colore del bordo/glow in base alla rarità del dado */
const RARITY_GLOW: Record<Rarity, string> = {
  [Rarity.COMUNE]: '#8a8a8a',
  [Rarity.NON_COMUNE]: '#4cc94c',
  [Rarity.RARO]: '#4c8bff',
  [Rarity.EPICO]: '#b04cff',
  [Rarity.LEGGENDARIO]: '#ffb84c'
};

/** Set riutilizzabile di canvas+texture per le 6 facce di un dado */
/** Disegna l'icona di un'emoji del gioco (tracciato SVG a 512) centrata in (cx, cy), alta `size` px */
function drawIcon(ctx: CanvasRenderingContext2D, emoji: string, cx: number, cy: number, size: number, color?: string): void {
  const def = iconFor(emoji);
  if (!def) return;
  const k = size / 512;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(k, k);
  ctx.fillStyle = color ?? def.color;
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 6 / k * 0.1;
  ctx.fill(new Path2D(def.d));
  ctx.restore();
}

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

    // Etichetta del tipo (MOLT, ↻, +STR) in alto
    if (style.label) {
      ctx.fillStyle = style.fg;
      ctx.font = `bold ${s * 0.13}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(style.label, s / 2, s * 0.11);
    }

    // Effetto incantato (☠ 🛡 🔥): la faccia prende il colore dell'effetto
    // e l'icona sta in BASSO, per non sovrapporsi all'etichetta del tipo
    if (face.effect) {
      ctx.fillStyle = EFFECT_TINT[face.effect];
      ctx.globalAlpha = 0.28;
      ctx.fillRect(s * 0.05, s * 0.05, s * 0.9, s * 0.9);
      ctx.globalAlpha = 1;
      drawIcon(ctx, EFFECT_META[face.effect].icon, s / 2, s * 0.82, s * 0.2);
    }

    // Valore centrale. La faccia ricorsiva mostra solo ↻ (il suo valore è sempre 1).
    if (face.type === FaceType.RECURSIVE) {
      drawIcon(ctx, '↻', s / 2, face.effect ? s * 0.46 : s * 0.5, s * 0.5, style.fg);
      return;
    }
    const prefix = face.type === FaceType.MULTIPLIER ? '×' : '';
    const text = prefix + formatFaceValue(face.value);
    // Il corpo si restringe finché il testo sta dentro il bordo
    const maxWidth = s * 0.76;
    let size = s * 0.36;
    ctx.font = `bold ${size}px monospace`;
    const w = ctx.measureText(text).width;
    if (w > maxWidth) {
      size = Math.max(s * 0.14, size * (maxWidth / w));
      ctx.font = `bold ${size}px monospace`;
    }
    ctx.fillStyle = style.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, s / 2, face.effect || style.label ? s * 0.54 : s * 0.5);
  }

  /** Rilascio esplicito delle risorse GPU alla distruzione del dado */
  public dispose(): void {
    this.textures.forEach(t => t.dispose());
    this.materials.forEach(m => m.dispose());
  }
}
