import Decimal from 'break_infinity.js';
import { DieFace, FaceType } from './types';
import { EFFECT_META } from './effects';
import { formatBigNumber, formatFaceValue } from './format';
import { hydrateDecimal, serializeDecimal } from './persistence';

/* ============================================================
 * RunLog — il registro della run
 *
 * Ogni scelta e ogni conseguenza finiscono qui in italiano, in ordine:
 * intento del nemico, dadi usciti, rilanci, azione con il calcolo del
 * danno, effetti, reazioni, HP, acquisti, forgia. Serve a ricostruire
 * una partita (e a tarare il gioco sui dati veri). Si salva nel
 * browser e si esporta come testo.
 * ============================================================ */

export type LogKind =
  | 'run' | 'fight' | 'turn' | 'roll' | 'hand' | 'action' | 'effect' | 'enemy'
  | 'result' | 'shop' | 'forge' | 'note';

export interface LogEntry {
  n: number;
  kind: LogKind;
  text: string;
}

/** Contatori della run per la schermata finale */
export interface RunStats {
  fights: number;
  turns: number;
  damageDealt: Decimal;
  maxHit: Decimal;
  damageTaken: Decimal;
  handChanges: number;
  reactions: number;
  actions: Record<string, number>;
  goldEarned: Decimal;
  goldSpent: Decimal;
  itemsBought: number;
  forgeOps: number;
}

export type RunOutcome = 'in-corso' | 'sconfitta' | 'vittoria' | 'abbandonata';

export interface RunMeta {
  id: string;
  startedAt: string;
  endedAt?: string;
  outcome: RunOutcome;
  /** Dove è finita: "Atto 1 — 7/10" */
  endLabel?: string;
  /** Chi ha ucciso il goblin */
  killedBy?: string;
  tuning: Record<string, number | string>;
}

const MAX_ENTRIES = 9000;
const INDENT: Record<LogKind, string> = {
  run: '', fight: '', shop: '', forge: '',
  turn: '  ', result: '  ', note: '  ',
  roll: '    ', hand: '    ', action: '    ', effect: '    ', enemy: '    '
};

export function emptyStats(): RunStats {
  return {
    fights: 0, turns: 0, damageDealt: new Decimal(0), maxHit: new Decimal(0),
    damageTaken: new Decimal(0), handChanges: 0, reactions: 0, actions: {},
    goldEarned: new Decimal(0), goldSpent: new Decimal(0), itemsBought: 0, forgeOps: 0
  };
}

/** Come si legge una faccia nel registro: 6, ☠6, ×2, +2💪, ↻ */
export function faceLabel(f: DieFace): string {
  const v = formatFaceValue(f.value);
  const fx = f.effect ? EFFECT_META[f.effect].icon : '';
  switch (f.type) {
    case FaceType.MULTIPLIER: return `×${v}`;
    case FaceType.BUFF_STR: return `+${v}💪`;
    case FaceType.RECURSIVE: return '↻';
    default: return `${fx}${v}`;
  }
}

export class RunLog {
  public entries: LogEntry[] = [];
  public stats: RunStats = emptyStats();
  public meta: RunMeta;
  private seq = 0;
  private truncated = false;

  constructor(tuning: Record<string, number | string> = {}) {
    this.meta = {
      id: Math.random().toString(36).slice(2, 8),
      startedAt: new Date().toISOString(),
      outcome: 'in-corso',
      tuning
    };
  }

  public add(kind: LogKind, text: string): void {
    this.entries.push({ n: ++this.seq, kind, text });
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, 500);
      this.truncated = true;
    }
  }

  public finish(outcome: RunOutcome, endLabel: string, killedBy?: string): void {
    this.meta.outcome = outcome;
    this.meta.endLabel = endLabel;
    this.meta.endedAt = new Date().toISOString();
    if (killedBy) this.meta.killedBy = killedBy;
  }

  public get finished(): boolean { return this.meta.outcome !== 'in-corso'; }

  /** Testo completo, leggibile e incollabile in una chat */
  public toText(): string {
    const m = this.meta;
    const head = [
      `REGISTRO RUN ${m.id} — Dice Goblin`,
      `Inizio: ${m.startedAt}${m.endedAt ? `  Fine: ${m.endedAt}` : ''}`,
      `Esito: ${m.outcome}${m.endLabel ? ` (${m.endLabel})` : ''}${m.killedBy ? ` — ucciso da ${m.killedBy}` : ''}`,
      `Taratura: ${Object.entries(m.tuning).map(([k, v]) => `${k}=${v}`).join(' ')}`,
      `Incontri ${this.stats.fights}, turni ${this.stats.turns}, danno inflitto ${formatBigNumber(this.stats.damageDealt)}, colpo massimo ${formatBigNumber(this.stats.maxHit)}, danno subito ${formatBigNumber(this.stats.damageTaken)}`,
      `Azioni: ${Object.entries(this.stats.actions).map(([k, v]) => `${k} ${v}`).join(', ') || '—'} | cambi di mano ${this.stats.handChanges} | reazioni ${this.stats.reactions}`,
      this.truncated ? '(registro troncato: le prime righe sono state scartate)' : '',
      ''
    ].filter((l, i, a) => l !== '' || i === a.length - 1);
    const body = this.entries.map(e => `${INDENT[e.kind]}${e.text}`);
    return [...head, ...body].join('\n');
  }

  /* ---------------- Persistenza ---------------- */

  public serialize(): string {
    const s = this.stats;
    return JSON.stringify({
      v: 1, meta: this.meta, seq: this.seq, truncated: this.truncated, entries: this.entries,
      stats: {
        ...s,
        damageDealt: serializeDecimal(s.damageDealt), maxHit: serializeDecimal(s.maxHit),
        damageTaken: serializeDecimal(s.damageTaken), goldEarned: serializeDecimal(s.goldEarned),
        goldSpent: serializeDecimal(s.goldSpent)
      }
    });
  }

  public static deserialize(raw: string | null): RunLog | null {
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      if (d.v !== 1) return null;
      const log = new RunLog(d.meta.tuning);
      log.meta = d.meta;
      log.seq = d.seq;
      log.truncated = !!d.truncated;
      log.entries = d.entries;
      log.stats = {
        ...emptyStats(), ...d.stats,
        damageDealt: hydrateDecimal(d.stats.damageDealt), maxHit: hydrateDecimal(d.stats.maxHit),
        damageTaken: hydrateDecimal(d.stats.damageTaken), goldEarned: hydrateDecimal(d.stats.goldEarned),
        goldSpent: hydrateDecimal(d.stats.goldSpent)
      };
      return log;
    } catch {
      return null;
    }
  }
}

/* ---- Salvataggio nel browser (mai eccezioni verso il gioco) ---- */
const CURRENT_KEY = 'goblin-revenge.runlog.current';
const LAST_KEY = 'goblin-revenge.runlog.last';

function store(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
export function saveCurrentLog(log: RunLog): void {
  try { store()?.setItem(CURRENT_KEY, log.serialize()); } catch { /* quota o modalità privata */ }
}
export function loadCurrentLog(): RunLog | null {
  try { return RunLog.deserialize(store()?.getItem(CURRENT_KEY) ?? null); } catch { return null; }
}
export function saveLastLog(log: RunLog): void {
  try { store()?.setItem(LAST_KEY, log.serialize()); store()?.removeItem(CURRENT_KEY); } catch { /* ignora */ }
}
export function loadLastLog(): RunLog | null {
  try { return RunLog.deserialize(store()?.getItem(LAST_KEY) ?? null); } catch { return null; }
}
