<script lang="ts">
  import { SPRITES, TINTS, type SpriteId, type TintId } from './spriteCatalog';

  export let id: SpriteId;
  /** ingrandimento intero: i pixel restano nitidi */
  export let scale = 5;
  export let flip = false;
  export let tint: TintId = 'none';
  /** riproduce l'animazione una sola volta invece di ciclare */
  export let once = false;

  $: def = SPRITES[id];
  $: w = def.size * scale;
  $: total = w * def.frames;
  $: dur = def.frames / def.fps;
</script>

{#key id}
<div
  class="sprite"
  class:flip
  class:once
  style="--w:{w}px; --total:{total}px; --dur:{dur}s; --frames:{def.frames};
         background-image:url({def.url}); filter:{TINTS[tint]};"
></div>
{/key}

<style>
  .sprite {
    width: var(--w); height: var(--w);
    background-repeat: no-repeat;
    background-size: var(--total) var(--w);
    image-rendering: pixelated;
    animation: idle var(--dur) steps(var(--frames)) infinite;
  }
  .once { animation-iteration-count: 1; }
  .flip { transform: scaleX(-1); }
  @keyframes idle {
    from { background-position-x: 0; }
    to { background-position-x: calc(var(--total) * -1); }
  }
  @media (prefers-reduced-motion: reduce) { .sprite { animation: none; } }
</style>
