import { ICON_BY_EMOJI, IconDef } from './iconData';

/** Pezzo di testo: stringa semplice o icona */
export type Piece = string | IconDef;

const KEYS = Object.keys(ICON_BY_EMOJI).sort((a, b) => b.length - a.length);
const RX = new RegExp(`(${KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'u');

export function iconFor(emoji: string): IconDef | undefined {
  return ICON_BY_EMOJI[emoji.replace(/️/g, '')];
}

/** Spezza un testo sostituendo le emoji note con le icone pixel/RPG del gioco */
export function splitIcons(text: string): Piece[] {
  const clean = text.replace(/️/g, '');
  return clean.split(RX).filter(p => p !== '').map(p => ICON_BY_EMOJI[p] ?? p);
}

/** Percorso SVG di un'emoji per il canvas (Path2D) */
export function iconPath(emoji: string): IconDef | undefined {
  return iconFor(emoji);
}
