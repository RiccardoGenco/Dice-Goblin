import { simulateRun } from './bot';
import { BALANCE } from '../../src/core/types';
for (const kv of String(process.argv.find(a => a.startsWith('--set='))?.slice(6) ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split(':'); (BALANCE as any)[k!] = Number(v); }
const N = 30; const rows: Record<number, number[][]> = {};
for (let seed = 1; seed <= N; seed++) {
  const r = await simulateRun(seed, { policy: 'smart', carryHp: true });
  for (const f of r.log) (rows[f.level] ??= []).push([f.damage, f.enemyHp, f.str, f.vit, f.items, f.turns]);
}
const avg = (a: number[][], i: number) => a.reduce((s, x) => s + x[i]!, 0) / a.length;
console.log('lv  n  dmg/colpo  enemyHP  hit/enemy  STR  VIT  oggetti  turni');
for (const lv of Object.keys(rows).map(Number).filter(l => l % 3 === 0)) {
  const a = rows[lv]!;
  console.log(String(lv).padStart(2), String(a.length).padStart(3), avg(a, 0).toFixed(0).padStart(9), avg(a, 1).toFixed(0).padStart(8), (avg(a, 1) / avg(a, 0)).toFixed(1).padStart(8), avg(a, 2).toFixed(0).padStart(5), avg(a, 3).toFixed(0).padStart(5), avg(a, 4).toFixed(1).padStart(6), avg(a, 5).toFixed(1).padStart(6));
}
