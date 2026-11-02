/* ============================================================
 * Catalogo sprite (sprite a 64 px generate col rig 3D di Arcana Siege)
 *
 * Ogni PNG è una striscia orizzontale di frame QUADRATI: il numero
 * di frame è larghezza/altezza. Gli URL sono incorporati come data
 * URI (?inline) così funzionano anche nella build a file singolo.
 * I cambi di colore NON modificano i file: si applicano via CSS
 * filter (vedi `tints`), così una sprite vale molte varianti.
 * ============================================================ */
import hero from '../assets/sprites/hero.png?inline';
import hero_attack from '../assets/sprites/hero_attack.png?inline';
import hero_hurt from '../assets/sprites/hero_hurt.png?inline';
import knight from '../assets/sprites/knight.png?inline';
import paladin from '../assets/sprites/paladin.png?inline';
import mage from '../assets/sprites/mage.png?inline';
import cleric from '../assets/sprites/cleric.png?inline';
import bard from '../assets/sprites/bard.png?inline';
import rogue from '../assets/sprites/rogue.png?inline';

export interface SpriteDef {
  url: string;
  /** lato del frame in pixel */
  size: number;
  frames: number;
  /** fotogrammi al secondo dell'idle */
  fps: number;
}

export const SPRITES = {
  hero: { url: hero, size: 64, frames: 8, fps: 8 },
  /** una tantum, ~0.42 s (stessa durata delle animazioni dello Stage) */
  hero_attack: { url: hero_attack, size: 64, frames: 6, fps: 14 },
  hero_hurt: { url: hero_hurt, size: 64, frames: 4, fps: 10 },
  knight: { url: knight, size: 64, frames: 8, fps: 8 },
  paladin: { url: paladin, size: 64, frames: 8, fps: 7 },
  mage: { url: mage, size: 64, frames: 8, fps: 7 },
  cleric: { url: cleric, size: 64, frames: 8, fps: 7 },
  bard: { url: bard, size: 64, frames: 8, fps: 8 },
  rogue: { url: rogue, size: 64, frames: 8, fps: 12 }
} satisfies Record<string, SpriteDef>;

export type SpriteId = keyof typeof SPRITES;

/** Cambi di colore (CSS filter) per ricavare varianti dalla stessa sprite */
export const TINTS = {
  none: '',
  champion: 'sepia(0.7) saturate(2.6) hue-rotate(-12deg) drop-shadow(0 0 5px #ffd84c)',
  boss1: 'saturate(1.6) hue-rotate(-35deg) brightness(1.05) drop-shadow(0 0 8px #ff3b3b)',
  boss2: 'saturate(1.8) hue-rotate(60deg) drop-shadow(0 0 8px #7dff9b)',
  boss3: 'saturate(1.7) hue-rotate(35deg) brightness(1.1) drop-shadow(0 0 9px #b86bff)',
  shadow: 'brightness(0.55) saturate(1.3) contrast(1.15)'
} as const;
export type TintId = keyof typeof TINTS;

/** Le 6 classi nemiche (content_specs §1) con la sprite placeholder */
export const CLASS_SPRITES: { name: string; sprite: SpriteId; tint: TintId }[] = [
  { name: 'Guerriero', sprite: 'knight',  tint: 'none' },
  { name: 'Mago',      sprite: 'mage',    tint: 'none' },
  { name: 'Paladino',  sprite: 'paladin', tint: 'none' },
  { name: 'Chierico',  sprite: 'cleric',  tint: 'none' },
  { name: 'Bardo',     sprite: 'bard',    tint: 'none' },
  { name: 'Ladro',     sprite: 'rogue',   tint: 'none' }
];

/** Boss d'Atto con identità fissa (content_specs §2) */
export const ACT_BOSSES: { name: string; sprite: SpriteId; tint: TintId }[] = [
  { name: 'Sir Baldovino il Molesto', sprite: 'knight', tint: 'boss1' },
  { name: 'Madre Ildegonda',          sprite: 'cleric', tint: 'boss2' },
  { name: 'Arcimago Zoltan il Verboso', sprite: 'mage', tint: 'boss3' }
];
