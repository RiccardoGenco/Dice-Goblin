import { writable } from 'svelte/store';
import { BattleState } from '@core/types';
import type { SpriteId, TintId } from './spriteCatalog';

/* ============================================================
 * Store reattivi della UI (GDD §6.2 — DOM Layer)
 *
 * Gli store contengono SOLO viste serializzabili (stringhe già
 * formattate, ratio 0-1, label): nessun Decimal attraversa il
 * confine logica->UI. Il GameManager è l'unico writer.
 * ============================================================ */

export interface CombatantView {
  hp: string;        // già formattato con formatBigNumber
  maxHp: string;
  hpRatio: number;   // 0-1 per la larghezza della barra
  shield: string;    // '0' = nessuno scudo
  poisonTurns: number;
}

export interface IntentView {
  icon: string;
  label: string;
  value: string;
}

export interface DieChip {
  text: string;      // es. "×2", "+STR 5", "12"
  cssClass: string;  // normal | multiplier | buff | recursive
}

export const emptyCombatant = (): CombatantView => ({
  hp: '0',
  maxHp: '0',
  hpRatio: 0,
  shield: '0',
  poisonTurns: 0
});

export const playerView = writable<CombatantView>(emptyCombatant());
export const enemyView = writable<CombatantView>(emptyCombatant());
export const intentView = writable<IntentView | null>(null);
export const battleState = writable<BattleState>(BattleState.INIT_TURN);
export const rolledChips = writable<DieChip[]>([]);
export const overflowActive = writable(false);
/** 'idle' = normale; 'reroll' = Tiro Truccato in attesa di selezione */
export const uiMode = writable<'idle' | 'reroll'>('idle');
export const battleResult = writable<'victory' | 'defeat' | null>(null);
export const actLevel = writable(0);
export const logLines = writable<string[]>([]);
export const equipVersion = writable(0); // bump per ri-renderizzare gli slot

/* ---- Meta-progressione (commit 11-13) ---- */
export interface ShopOfferView {
  id: string;
  icon: string;
  label: string;
  description: string;
  cost: string;
  affordable: boolean;
}

/** 'battle' = combattimento; 'crossroad' = bivio a due porte;
 *  'shop'/'forge' = intermezzi; 'run-complete' = terzo boss. */
export const uiPhase = writable<'battle' | 'crossroad' | 'shop' | 'forge' | 'run-complete'>('battle');
export const goldView = writable('0');
export const runLabel = writable('Atto 1 — 1/10');
export const shopOffers = writable<ShopOfferView[]>([]);
/** true dopo una boss fight: 👑 Mercante Reale (sconto + premium) */
export const shopSpecial = writable(false);

/* ---- Bivio e Forgia (commit 17) ---- */
export interface ForgeQuoteView {
  ok: boolean;
  cost: string;
  reason?: string;
  preview?: string;
}
export interface ForgeDieView {
  icon: string;
  rarityName: string;
  blueprintName: string | null;
  faces: DieChip[];
  specialCount: number;
}
/** true = porte dorate (dopo Campione/Boss) */
export const crossroadSpecial = writable(false);
export const forgeSpecial = writable(false);
export const forgeOpsLeft = writable(0);
/** bump per ricalcolare viste e preventivi della forgia */
export const forgeVersion = writable(0);
export const rewardBanner = writable<string | null>(null);

export function pushLog(line: string): void {
  logLines.update(lines => [line, ...lines].slice(0, 6));
}

/* ---- Palco di combattimento ---- */
export interface EnemyInfo {
  name: string;
  sprite: SpriteId;
  tint: TintId;
  tier: 'normal' | 'champion' | 'boss';
  /** rotazione di tinta (gradi) per differenziare gli incontri normali */
  hue: number;
}
export const enemyInfo = writable<EnemyInfo>({
  name: 'Avventuriero', sprite: 'knight', tint: 'none', tier: 'normal', hue: 0
});

/** Effetto scenico puntuale: il palco lo trasforma in animazioni e numeri */
export interface StageFx {
  id: number;
  /** 'center' = effetti a tutto palco (moltiplicatore, overflow) */
  target: 'player' | 'enemy' | 'center';
  kind: 'hit' | 'shield' | 'poison' | 'mult' | 'overflow';
  text: string;
  /** intensità: log10 del valore per hit/shield, tier 0-4 per mult/overflow */
  power: number;
}
export const stageFx = writable<StageFx | null>(null);
let fxCounter = 0;
export function emitFx(
  target: StageFx['target'], kind: StageFx['kind'], text: string, power = 0
): void {
  stageFx.set({ id: ++fxCounter, target, kind, text, power });
}

/* ---- Catena di dadi: anteprima per il giocatore ---- */
export interface ChainView {
  mult: string;      // prodotto dei moltiplicatori, es. "12"
  tier: number;      // 0-4, intensità scenica
  power: string;     // danno con skill ×1 (equip e overflow inclusi)
  multCount: number;
}
export const chainView = writable<ChainView | null>(null);
/** Anteprima dell'effetto di ogni skill (id numerico -> testo) */
export const skillPreview = writable<Record<number, string>>({});
/** Si incrementa a ogni nuovo lancio: ri-innesca le animazioni dei chip */
export const rollNonce = writable(0);
