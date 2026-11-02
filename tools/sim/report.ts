import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { simulateMany, BalanceReport } from './bot';
import { BALANCE, SkillId } from '../../src/core/types';
import { ITEMS } from '../../src/core/equipment';

/* ============================================================
 * Rapporto di bilanciamento COMPATTO (pensato per costare pochi token).
 *
 *   npm run sim                 rapporto completo (3 profili di giocatore)
 *   npm run sim -- --save       salva il risultato come riferimento
 *   npm run sim -- --compare    stampa solo le differenze dal riferimento
 *   npm run sim -- --seeds=200 --set=WIN_STR_GROWTH:1.25
 *
 * Profili: esperto (legge gli intenti e ottimizza la mano), medio
 * (come l'esperto ma un turno su tre sbaglia azione), ingenuo (solo Sgancio).
 * Un buon gioco premia l'abilità: esperto > medio > ingenuo.
 * ============================================================ */

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
for (const kv of String(args.set ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split(':');
  (BALANCE as any)[k!] = Number(v);
}
const seeds = Number(args.seeds ?? 100);
const BASELINE = 'tools/sim/baseline.json';
const PROFILES = [['esperto', 'smart'], ['medio', 'casual'], ['ingenuo', 'naive']] as const;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const ACTION_NAME: Record<number, string> = {
  [SkillId.SGANCIO_BRUTALE]: 'Sgancio', [SkillId.PARATA]: 'Parata', [SkillId.BAVA]: 'Bava', [SkillId.CARICA]: 'Carica'
};

interface Summary {
  completion: number; median: number; b1: number; b2: number; b3: number;
  turns: number[]; hpLost: number[]; actions: Record<string, number>;
  deathShare: Record<number, number>; itemShare: Record<string, number>; goldLeft: number;
}

function summarize(rep: BalanceReport): Summary {
  const band = (f: (a: number, b: number) => number) => [[0, 3], [5, 8], [10, 13], [15, 18], [20, 28]].map(([a, b]) => f(a!, b!));
  const used: Record<string, number> = {};
  let total = 0;
  for (const r of rep.results) for (const l of r.log) for (const [k, v] of Object.entries(l.used)) {
    used[ACTION_NAME[Number(k)]!] = (used[ACTION_NAME[Number(k)]!] ?? 0) + v; total += v;
  }
  const actions = Object.fromEntries(Object.entries(used).map(([k, v]) => [k, v / Math.max(1, total)]));
  const deathShare: Record<number, number> = {};
  for (const r of rep.results) if (r.diedAt < 30) deathShare[r.diedAt] = (deathShare[r.diedAt] ?? 0) + 1 / rep.seeds;
  const itemShare: Record<string, number> = {};
  for (const r of rep.results) for (const id of r.items) itemShare[id] = (itemShare[id] ?? 0) + 1 / rep.seeds;
  return {
    completion: rep.completion, median: rep.medianDeath,
    b1: rep.reach(9), b2: rep.reach(19), b3: rep.reach(29),
    turns: band(rep.avgTurns), hpLost: band(rep.avgHpLost), actions, deathShare, itemShare,
    goldLeft: mean(rep.results.map(r => r.gold))
  };
}

const out: Record<string, Summary> = {};
for (const [name, policy] of PROFILES) out[name] = summarize(await simulateMany(seeds, { policy, carryHp: true }));

/* ------------ confronto con il riferimento ------------ */
if (args.compare !== undefined) {
  if (!existsSync(BASELINE)) { console.log('Nessun riferimento: lancia prima con --save'); process.exit(0); }
  const base: Record<string, Summary> = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const d = (a: number, b: number, mul = 100, u = 'pt') => {
    const v = (a - b) * mul; return Math.abs(v) < 0.5 ? '=' : `${v > 0 ? '+' : ''}${Math.round(v)}${u}`;
  };
  console.log(`CONFRONTO (${seeds} run/profilo) rispetto al riferimento`);
  for (const [n] of PROFILES) {
    const a = out[n]!, b = base[n]!;
    console.log(`${n.padEnd(8)} completa ${pct(a.completion)} (${d(a.completion, b.completion)}) · mediana lv${a.median} (${d(a.median, b.median, 1, '')}) · B2 ${pct(a.b2)} (${d(a.b2, b.b2)}) · turni lv10-13 ${a.turns[2]!.toFixed(1)} (${d(a.turns[2]!, b.turns[2]!, 1, '')}) · HP persi lv15-18 ${pct(a.hpLost[3]!)} (${d(a.hpLost[3]!, b.hpLost[3]!)})`);
  }
  process.exit(0);
}

/* ------------ rapporto ------------ */
const L: string[] = [];
L.push(`SIM ${seeds} run/profilo · mano ${BALANCE.HAND_DRAW}/${BALANCE.HAND_PLAY} · STR crescita ${BALANCE.WIN_STR_GROWTH}`);
L.push('profilo   completa  mediana   B1    B2    B3   | turni lv0-3/5-8/10-13/15-18/20-28 | HP persi per fascia');
for (const [n] of PROFILES) {
  const s = out[n]!;
  L.push(`${n.padEnd(8)}  ${pct(s.completion).padStart(6)}   lv${String(s.median).padEnd(3)}   ${pct(s.b1).padStart(4)}  ${pct(s.b2).padStart(4)}  ${pct(s.b3).padStart(4)}  | ${s.turns.map(t => t.toFixed(1)).join('/')} | ${s.hpLost.map(pct).join('/')}`);
}
for (const n of ['esperto', 'medio'] as const) {
  L.push(`Azioni ${n}: ${Object.entries(out[n]!.actions).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join(' · ')}`);
}
const walls = Object.entries(out.medio!.deathShare).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([lv, v]) => `lv${lv} ${pct(v)}`);
L.push(`Dove muore il medio: ${walls.join(' · ') || 'mai'}`);
const owned = Object.entries(out.esperto!.itemShare).sort((a, b) => b[1] - a[1]);
const never = ITEMS.map(i => i.id).filter(id => !(id in out.esperto!.itemShare) && !(id in out.medio!.itemShare));
L.push(`Oggetti più presi (esperto): ${owned.slice(0, 4).map(([id, v]) => `${id} ${pct(v)}`).join(' · ')}`);
L.push(`Mai presi (${never.length}): ${never.join(', ') || '—'}`);
L.push(`Oro a fine run (guadagnato dopo l ultimo negozio, non speso per scelta): esperto ${Math.round(out.esperto!.goldLeft)}, medio ${Math.round(out.medio!.goldLeft)}`);

const warn: string[] = [];
const E = out.esperto!, M = out.medio!, N = out.ingenuo!;
if (E.completion < 0.25 || E.completion > 0.55) warn.push(`esperto completa ${pct(E.completion)}: obiettivo 25-55%`);
if (M.completion < 0.05 || M.completion > 0.25) warn.push(`medio completa ${pct(M.completion)}: obiettivo 5-25% (un umano gioca più vicino al medio)`);
if (N.completion > 0.03) warn.push(`ingenuo completa ${pct(N.completion)}: gioco troppo facile senza abilità`);
if (N.median < 11) warn.push(`ingenuo muore al lv${N.median}: troppo severo con chi preme sempre Sgancio`);
if (E.completion - M.completion < 0.1) warn.push('l\'abilità rende poco: esperto e medio quasi uguali');
for (const [n, s] of [['esperto', E], ['medio', M]] as const) {
  for (const [a, v] of Object.entries(s.actions)) if (v < 0.04) warn.push(`${a} usata solo ${pct(v)} dal profilo ${n}: azione senza ruolo`);
}
for (const [lv, v] of Object.entries(M.deathShare)) if (v > 0.25) warn.push(`muro al lv${lv}: ${pct(v)} dei medi muore lì`);
for (const [n, s] of [['esperto', E], ['medio', M]] as const) if (Math.max(...s.turns) > 5) warn.push(`incontri lenti per ${n}: ${Math.max(...s.turns).toFixed(1)} turni di media`);
if (E.hpLost[0]! < 0.01) warn.push('i primi incontri non costano HP: avvio troppo morbido');
for (const [id, v] of owned) if (v > 0.9) warn.push(`${id} presente nel ${pct(v)} delle run: scelta obbligata`);
if (never.length > ITEMS.length * 0.4) warn.push(`${never.length}/${ITEMS.length} oggetti non vengono mai comprati`);
L.push(warn.length ? 'AVVISI:\n' + warn.map(w => ' ! ' + w).join('\n') : 'AVVISI: nessuno');
console.log(L.join('\n'));

if (args.save !== undefined) { writeFileSync(BASELINE, JSON.stringify(out)); console.log('(riferimento salvato)'); }
