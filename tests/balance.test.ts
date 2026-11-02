import { describe, expect, it } from 'vitest';
import { simulateMany } from '../tools/sim/bot';

/* ============================================================
 * BALANCE — guardrail di bilanciamento
 *
 * Il bot (tools/sim/bot.ts) gioca run complete con il motore vero:
 * azioni, oggetti, mercante, forgia e HP persistenti. Se un
 * ritocco ai numeri rompe la curva, questi test falliscono.
 *
 * Obiettivi di design (design_evolution.md):
 *  - il giocatore competente arriva al Boss 1 quasi sempre
 *  - completa la run una volta su 5-6 (un roguelike si vince di rado)
 *  - giocare male (solo Sgancio, nessun rilancio) non basta
 *  - gli incontri iniziali sono rapidi ma non banali
 * Per tarare: npx vite-node tools/sim/cli.ts --seeds=100
 * ============================================================ */

const SEEDS = 60;

describe('Balance — bot esperto', async () => {
  const smart = await simulateMany(SEEDS, { policy: 'smart', carryHp: true });

  it('arriva quasi sempre al Boss 1 e a metà run', () => {
    expect(smart.reach(9)).toBeGreaterThanOrEqual(0.85);
    expect(smart.reach(14)).toBeGreaterThanOrEqual(0.65);
  });

  it('completa la run in una quota ragionevole dei casi (10%-55%)', () => {
    expect(smart.completion).toBeGreaterThanOrEqual(0.1);
    expect(smart.completion).toBeLessThanOrEqual(0.55);
  });

  it('il Boss 2 e il Boss 3 non sono passeggiate', () => {
    expect(smart.reach(19)).toBeLessThan(0.97);
    expect(smart.reach(29)).toBeLessThan(0.8);
  });

  it('incontri rapidi ma non banali: 1.5-4.5 turni in media', () => {
    expect(smart.avgTurns(0, 3)).toBeGreaterThanOrEqual(1.5);
    expect(smart.avgTurns(5, 13)).toBeLessThanOrEqual(4.5);
    expect(smart.avgTurns(15, 28)).toBeLessThanOrEqual(5);
  });

  it('gli incontri costano HP già all\'inizio, senza ammazzare', () => {
    expect(smart.avgHpLost(0, 3)).toBeGreaterThan(0.02);
    expect(smart.avgHpLost(5, 13)).toBeGreaterThan(0.1);
    expect(smart.avgHpLost(5, 13)).toBeLessThan(0.5);
  });
});

describe('Balance — le scelte contano', async () => {
  const smart = await simulateMany(SEEDS, { policy: 'smart', carryHp: true });
  const naive = await simulateMany(SEEDS, { policy: 'naive', carryHp: true });

  it('chi usa solo Sgancio e non rilancia va molto peggio', () => {
    expect(naive.completion).toBeLessThan(smart.completion);
    expect(naive.reach(19)).toBeLessThan(smart.reach(19) - 0.3);
  });
});
