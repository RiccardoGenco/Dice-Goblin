import Decimal from 'break_infinity.js';
import { GoblinDie } from './GoblinDie';
import { CombatantStats, DieFace, FaceType, Rarity } from './types';
import { hydrateCombatantStats, hydrateDecimal, serializeDecimal } from './persistence';
import { RunState, freshRunState } from './RunManager';

/* ============================================================
 * SaveManager — Persistenza run + meta (Piano commit 13)
 *
 * Due chiavi separate su storage:
 *  - RUN_KEY  : la run in corso (cancellata alla sconfitta)
 *  - META_KEY : gli sblocchi PERMANENTI del pool dadi (MVP §1)
 *
 * Tutti i Decimal passano da serializeDecimal/hydrateDecimal
 * (GDD §2.2): mai un JSON.parse grezzo dentro la logica.
 * Lo storage è iniettabile: nei test si usa uno stub in memoria.
 * ============================================================ */

export const RUN_KEY = 'goblin-revenge:run';
export const META_KEY = 'goblin-revenge:meta';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Fallback in memoria per ambienti senza localStorage (test/SSR) */
export function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: k => void map.delete(k)
  };
}

/* ---------- Formati serializzati (solo primitive) ---------- */

interface SavedFace { v: string; t: number }
interface SavedDie { rarity: number; blueprintId?: string; faces: SavedFace[] }
interface SavedRun {
  version: 1;
  run: { act: number; encounter: number; gold: string; purchases: number };
  playerStats: { str: string; int: string; vit: string; lck: number };
  bag: SavedDie[];
  equipmentIds: string[];
}

export interface RunSnapshot {
  run: RunState;
  playerStats: CombatantStats;
  bag: GoblinDie[];
  equipmentIds: string[];
}

/* ---------- Serializzazione dadi ---------- */

export function serializeDie(die: GoblinDie): SavedDie {
  const saved: SavedDie = {
    rarity: die.rarity,
    faces: die.faces.map(f => ({ v: serializeDecimal(f.value), t: f.type }))
  };
  if (die.blueprintId) saved.blueprintId = die.blueprintId;
  return saved;
}

export function hydrateDie(raw: SavedDie): GoblinDie {
  const faces: DieFace[] = raw.faces.map(f => ({
    value: hydrateDecimal(f.v),
    type: f.t as FaceType
  }));
  const die = new GoblinDie(raw.rarity as Rarity, faces);
  if (raw.blueprintId) die.blueprintId = raw.blueprintId;
  return die;
}

/* ---------- Manager ---------- */

export class SaveManager {
  private readonly storage: StorageLike;

  constructor(storage?: StorageLike) {
    this.storage =
      storage ??
      (typeof globalThis.localStorage !== 'undefined'
        ? globalThis.localStorage
        : memoryStorage());
  }

  public hasRun(): boolean {
    return this.storage.getItem(RUN_KEY) !== null;
  }

  public saveRun(snapshot: RunSnapshot): void {
    const payload: SavedRun = {
      version: 1,
      run: {
        act: snapshot.run.act,
        encounter: snapshot.run.encounter,
        gold: serializeDecimal(snapshot.run.gold),
        purchases: snapshot.run.purchases
      },
      playerStats: {
        str: serializeDecimal(snapshot.playerStats.str),
        int: serializeDecimal(snapshot.playerStats.int),
        vit: serializeDecimal(snapshot.playerStats.vit),
        lck: snapshot.playerStats.lck
      },
      bag: snapshot.bag.map(serializeDie),
      equipmentIds: snapshot.equipmentIds
    };
    this.storage.setItem(RUN_KEY, JSON.stringify(payload));
  }

  /** Ritorna null se non c'è un salvataggio o se è corrotto:
   *  mai eccezioni verso il chiamante (fail-safe al boot). */
  public loadRun(): RunSnapshot | null {
    const raw = this.storage.getItem(RUN_KEY);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as SavedRun;
      if (data.version !== 1) return null;
      const run: RunState = {
        act: data.run.act,
        encounter: data.run.encounter,
        gold: hydrateDecimal(data.run.gold),
        purchases: data.run.purchases
      };
      return {
        run,
        playerStats: hydrateCombatantStats(data.playerStats),
        bag: data.bag.map(hydrateDie),
        equipmentIds: data.equipmentIds ?? []
      };
    } catch {
      return null;
    }
  }

  public clearRun(): void {
    this.storage.removeItem(RUN_KEY);
  }

  /* ---- Meta: sblocchi permanenti del pool dadi ---- */

  public loadUnlocks(): string[] {
    const raw = this.storage.getItem(META_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  public addUnlock(blueprintId: string): string[] {
    const unlocks = this.loadUnlocks();
    if (!unlocks.includes(blueprintId)) unlocks.push(blueprintId);
    this.storage.setItem(META_KEY, JSON.stringify(unlocks));
    return unlocks;
  }
}

export { freshRunState };
