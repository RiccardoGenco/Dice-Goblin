/* Shim per permettere a tsc (che non compila .svelte) di
 * tipizzare gli import dei componenti come classi Svelte 4. */
declare module '*.svelte' {
  import type { SvelteComponent } from 'svelte';
  export default class Component extends SvelteComponent {}
}
