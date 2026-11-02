<script lang="ts">
  import { onDestroy } from 'svelte';
  import Sprite from './Sprite.svelte';
  import { SPRITES } from './spriteCatalog';
  import {
    playerView, enemyView, intentView, enemyInfo, stageFx, battleResult,
    overflowActive, actLevel
  } from './stores';

  interface Floater { key: number; side: 'player' | 'enemy'; kind: string; text: string; dx: number; fs: number }
  interface Burst { key: number; kind: 'mult' | 'overflow'; text: string; tier: number }
  let burst: Burst | null = null;
  let shaking = false;
  let flashKey = 0;
  let floaters: Floater[] = [];
  let playerAnim = '';
  let enemyAnim = '';
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  };

  /** Ogni StageFx diventa un numero fluttuante + animazione di attacco/colpo */
  let lastId = 0;
  const unsub = stageFx.subscribe(fx => {
    if (!fx || fx.id === lastId) return;
    lastId = fx.id;

    // Effetti a tutto palco: moltiplicatore della catena e overflow
    if (fx.target === 'center') {
      burst = { key: fx.id, kind: fx.kind as Burst['kind'], text: fx.text, tier: fx.power };
      later(() => { if (burst?.key === fx.id) burst = null; }, fx.kind === 'overflow' ? 2400 : 1500);
      flashKey = fx.id;
      shake(fx.kind === 'overflow' ? 900 : fx.power >= 3 ? 450 : 0);
      return;
    }

    // dimensione del numero: cresce con l'ordine di grandezza del danno
    const fs = Math.round(24 + Math.min(34, fx.power * 6));
    const f: Floater = { key: fx.id, side: fx.target, kind: fx.kind, text: fx.text, dx: (fx.id % 5 - 2) * 10, fs };
    floaters = [...floaters, f];
    later(() => { floaters = floaters.filter(x => x.key !== f.key); }, 1500);
    if (fx.kind === 'hit' && fx.power >= 2.5) shake(320); // colpo pesante

    if (fx.kind === 'hit') {
      // chi colpisce scatta in avanti, chi subisce lampeggia
      const attacker = fx.target === 'enemy' ? 'player' : 'enemy';
      setAnim(attacker, 'lunge');
      later(() => setAnim(fx.target, 'hurt'), 140);
    } else if (fx.kind === 'shield') {
      setAnim(fx.target, 'guard');
    } else {
      setAnim(fx.target, 'hurt');
    }
  });
  function shake(ms: number): void {
    if (ms <= 0) return;
    shaking = true;
    later(() => { shaking = false; }, ms);
  }
  function setAnim(who: 'player' | 'enemy', a: string): void {
    if (who === 'player') playerAnim = a; else enemyAnim = a;
    later(() => { if (who === 'player') playerAnim = ''; else enemyAnim = ''; }, 420);
  }
  onDestroy(() => { unsub(); timers.forEach(clearTimeout); });

  /** misure reali del palco: tutto si ridimensiona con lo spazio disponibile */
  let H = 420;
  let W = 1000;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  $: tier = $enemyInfo.tier;
  /** altezza a schermo desiderata (px): i personaggi restano proporzionati
   *  qualunque sia la risoluzione nativa della sprite */
  // il disegno occupa ~65% del riquadro della sprite: i fattori lo compensano
  $: targetH = H * (tier === 'boss' ? 0.78 : tier === 'champion' ? 0.66 : 0.56);
  // scale intere: i pixel restano nitidi a qualunque risoluzione
  $: scale = clamp(Math.round(targetH / SPRITES[$enemyInfo.sprite].size), 3, 14);
  $: enemyW = scale * SPRITES[$enemyInfo.sprite].size;
  $: heroScale = clamp(Math.round((H * 0.64) / SPRITES.hero.size), 3, 14);
  $: heroW = heroScale * SPRITES.hero.size;
  $: heroSprite = playerAnim === 'lunge' ? 'hero_attack' : playerAnim === 'hurt' ? 'hero_hurt' : 'hero';
  $: hudW = clamp(Math.round(W * 0.24), 150, 320);
  $: ui = clamp(H / 420, 0.7, 1.6); // fattore per testi ed effetti
  $: enemyFilter = $enemyInfo.hue
    ? `hue-rotate(${$enemyInfo.hue}deg)` : '';
  $: dead = $battleResult === 'victory';
  $: lost = $battleResult === 'defeat';
</script>

<section
  class="stage act{$actLevel}" class:shake={shaking} aria-label="Campo di battaglia"
  bind:clientHeight={H} bind:clientWidth={W}
  style="--ui:{ui}; --hud-w:{hudW}px"
>
  <div class="layer far"></div>
  <div class="layer fog"></div>
  <div class="layer near"></div>
  <div class="floor"></div>

  <!-- ===== HUD: ancorati agli angoli alti del palco ===== -->
  <div class="hud player-hud">
    <div class="who">
      <span class="nm">Goblin</span>
      <span class="status">
        {#if $playerView.shield !== '0'}<span>🛡️ {$playerView.shield}</span>{/if}
        {#if $playerView.poisonTurns > 0}<span>☠️ ×{$playerView.poisonTurns}</span>{/if}
      </span>
    </div>
    <div class="bar"><div class="fill pfill" style="width:{$playerView.hpRatio * 100}%"></div></div>
    <div class="nums">{$playerView.hp} / {$playerView.maxHp}</div>
  </div>

  <div class="hud enemy-hud">
    <div class="who">
      <span class="nm" class:boss={tier === 'boss'} class:champ={tier === 'champion'}>{$enemyInfo.name}</span>
      <span class="status">
        {#if $enemyView.shield !== '0'}<span>🛡️ {$enemyView.shield}</span>{/if}
        {#if $enemyView.poisonTurns > 0}<span>☠️ ×{$enemyView.poisonTurns}</span>{/if}
      </span>
    </div>
    <div class="bar"><div class="fill efill" style="width:{$enemyView.hpRatio * 100}%"></div></div>
    <div class="nums">{$enemyView.hp} / {$enemyView.maxHp}</div>
  </div>

  <!-- ===== Nemico (destra) ===== -->
  <div class="slot enemy-slot">
    {#if $intentView && !dead}
      <div class="bubble" title="Intento del prossimo turno">
        <span class="bi">{$intentView.icon}</span>
        <span class="bl">{$intentView.label}</span>
        <b>{$intentView.value}</b>
      </div>
    {/if}
    <div class="body enemy-body {enemyAnim}" class:dead style="filter:{enemyFilter}">
      <Sprite id={$enemyInfo.sprite} {scale} flip tint={$enemyInfo.tint} />
    </div>
    <div class="shadow" style="width:{enemyW * 0.8}px"></div>
  </div>

  <!-- ===== Goblin (sinistra) ===== -->
  <div class="slot player-slot">
    <div class="body player-body {playerAnim}" class:dead={lost}>
      <Sprite id={heroSprite} once={heroSprite !== 'hero'} scale={heroScale} />
    </div>
    <div class="shadow" style="width:{heroW * 0.8}px"></div>
  </div>

  <!-- ===== Dadi 3D: il canvas del GameManager vive sopra il palco ===== -->
  <slot name="overlay"></slot>

  <!-- ===== Numeri fluttuanti ===== -->
  {#each floaters as f (f.key)}
    <div class="floater {f.kind} {f.side}" style="--dx:{f.dx}px; font-size:{Math.round(f.fs * ui)}px">{f.text}</div>
  {/each}

  <!-- ===== Lampo e annuncio a tutto palco ===== -->
  {#key flashKey}
    {#if flashKey > 0}<div class="flash" class:ovf={burst?.kind === 'overflow'}></div>{/if}
  {/key}
  {#if burst}
    {#key burst.key}
      <div class="burst {burst.kind} t{burst.tier}" aria-live="polite">
        {#if burst.kind === 'overflow'}
          <span class="b-sub">⚠ DOPAMINE CAP ⚠</span>
        {/if}
        <span class="b-main" data-text={burst.text}>{burst.text}</span>
      </div>
    {/key}
  {/if}
  {#if $overflowActive}<div class="ovf-tag">⚠ OVERFLOW</div>{/if}
</section>

<style>
  .stage {
    position: relative; height: 100%; min-height: 240px; overflow: hidden; border-radius: 10px;
    border: 1px solid #33333f; background: #0d0d14; isolation: isolate;
    --sky-a: #1a1530; --sky-b: #2d1f45; --floor-a: #2a2236; --floor-b: #17121f;
  }
  .stage.act1 { --sky-a: #11202a; --sky-b: #1f3a45; --floor-a: #1f3030; --floor-b: #101c1c; }
  .stage.act2 { --sky-a: #2a1215; --sky-b: #4a2220; --floor-a: #3a2222; --floor-b: #1c1010; }

  .layer, .floor { position: absolute; left: 0; right: 0; }
  /* il canvas 3D passato nello slot copre tutto il palco, senza intercettare i clic */
  .stage :global(canvas.arena) { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 4; pointer-events: none; }
  /* cielo: luna con alone, qualche stella, sfumatura per Atto */
  .far {
    inset: 0;
    background:
      radial-gradient(circle at 50% 24%, rgba(255,246,214,0.95) 0 calc(22px * var(--ui)), rgba(255,246,214,0.22) calc(24px * var(--ui)) calc(54px * var(--ui)), transparent calc(120px * var(--ui))),
      radial-gradient(1.6px 1.6px at 9% 16%, #fff, transparent),
      radial-gradient(1.6px 1.6px at 21% 34%, #dfd6ff, transparent),
      radial-gradient(1.6px 1.6px at 33% 12%, #fff, transparent),
      radial-gradient(1.6px 1.6px at 67% 20%, #fff, transparent),
      radial-gradient(1.6px 1.6px at 78% 38%, #dfd6ff, transparent),
      radial-gradient(1.6px 1.6px at 90% 14%, #fff, transparent),
      radial-gradient(1.6px 1.6px at 58% 40%, #fff, transparent),
      linear-gradient(180deg, var(--sky-a), var(--sky-b) 70%);
  }
  /* guglie lontane: triangoli via gradienti, nessun asset */
  .near {
    bottom: 34%; height: 28%;
    background:
      linear-gradient(135deg, transparent 49%, rgba(8,8,14,0.85) 50%) 0 100% / calc(110px * var(--ui)) calc(110px * var(--ui)) repeat-x,
      linear-gradient(225deg, transparent 49%, rgba(8,8,14,0.85) 50%) calc(55px * var(--ui)) 100% / calc(110px * var(--ui)) calc(110px * var(--ui)) repeat-x;
    opacity: 0.7;
    animation: drift 40s linear infinite;
  }
  .fog {
    top: 40%; height: 40%;
    background: radial-gradient(ellipse at 30% 50%, rgba(180,170,220,0.16), transparent 60%),
                radial-gradient(ellipse at 75% 60%, rgba(180,170,220,0.12), transparent 55%);
    animation: fogmove 18s ease-in-out infinite alternate;
  }
  .floor {
    bottom: 0; height: 36%;
    background:
      repeating-linear-gradient(90deg, transparent 0 47px, rgba(0,0,0,0.25) 47px 48px),
      linear-gradient(180deg, var(--floor-a), var(--floor-b));
    border-top: 2px solid rgba(255,255,255,0.06);
  }

  .slot { position: absolute; bottom: 9%; display: flex; flex-direction: column; align-items: center; }
  .player-slot { left: 7%; }
  .enemy-slot { right: 7%; }
  .body { position: relative; z-index: 2; transition: opacity 0.6s, transform 0.6s, filter 0.2s; }
  .shadow {
    height: 14px; margin-top: -10px; border-radius: 50%; z-index: 1;
    background: radial-gradient(ellipse, rgba(0,0,0,0.55), transparent 70%);
  }
  .body.dead { opacity: 0; transform: translateY(18px) scale(0.9); filter: grayscale(1) brightness(2); }

  .player-body.lunge { animation: lunge-r 0.42s ease-out; }
  .enemy-body.lunge { animation: lunge-l 0.42s ease-out; }
  .body.hurt { animation: hurt 0.42s ease-out; }
  .body.guard { animation: guard 0.42s ease-out; }
  @keyframes lunge-r { 0% { transform: translateX(0); } 35% { transform: translateX(70px) scale(1.06); } 100% { transform: translateX(0); } }
  @keyframes lunge-l { 0% { transform: translateX(0); } 35% { transform: translateX(-70px) scale(1.06); } 100% { transform: translateX(0); } }
  @keyframes hurt {
    0% { transform: translateX(0); filter: brightness(3) saturate(0); }
    25% { transform: translateX(-9px); filter: brightness(2.2) saturate(0.3); }
    50% { transform: translateX(7px); }
    100% { transform: translateX(0); filter: none; }
  }
  @keyframes guard { 0% { filter: drop-shadow(0 0 0 #5cd0ff); } 40% { filter: drop-shadow(0 0 12px #5cd0ff) brightness(1.3); } 100% { filter: none; } }

  /* HUD sul palco */
  .hud { position: absolute; top: calc(10px * var(--ui)); width: var(--hud-w); z-index: 3; }
  .player-hud { left: 14px; }
  .enemy-hud { right: 14px; }
  .who { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .nm { font-weight: 700; font-size: calc(15px * var(--ui)); text-shadow: 0 1px 2px #000; }
  .nm.champ { color: #ffd84c; }
  .nm.boss { color: #ff7a9c; }
  .status { font-size: calc(12px * var(--ui)); display: flex; gap: 6px; }
  .bar { height: calc(12px * var(--ui)); background: rgba(8,8,14,0.85); border: 1px solid #000; border-radius: 3px; overflow: hidden; margin-top: 3px; }
  .fill { height: 100%; transition: width 0.45s ease; }
  .efill { background: linear-gradient(90deg, #ff5c5c, #ff9b5c); }
  .pfill { background: linear-gradient(90deg, #4cc94c, #7dff9b); }
  .nums { font-size: calc(12px * var(--ui)); opacity: 0.85; text-align: right; text-shadow: 0 1px 2px #000; }

  .bubble {
    position: relative; z-index: 3; margin-bottom: 6px; padding: 3px 12px;
    background: #2b1520; border: 2px solid #ff5c8a; border-radius: 10px;
    display: flex; gap: 6px; align-items: baseline; font-size: calc(15px * var(--ui));
    animation: bob 1.8s ease-in-out infinite;
  }
  .bubble::after {
    content: ''; position: absolute; left: 50%; bottom: -8px; margin-left: -6px;
    border: 6px solid transparent; border-top-color: #ff5c8a; border-bottom: 0;
  }
  .bl { opacity: 0.8; font-size: calc(12px * var(--ui)); }
  @keyframes bob { 50% { transform: translateY(-3px); } }

  /* numeri di danno */
  .floater {
    position: absolute; bottom: 52%; z-index: 5; font-weight: 700; font-size: 30px;
    text-shadow: 0 2px 0 #000, 0 0 10px rgba(0,0,0,0.8); pointer-events: none;
    animation: floatup 1.4s ease-out forwards;
  }
  .floater.enemy { right: calc(7% + 50px); bottom: 66%; }
  .floater.player { left: calc(7% + 40px); }
  .floater.hit.enemy { color: #ffd84c; }
  .floater.hit.player { color: #ff5c5c; }
  .floater.shield { color: #5cd0ff; }
  .floater.poison { color: #9bff5c; font-size: 22px; }
  @keyframes floatup {
    0% { transform: translate(var(--dx), 10px) scale(0.6); opacity: 0; }
    15% { transform: translate(var(--dx), -6px) scale(1.25); opacity: 1; }
    100% { transform: translate(var(--dx), -55px) scale(1); opacity: 0; }
  }

  /* scuotimento dello schermo: colpi pesanti e overflow */
  .shake { animation: shake 0.09s linear infinite; }
  @keyframes shake {
    0% { transform: translate(0, 0); }
    25% { transform: translate(-4px, 2px); }
    50% { transform: translate(3px, -3px); }
    75% { transform: translate(-2px, -2px); }
    100% { transform: translate(0, 0); }
  }
  .flash {
    position: absolute; inset: 0; z-index: 6; pointer-events: none;
    background: radial-gradient(circle at 50% 55%, rgba(255,255,255,0.75), rgba(255,92,138,0.25) 55%, transparent 80%);
    animation: flash 0.5s ease-out forwards;
  }
  .flash.ovf { background: radial-gradient(circle at 50% 55%, rgba(255,255,255,0.9), rgba(255,40,80,0.45) 50%, rgba(0,255,255,0.15) 80%); animation-duration: 0.9s; }
  @keyframes flash { from { opacity: 1; } to { opacity: 0; } }

  .burst {
    position: absolute; left: 50%; top: 42%; z-index: 7; pointer-events: none;
    transform: translate(-50%, -50%); text-align: center; display: flex; flex-direction: column; gap: 2px;
    animation: burst-in 1.4s cubic-bezier(.2,1.4,.4,1) forwards;
  }
  .burst.overflow { animation-duration: 2.3s; }
  .b-main { font-weight: 700; letter-spacing: 1px; text-shadow: 0 3px 0 #000, 0 0 18px rgba(0,0,0,0.9); font-size: calc(54px * var(--ui)); }
  .b-sub { font-weight: 700; font-size: calc(15px * var(--ui)); letter-spacing: 4px; color: #ff9bb4; text-shadow: 0 2px 0 #000; }
  .burst.t1 .b-main { color: #ffc2dd; font-size: calc(46px * var(--ui)); }
  .burst.t2 .b-main { color: #ff7ab0; font-size: calc(60px * var(--ui)); }
  .burst.t3 .b-main { color: #ffb84c; font-size: calc(76px * var(--ui)); text-shadow: 0 3px 0 #000, 0 0 26px #ff8a00; }
  .burst.t4 .b-main { color: #fff; font-size: calc(92px * var(--ui)); text-shadow: 0 3px 0 #000, 0 0 34px #ff2d6f, 0 0 60px #ff2d6f; }
  /* overflow: testo con separazione RGB e vibrazione */
  .burst.overflow .b-main {
    color: #fff; font-size: calc(70px * var(--ui)); position: relative;
    text-shadow: 3px 0 #ff2d6f, -3px 0 #2de2ff, 0 4px 0 #000;
    animation: jitter 0.08s steps(2) infinite;
  }
  @keyframes jitter { 0% { transform: translate(0,0); } 50% { transform: translate(2px,-2px); } 100% { transform: translate(-2px,1px); } }
  @keyframes burst-in {
    0% { transform: translate(-50%, -30%) scale(0.2); opacity: 0; }
    18% { transform: translate(-50%, -50%) scale(1.25); opacity: 1; }
    30% { transform: translate(-50%, -50%) scale(1); }
    80% { transform: translate(-50%, -54%) scale(1); opacity: 1; }
    100% { transform: translate(-50%, -80%) scale(1.05); opacity: 0; }
  }
  .ovf-tag {
    position: absolute; left: 50%; top: 10px; transform: translateX(-50%); z-index: 6;
    font-weight: 900; letter-spacing: 3px; font-size: 12px; color: #ff5c8a;
    padding: 2px 12px; border: 1px solid #ff5c8a; border-radius: 4px; background: rgba(40,8,20,0.8);
    animation: jitter 0.1s steps(2) infinite;
  }
  @keyframes drift { to { background-position: -110px 100%, -55px 100%; } }
  @keyframes fogmove { to { transform: translateX(40px); } }

  @media (max-width: 640px) {
    .hud { width: var(--hud-w); }
    .player-slot { left: 2%; } .enemy-slot { right: 2%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .near, .fog, .bubble, .shake, .ovf-tag, .burst.overflow .b-main { animation: none; }
  }
</style>
