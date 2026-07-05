import App from './ui/App.svelte';

/* Entry point: monta la HUD Svelte (DOM Layer, GDD §6.2).
 * Il Canvas Layer 3D vive DENTRO App.svelte, creato da
 * GameManager al mount: architettura ibrida completa. */
const app = new App({
  target: document.getElementById('app')!
});

export default app;
