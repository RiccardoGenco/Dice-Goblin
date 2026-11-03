<script lang="ts">
  import Decimal from 'break_infinity.js';
  import { onDestroy } from 'svelte';
  import { formatBigNumber } from '@core/format';
  import { sfx } from '../audio';

  /** valore di arrivo; il numero mostrato lo insegue */
  export let value = 0;
  /** durata dell'animazione (ms) */
  export let duration = 700;
  /** tic sonori mentre sale */
  export let ticks = false;
  /** mostra un "+X" fluttuante quando sale */
  export let floaty = false;

  let shown = value;
  let from = value;
  let start = 0;
  let raf = 0;
  let gain: { id: number; text: string } | null = null;
  let gid = 0;
  let lastTick = 0;
  let prev = value;

  const fmt = (n: number): string => formatBigNumber(new Decimal(Math.max(0, n)));

  function ease(t: number): number { return 1 - Math.pow(1 - t, 3); }

  /** salto di molti ordini di grandezza: interpola in modo geometrico, altrimenti lineare */
  function lerp(a: number, b: number, t: number): number {
    if (a > 0 && b > 0 && (b / a > 8 || a / b > 8)) return a * Math.pow(b / a, t);
    return a + (b - a) * t;
  }

  function frame(now: number): void {
    const t = Math.min(1, (now - start) / duration);
    shown = lerp(from, value, ease(t));
    if (ticks && value > from && now - lastTick > 70) { lastTick = now; sfx.tick(t); }
    if (t < 1) raf = requestAnimationFrame(frame); else shown = value;
  }

  $: if (value !== prev) {
    if (floaty && value > prev) gain = { id: ++gid, text: `+${fmt(value - prev)}` };
    from = shown; start = performance.now(); prev = value;
    cancelAnimationFrame(raf);
    if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame); else shown = value;
  }
  onDestroy(() => cancelAnimationFrame(raf));
</script>

<span class="ctr" class:rising={shown < value} class:falling={shown > value}>{fmt(shown)}{#if gain}{#key gain.id}<b class="gain">{gain.text}</b>{/key}{/if}</span>

<style>
  .ctr { position: relative; display: inline-block; font-variant-numeric: tabular-nums; transition: color 0.2s, text-shadow 0.2s; }
  .ctr.rising { color: #fff3b0; text-shadow: 0 0 10px rgba(255, 220, 90, 0.8); }
  .ctr.falling { color: #ffb0b0; }
  .gain {
    position: absolute; left: 50%; top: -4px; transform: translateX(-50%); white-space: nowrap; pointer-events: none;
    font-size: 0.8em; color: #7dff9b; text-shadow: 0 1px 2px #000; animation: gainup 1.3s ease-out forwards;
  }
  @keyframes gainup { 0% { opacity: 0; transform: translate(-50%, 6px); } 15% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -26px); } }
</style>
