<script lang="ts">
  import Icon from './Icon.svelte';
  import { splitIcons } from './icons';
  export let text = '';
  export let mono = false;
  $: pieces = splitIcons(text);
</script>

{#each pieces as p}{#if typeof p === 'string'}{p}{:else}<Icon icon={p} {mono} />{/if}{/each}
