<script lang="ts">
  import type { IconDef } from './iconData';
  import { iconFor } from './icons';
  /** emoji da cui ricavare l'icona (oppure `icon` già risolta) */
  export let e = '';
  export let icon: IconDef | undefined = undefined;
  /** se vero usa il colore del testo invece di quello dell'icona */
  export let mono = false;
  $: def = icon ?? iconFor(e);
</script>

{#if def}<svg class="gi" viewBox="0 0 512 512" aria-hidden="true" style={mono ? '' : `color:${def.color}`}><path d={def.d} fill="currentColor" /></svg>{:else}{e}{/if}

<style>
  .gi { width: 1.15em; height: 1.15em; vertical-align: -0.2em; display: inline-block; flex: none; filter: drop-shadow(0 1px 0 rgba(0,0,0,0.65)); }
</style>
