/* ============================================================
 * Catalogo sprite (PLACEHOLDER da Arcana Siege)
 *
 * Ogni PNG è una striscia orizzontale di frame QUADRATI: il numero
 * di frame è larghezza/altezza. Gli URL sono incorporati come data
 * URI (?inline) così funzionano anche nella build a file singolo.
 * I cambi di colore NON modificano i file: si applicano via CSS
 * filter (vedi `tints`), così una sprite vale molte varianti.
 * ============================================================ */
import hero from '../assets/sprites/hero.png?inline';
import knight from '../assets/sprites/knight.png?inline';
import mender from '../assets/sprites/mender.png?inline';
import moth from '../assets/sprites/moth.png?inline';
import runner from '../assets/sprites/runner.png?inline';
import bard from '../assets/sprites/bard.png?inline';
import rogue from '../assets/sprites/rogue.png?inline';
import orc from '../assets/sprites/orc.png?inline';
import gargoyle from '../assets/sprites/gargoyle.png?inline';
import wyvern from '../assets/sprites/wyvern.png?inline';
import skull from '../assets/sprites/skull.png?inline';
import heavy from '../assets/sprites/heavy.png?inline';
import troll from '../assets/sprites/troll.png?inline';

export interface SpriteDef {
  url: string;
  /** lato del frame in pixel */
  size: number;
  frames: number;
  /** fotogrammi al secondo dell'idle */
  fps: number;
}

export const SPRITES = {
  hero:     { url: hero,     size: 32, frames: 8, fps: 8 },
  knight:   { url: knight,   size: 32, frames: 8, fps: 8 },
  mender:   { url: mender,   size: 32, frames: 8, fps: 7 },
  moth:     { url: moth,     size: 32, frames: 8, fps: 10 },
  runner:   { url: runner,   size: 32, frames: 8, fps: 12 },
  bard:     { url: bard,     size: 32, frames: 8, fps: 8 },
  rogue:    { url: rogue,    size: 32, frames: 8, fps: 12 },
  orc:      { url: orc,      size: 32, frames: 8, fps: 7 },
  gargoyle: { url: gargoyle, size: 64, frames: 8, fps: 8 },
  wyvern:   { url: wyvern,   size: 64, frames: 8, fps: 8 },
  skull:    { url: skull,    size: 24, frames: 8, fps: 9 },
  heavy:    { url: heavy,    size: 22, frames: 6, fps: 6 },
  troll:    { url: troll,    size: 34, frames: 6, fps: 5 }
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
  { name: 'Guerriero', sprite: 'knight', tint: 'none' },
  { name: 'Mago',      sprite: 'skull',  tint: 'none' },
  { name: 'Paladino',  sprite: 'heavy',  tint: 'none' },
  { name: 'Chierico',  sprite: 'mender', tint: 'none' },
  { name: 'Bardo',     sprite: 'bard',   tint: 'none' },
  { name: 'Ladro',     sprite: 'rogue',  tint: 'none' }
];

/** Boss d'Atto con identità fissa (content_specs §2) */
export const ACT_BOSSES: { name: string; sprite: SpriteId; tint: TintId }[] = [
  { name: 'Sir Baldovino il Molesto', sprite: 'knight', tint: 'boss1' },
  { name: 'Madre Ildegonda',          sprite: 'mender', tint: 'boss2' },
  { name: 'Arcimago Zoltan il Verboso', sprite: 'skull', tint: 'boss3' }
];
