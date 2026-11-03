<script lang="ts">
  import Icon from './Icon.svelte';
  /** emoji dell'oggetto (diventa l'icona game-icons) */
  export let icon = '';
  /** 'comune' | 'non-comune' | 'raro' | undefined (oggetti non classificati: dadi, upgrade) */
  export let rarity: string | undefined = undefined;
  export let relic = false;
  /** lato in px */
  export let size = 40;
  export let empty = false;
  $: kind = relic ? 'relic' : rarity ?? 'none';
  $: pips = relic ? 4 : rarity === 'raro' ? 3 : rarity === 'non-comune' ? 2 : rarity === 'comune' ? 1 : 0;
</script>

<span class="badge {kind}" class:empty style="--s:{size}px" aria-hidden="true">
  {#if !empty}
    <span class="glyph"><Icon e={icon} /></span>
    {#if pips}<span class="pips">{#each Array(pips) as _}<i></i>{/each}</span>{/if}
  {/if}
</span>

<style>
  .badge {
    --rc: #6a6a7c; --rg: rgba(106, 106, 124, 0);
    position: relative; display: inline-flex; align-items: center; justify-content: center; flex: none;
    width: var(--s); height: var(--s); font-size: calc(var(--s) * 0.58); border-radius: calc(var(--s) * 0.22);
    background: radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--rc) 38%, #14101f) 0%, #0d0a18 78%);
    border: 2px solid var(--rc); box-shadow: 0 0 calc(var(--s) * 0.3) var(--rg), inset 0 0 calc(var(--s) * 0.35) rgba(0,0,0,0.55);
  }
  .badge.none { --rc: #5fbf7a; }
  .badge.comune { --rc: #a9b0bd; }
  .badge.non-comune { --rc: #4cc9f0; --rg: rgba(76, 201, 240, 0.35); }
  .badge.raro { --rc: #c77dff; --rg: rgba(199, 125, 255, 0.55); }
  .badge.relic { --rc: #ffd34d; --rg: rgba(255, 211, 77, 0.65); animation: relicglow 2.2s ease-in-out infinite; }
  .badge.empty { --rc: #3b3558; background: #0e0b1c; border-style: dashed; box-shadow: none; }
  .glyph { display: inline-flex; filter: drop-shadow(0 0 calc(var(--s) * 0.08) var(--rc)); }
  .pips { position: absolute; bottom: 2px; left: 0; right: 0; display: flex; justify-content: center; gap: 2px; }
  .pips i { width: calc(var(--s) * 0.1); height: calc(var(--s) * 0.1); min-width: 3px; min-height: 3px; border-radius: 50%; background: var(--rc); box-shadow: 0 0 3px var(--rc); }
  .badge.relic::after {
    content: ''; position: absolute; inset: -2px; border-radius: inherit; pointer-events: none;
    background: linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.45) 50%, transparent 65%);
    background-size: 250% 100%; animation: sheen 3.2s linear infinite; mix-blend-mode: overlay;
  }
  @keyframes relicglow { 50% { box-shadow: 0 0 calc(var(--s) * 0.55) rgba(255, 211, 77, 0.95), inset 0 0 calc(var(--s) * 0.35) rgba(0,0,0,0.55); } }
  @keyframes sheen { from { background-position: 150% 0; } to { background-position: -150% 0; } }
</style>
