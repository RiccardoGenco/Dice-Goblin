import Decimal from 'break_infinity.js';
import { SkillDefinition, SkillId } from './types';

/* ============================================================
 * Le 4 azioni fisse (MVP Specs §3), ognuna per una situazione:
 *  - Sgancio Brutale: il colpo sicuro
 *  - Parata: contro un attacco annunciato
 *  - Bava: veleno forte, ignora scudo, per i combattimenti lunghi
 *  - Carica: salta il turno e tieni il lancio per il prossimo
 *
 * skillMod agisce in Fase 3 della pipeline, quindi scala
 * LINEARMENTE il risultato già esponenziale della Fase 2.
 * ============================================================ */

export const SKILLS: Record<SkillId, SkillDefinition> = {
  [SkillId.SGANCIO_BRUTALE]: {
    id: SkillId.SGANCIO_BRUTALE,
    name: 'Sgancio Brutale',
    skillMod: new Decimal(1.5),
    convertsToShield: false,
    reflectRatio: null,
    poisonRatio: null,
    poisonTurns: 0,
    dealsDamage: true,
    carriesRoll: false
  },
  [SkillId.PARATA]: {
    id: SkillId.PARATA,
    name: 'Parata',
    skillMod: new Decimal(1), // il danno calcolato diventa Punti Scudo
    convertsToShield: true,
    reflectRatio: new Decimal(0.5), // se il nemico attacca, 50% di ciò che blocchi torna indietro
    poisonRatio: null,
    poisonTurns: 0,
    dealsDamage: false,
    carriesRoll: false
  },
  [SkillId.BAVA]: {
    id: SkillId.BAVA,
    name: 'Bava',
    skillMod: new Decimal(1),
    convertsToShield: false,
    reflectRatio: null,
    poisonRatio: new Decimal(0.6), // 60% del danno come Veleno...
    poisonTurns: 3,                // ...per 3 turni, scalato da INT
    dealsDamage: false,
    carriesRoll: false
  },
  [SkillId.CARICA]: {
    id: SkillId.CARICA,
    name: 'Carica',
    skillMod: new Decimal(1),
    convertsToShield: false,
    reflectRatio: null,
    poisonRatio: null,
    poisonTurns: 0,
    dealsDamage: false,
    carriesRoll: true
  }
};
