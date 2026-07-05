import Decimal from 'break_infinity.js';
import { GoblinDie } from './GoblinDie';
import { DieFace, FaceType, Rarity } from './types';

/* ============================================================
 * diceCatalog — Sblocchi orizzontali (MVP Specs §1, Opzione C)
 *
 * La vittoria di un Atto sblocca STABILMENTE un nuovo dado nel
 * pool comune delle run successive. Gli sblocchi sono ORIZZONTALI:
 * arricchiscono la varietà strategica senza toccare il potere
 * iniziale del giocatore, preservando il bilanciamento matematico
 * (le curve 1.6^lv / 1.5^lv restano valide per ogni run).
 * ============================================================ */

export interface FaceBlueprint {
  value: number;
  type: FaceType;
}

export interface DieBlueprint {
  id: string;
  name: string;
  icon: string;
  description: string;
  rarity: Rarity;
  faces: FaceBlueprint[]; // sempre 6
}

/** Un dado sbloccabile per ogni Atto completato */
export const UNLOCKABLE_DICE: DieBlueprint[] = [
  {
    id: 'dado-dorato',
    name: 'Dado Dorato',
    icon: '🟡',
    description: 'Due facce moltiplicatore: carburante esponenziale puro',
    rarity: Rarity.EPICO,
    faces: [
      { value: 6, type: FaceType.NORMAL },
      { value: 8, type: FaceType.NORMAL },
      { value: 10, type: FaceType.NORMAL },
      { value: 12, type: FaceType.NORMAL },
      { value: 2, type: FaceType.MULTIPLIER },
      { value: 2.5, type: FaceType.MULTIPLIER }
    ]
  },
  {
    id: 'dado-ricorsivo',
    name: 'Dado Ricorsivo',
    icon: '🌀',
    description: 'Tre facce ↻: alimenta le reazioni a catena (e il Dopamine Cap)',
    rarity: Rarity.EPICO,
    faces: [
      { value: 4, type: FaceType.NORMAL },
      { value: 6, type: FaceType.NORMAL },
      { value: 8, type: FaceType.NORMAL },
      { value: 1, type: FaceType.RECURSIVE },
      { value: 1, type: FaceType.RECURSIVE },
      { value: 1, type: FaceType.RECURSIVE }
    ]
  },
  {
    id: 'dado-colossale',
    name: 'Dado Colossale',
    icon: '💎',
    description: 'Moltiplicatori enormi e +STR: il premio dell\'ultimo Atto',
    rarity: Rarity.LEGGENDARIO,
    faces: [
      { value: 20, type: FaceType.NORMAL },
      { value: 30, type: FaceType.NORMAL },
      { value: 5, type: FaceType.BUFF_STR },
      { value: 3, type: FaceType.MULTIPLIER },
      { value: 4, type: FaceType.MULTIPLIER },
      { value: 1, type: FaceType.RECURSIVE }
    ]
  }
];

/** Mappa Atto completato -> id del dado sbloccato */
export const UNLOCK_BY_ACT: Record<number, string> = {
  1: 'dado-dorato',
  2: 'dado-ricorsivo',
  3: 'dado-colossale'
};

export function getBlueprint(id: string): DieBlueprint | undefined {
  return UNLOCKABLE_DICE.find(bp => bp.id === id);
}

/** Istanzia un GoblinDie reale dal blueprint del catalogo */
export function createDieFromBlueprint(bp: DieBlueprint): GoblinDie {
  const faces: DieFace[] = bp.faces.map(f => ({
    value: new Decimal(f.value),
    type: f.type
  }));
  const die = new GoblinDie(bp.rarity, faces);
  die.blueprintId = bp.id;
  return die;
}
