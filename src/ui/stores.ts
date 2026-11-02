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
/** Prossimi intenti dello schema del nemico (dopo quello corrente) */
export const intentQueue = writable<IntentView[]>([]);
/** Regola speciale del boss, se c'è */
export const bossRuleText = writable<string>('');
export const battleState = writable<BattleState>(BattleState.INIT_TURN);
export const rolledChips = writable<DieChip[]>([]);
export const overflowActive = writable(false);
/** Effetti delle facce uscite e reazioni che ne nascono (null prima del lancio) */
export interface EffectsView {
  poison: string | null;
  shield: string | null;
  fire: string | null;
  reactions: { id: string; name: string; icon: string; text: string }[];
}
export const effectsView = writable<EffectsView | null>(null);
/** Rilanci gratuiti ancora disponibili nel turno */
export const rerollsLeft = writable(0);
/** true mentre i dadi 3D sono in movimento dopo un rilancio */
export const diceBusy = writable(false);
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
  rarity?: string;
  note?: string;
  /** true per Pozione/Elisir: vanno in una riga a parte */
  service?: boolean;
}

/** 'battle' = combattimento; 'crossroad' = bivio a due porte;
 *  'shop'/'forge' = intermezzi; 'run-complete' = terzo boss. */
export const uiPhase = writable<'battle' | 'crossroad' | 'shop' | 'forge' | 'run-complete'>('battle');
export const goldView = writable('0');
/** Posizione nella run, per la barra di progresso (10 incontri per Atto) */
export const runProgress = writable({ act: 1, encounter: 1 });
export const runLabel = writable('Atto 1 — 1/10');
export const shopOffers = writable<ShopOfferView[]>([]);
/** Stato del banco: costo del prossimo rilancio e HP attuali (per decidere se curarsi) */
export const shopInfo = writable({ rerollCost: '0', canReroll: false, rerolls: 0, hp: '100%' });
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
/** Avvisi sulle carte: colpo letale, scudo sprecato contro un intento che non attacca */
export const skillHints = writable<Record<number, { text: string; kind: 'good' | 'warn' }>>({});
/** Si incrementa a ogni nuovo lancio: ri-innesca le animazioni dei chip */
export const rollNonce = writable(0);

/* ---- Menù iniziale e schermata finale ---- */
export const menuOpen = writable(true);
export interface MenuInfo { hasSave: boolean; inProgress: boolean; saveLabel: string; gold: string; hasLastLog: boolean }
export const menuInfo = writable<MenuInfo>({ hasSave: false, inProgress: false, saveLabel: '', gold: '0', hasLastLog: false });

export interface RunSummaryView {
  outcome: 'sconfitta' | 'vittoria' | 'abbandonata';
  title: string;
  endLabel: string;
  killedBy: string | null;
  rows: [string, string][];
  actions: { name: string; pct: number }[];
  items: { icon: string; name: string }[];
  build: string;
}
export const runSummary = writable<RunSummaryView | null>(null);
