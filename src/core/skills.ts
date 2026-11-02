import Decimal from 'break_infinity.js';
import { SkillDefinition, SkillId } from './types';

/* ============================================================
 * Le 4 Skill fisse di classe (MVP Specs §3 — Opzione A)
 *
 * I moltiplicatori sono fortemente differenziati per valorizzare
 * facce diverse: skillMod agisce in Fase 3 della pipeline, quindi
 * scala LINEARMENTE il risultato già esponenziale della Fase 2.
 * ============================================================ */

export const SKILLS: Record<SkillId, SkillDefinition> = {
  [SkillId.SGANCIO_BRUTALE]: {
    id: SkillId.SGANCIO_BRUTALE,
    name: 'Sgancio Brutale',
    skillMod: new Decimal(1.5), // attacco puro: mod piatto elevato
    convertsToShield: false,
    poisonRatio: null,
    poisonTurns: 0,
    comboPower: 1
  },
  [SkillId.SCUDO_GOBLIN]: {
    id: SkillId.SCUDO_GOBLIN,
    name: 'Scudo del Goblin',
    skillMod: new Decimal(1), // il danno calcolato diventa Punti Scudo
    convertsToShield: true,
    poisonRatio: null,
    poisonTurns: 0,
    comboPower: 1
  },
  [SkillId.SPUTO_ACIDO]: {
    id: SkillId.SPUTO_ACIDO,
    name: 'Sputo Acido',
    skillMod: new Decimal(1),
    convertsToShield: false,
    poisonRatio: new Decimal(0.2), // 20% del danno come Veleno
    poisonTurns: 3,                // per 3 turni
    comboPower: 1
  },
  [SkillId.COLPO_COMBO]: {
    id: SkillId.COLPO_COMBO,
    name: 'Colpo Combo',
    skillMod: new Decimal(0.8), // un po' meno danno di base...
    convertsToShield: false,
    poisonRatio: null,
    poisonTurns: 0,
    comboPower: 2 // ...ma la combinazione di dadi vale al quadrato
  }
};
