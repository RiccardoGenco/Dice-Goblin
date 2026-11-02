import { simulateMany } from './bot';

/* Uso: npx vite-node tools/sim/cli.ts [--seeds=80] [--policy=smart|naive] [--hp=1|0] */
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const seeds = Number(args.seeds ?? 80);
const policy = (args.policy ?? 'smart') as 'smart' | 'naive';
const carryHp = args.hp !== '0';
const rep = await simulateMany(seeds, { policy, carryHp });
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
console.log(`[${policy}${carryHp ? ', HP persistenti' : ''}] ${seeds} run`);
console.log(`Run completate: ${pct(rep.completion)} | morte mediana: livello ${rep.medianDeath}`);
console.log('Raggiunge  lv4(Camp)  B1(lv9)  lv14(Camp)  B2(lv19)  lv24(Camp)  B3(lv29)');
console.log('          ', [4, 9, 14, 19, 24, 29].map(l => pct(rep.reach(l)).padStart(6)).join('     '));
console.log(`Turni medi per incontro: lv0-3 ${rep.avgTurns(0, 3).toFixed(1)}, lv5-8 ${rep.avgTurns(5, 8).toFixed(1)}, lv10-13 ${rep.avgTurns(10, 13).toFixed(1)}, lv15-18 ${rep.avgTurns(15, 18).toFixed(1)}, lv20-28 ${rep.avgTurns(20, 28).toFixed(1)}`);
console.log(`HP persi per incontro:   lv0-3 ${pct(rep.avgHpLost(0, 3))}, lv5-8 ${pct(rep.avgHpLost(5, 8))}, lv10-13 ${pct(rep.avgHpLost(10, 13))}, lv15-18 ${pct(rep.avgHpLost(15, 18))}, lv20-28 ${pct(rep.avgHpLost(20, 28))}`);
