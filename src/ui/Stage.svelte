<script lang="ts">
  import { get } from 'svelte/store';
  import Icon from './Icon.svelte';
  import Counter from './Counter.svelte';
  import Rich from './Rich.svelte';
  import { onDestroy } from 'svelte';
  import Sprite from './Sprite.svelte';
  import { SPRITES } from './spriteCatalog';
  import {
    playerView, enemyView, intentView, intentQueue, bossRuleText, turnEventView, phaseBanner, settings, enemyInfo, stageFx, battleResult,
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
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms / (get(settings).fast ? 2 : 1));
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
  /** particelle d'ambiente: posizioni fisse, così il palco non cambia a ogni render */
  const PARTS = Array.from({ length: 22 }, (_, i) => ({
    x: (i * 37 + 11) % 100, d: -((i * 1.7) % 9), t: 7 + ((i * 3) % 8), z: 0.6 + ((i * 5) % 7) / 10, dx: ((i * 13) % 40) - 20
  }));
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
  class="stage act{$actLevel + 1} tier-{tier}" class:shake={shaking} aria-label="Campo di battaglia"
  bind:clientHeight={H} bind:clientWidth={W}
  style="--ui:{ui}; --hud-w:{hudW}px"
>
  <div class="layer far"></div>
  <div class="layer ceiling"></div>
  <div class="layer fog"></div>
  <div class="layer near"></div>
  <div class="layer glow"></div>
  <div class="floor"></div>
  <div class="particles" aria-hidden="true">
    {#each PARTS as p}<i style="left:{p.x}%; --d:{p.d}s; --t:{p.t}s; --z:{p.z}; --dx:{p.dx}px"></i>{/each}
  </div>
  <div class="vignette"></div>
  {#if $phaseBanner}<div class="phase-banner" role="status">{$phaseBanner}</div>{/if}

  <!-- ===== HUD: ancorati agli angoli alti del palco ===== -->
  <div class="hud player-hud">
    <div class="who">
      <span class="nm">Goblin</span>
      <span class="status">
        {#if $playerView.shield !== '0'}<span><Icon e="🛡" /> {$playerView.shield}</span>{/if}
        {#if $playerView.poisonTurns > 0}<span><Icon e="☠" /> ×{$playerView.poisonTurns}</span>{/if}
      </span>
    </div>
    <div class="bar"><div class="fill pfill" style="width:{$playerView.hpRatio * 100}%"></div></div>
    <div class="nums"><Counter value={$playerView.hpNum} duration={500} /> / {$playerView.maxHp}</div>
  </div>

  <div class="hud enemy-hud">
    <div class="who">
      <span class="nm" class:boss={tier === 'boss'} class:champ={tier === 'champion'}>{$enemyInfo.name}</span>
      <span class="status">
        {#if $enemyView.shield !== '0'}<span><Icon e="🛡" /> {$enemyView.shield}</span>{/if}
        {#if $enemyView.poisonTurns > 0}<span><Icon e="☠" /> ×{$enemyView.poisonTurns}</span>{/if}
      </span>
    </div>
    <div class="bar"><div class="fill efill" style="width:{$enemyView.hpRatio * 100}%"></div></div>
    <div class="nums"><Counter value={$enemyView.hpNum} duration={500} /> / {$enemyView.maxHp}</div>
  </div>

  <!-- ===== Schema del nemico: cosa farà ora e nei prossimi turni ===== -->
  {#if $intentView && !dead && !lost}
    <div class="track" aria-label="Schema del nemico">
      <div class="track-title">{$enemyInfo.name} <span>agirà così</span></div>
      <div class="track-row">
        {#key $intentView.label + $intentView.value}
          <div class="tcard now k-{$intentView.kind}" title="Cosa fa il nemico alla fine di questo turno">
            <span class="tag">Questo turno</span>
            <span class="ti"><Icon e={$intentView.icon} /></span>
            <span class="tl"><Rich text={$intentView.label} /></span>
            <b class="tv">{$intentView.value}</b>
            <span class="tip">{$intentView.tip}</span>
          </div>
        {/key}
        {#each $intentQueue as q, i (i + q.label + q.value)}
          <span class="chev" aria-hidden="true">›</span>
          <div class="tcard next n{i} k-{q.kind}" title="Tra {i + 1} turn{i === 0 ? 'o' : 'i'}">
            <span class="tag">{i === 0 ? 'Poi' : i === 1 ? 'Dopo' : 'Ancora'}</span>
            <span class="ti"><Icon e={q.icon} /></span>
            <span class="tl"><Rich text={q.label} /></span>
            <b class="tv">{q.value}</b>
          </div>
        {/each}
        <span class="chev loop" title="Poi lo schema ricomincia">↺</span>
      </div>
      {#if $bossRuleText}<div class="rule">{$bossRuleText}</div>{/if}
      {#if $turnEventView}<div class="tevent" class:good={$turnEventView.good}><b>{$turnEventView.icon} {$turnEventView.title}</b> {$turnEventView.text}</div>{/if}
    </div>
  {/if}

  <!-- ===== Nemico (destra) ===== -->
  <div class="slot enemy-slot">
    <div class="body enemy-body {enemyAnim}" class:dead style="filter:{enemyFilter}">
      <Sprite id={$enemyInfo.sprite} {scale} tint={$enemyInfo.tint} />
    </div>
    <div class="shadow" style="width:{enemyW * 0.8}px"></div>
  </div>

  <!-- ===== Goblin (sinistra) ===== -->
  <div class="slot player-slot">
    <div class="body player-body {playerAnim}" class:dead={lost}>
      <Sprite id={heroSprite} flip once={heroSprite !== 'hero'} scale={heroScale} />
    </div>
    <div class="shadow" style="width:{heroW * 0.8}px"></div>
  </div>

  <!-- ===== Dadi 3D: il canvas del GameManager vive sopra il palco ===== -->
  <slot name="overlay"></slot>

  <!-- ===== Numeri fluttuanti ===== -->
  {#each floaters as f (f.key)}
    <div class="floater {f.kind} {f.side}" style="--dx:{f.dx}px; font-size:{Math.round(f.fs * ui)}px"><Rich text={f.text} /></div>
  {/each}

  <!-- ===== Lampo e annuncio a tutto palco ===== -->
  {#key flashKey}
    {#if flashKey > 0}<div class="flash" class:ovf={burst?.kind === 'overflow'}></div>{/if}
  {/key}
  {#if burst}
    {#key burst.key}
      <div class="burst {burst.kind} t{burst.tier}" aria-live="polite">
        {#if burst.kind === 'overflow'}
          <span class="b-sub"><Icon e="⚠" /> DOPAMINE CAP <Icon e="⚠" /></span>
        {/if}
        <span class="b-main" data-text={burst.text}>{burst.text}</span>
      </div>
    {/key}
  {/if}
  {#if $overflowActive}<div class="ovf-tag"><Icon e="⚠" /> OVERFLOW</div>{/if}
</section>

<style>
  .stage {
    position: relative; height: 100%; min-height: 240px; overflow: hidden; border-radius: 10px;
    border: 1px solid #33333f; background: #0d0d14; isolation: isolate;
    --sky-a: #1a1530; --sky-b: #2d1f45; --floor-a: #2a2236; --floor-b: #17121f;
  }
  .stage.act1 { --sky-a: #11202a; --sky-b: #1f3a45; --floor-a: #1f3030; --floor-b: #101c1c; --pc: #d9f58a; }
  .stage.act2 { --sky-a: #0b1620; --sky-b: #1b2740; --floor-a: #1d2a38; --floor-b: #0c121b; --pc: #b79cff; }
  .stage.act3 { --sky-a: #2a0806; --sky-b: #8a2c10; --floor-a: #2b1410; --floor-b: #0f0605; --pc: #ffa24a; }

  /* ---- Atto 2: cripta di cristalli. Niente luna: soffitto con stalattiti, cristalli luminosi, torce ---- */
  .stage.act2 .far {
    background:
      radial-gradient(ellipse at 18% 62%, rgba(94, 224, 214, 0.22), transparent 38%),
      radial-gradient(ellipse at 82% 54%, rgba(170, 120, 255, 0.24), transparent 40%),
      radial-gradient(1.8px 1.8px at 12% 30%, #9ff, transparent), radial-gradient(1.8px 1.8px at 40% 18%, #c9b3ff, transparent),
      radial-gradient(1.8px 1.8px at 62% 36%, #9ff, transparent), radial-gradient(1.8px 1.8px at 86% 22%, #c9b3ff, transparent),
      linear-gradient(180deg, var(--sky-a), var(--sky-b) 75%);
  }
  .stage.act2 .ceiling {
    top: 0; height: 26%;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='100' viewBox='0 0 160 100' preserveAspectRatio='none'%3E%3Cpath d='M0 0h160v12l-14 0-8 58-8-58-22 0-6 34-6-34-26 0-9 74-9-74-24 0-8 40-8-40-12 0z' fill='%2305080f'/%3E%3C/svg%3E") 0 0 / calc(160px * var(--ui)) 100% repeat-x;
    opacity: 0.95;
  }
  .stage.act2 .near {
    background:
      linear-gradient(135deg, transparent 49%, rgba(64, 200, 205, 0.55) 50%) 0 100% / calc(60px * var(--ui)) calc(90px * var(--ui)) repeat-x,
      linear-gradient(225deg, transparent 49%, rgba(150, 110, 255, 0.5) 50%) calc(34px * var(--ui)) 100% / calc(80px * var(--ui)) calc(120px * var(--ui)) repeat-x;
    opacity: 0.55; animation: none;
  }
  .stage.act2 .glow {
    inset: 0;
    background:
      radial-gradient(circle at 9% 50%, rgba(255, 170, 70, 0.55), transparent calc(110px * var(--ui))),
      radial-gradient(circle at 91% 50%, rgba(255, 170, 70, 0.55), transparent calc(110px * var(--ui)));
    animation: flicker 2.6s ease-in-out infinite;
  }

  /* ---- Atto 3: vulcano arcano. Eclissi, monti seghettati, crepe di lava ---- */
  .stage.act3 .far {
    background:
      radial-gradient(circle at 50% 30%, #07040a 0 calc(40px * var(--ui)), rgba(255, 140, 50, 0.95) calc(42px * var(--ui)) calc(48px * var(--ui)), rgba(255, 90, 30, 0.28) calc(52px * var(--ui)) calc(120px * var(--ui)), transparent calc(190px * var(--ui))),
      radial-gradient(ellipse at 50% 100%, rgba(255, 90, 20, 0.35), transparent 60%),
      linear-gradient(180deg, var(--sky-a), var(--sky-b) 80%);
  }
  .stage.act3 .ceiling {
    top: 0; height: 34%;
    background: radial-gradient(ellipse at 20% 0%, rgba(20, 8, 8, 0.85), transparent 55%), radial-gradient(ellipse at 80% 0%, rgba(20, 8, 8, 0.85), transparent 55%);
  }
  .stage.act3 .near {
    bottom: 33%; height: 34%;
    background:
      linear-gradient(160deg, transparent 52%, rgba(14, 6, 6, 0.95) 53%) 0 100% / calc(170px * var(--ui)) calc(150px * var(--ui)) repeat-x,
      linear-gradient(200deg, transparent 52%, rgba(22, 8, 6, 0.95) 53%) calc(70px * var(--ui)) 100% / calc(190px * var(--ui)) calc(120px * var(--ui)) repeat-x;
    opacity: 0.92; animation: none; filter: drop-shadow(0 -2px 6px rgba(255, 90, 20, 0.5));
  }
  .stage.act3 .glow {
    inset: auto 0 0 0; height: 45%;
    background: radial-gradient(ellipse at 50% 100%, rgba(255, 100, 30, 0.45), transparent 70%);
    animation: flicker 3.4s ease-in-out infinite;
  }
  .stage.act3 .floor {
    background:
      repeating-linear-gradient(115deg, transparent 0 46px, rgba(255, 110, 30, 0.55) 46px 48px, transparent 48px 120px),
      repeating-linear-gradient(65deg, transparent 0 80px, rgba(255, 150, 50, 0.4) 80px 82px, transparent 82px 190px),
      linear-gradient(180deg, var(--floor-a), var(--floor-b));
    border-top-color: rgba(255, 130, 50, 0.35);
  }
  .stage.act3 .fog { background: radial-gradient(ellipse at 30% 50%, rgba(255, 120, 60, 0.14), transparent 60%), radial-gradient(ellipse at 75% 60%, rgba(255, 90, 40, 0.12), transparent 55%); }

  /* ---- particelle: lucciole (1), pulviscolo (2), braci che salgono (3) ---- */
  .particles { position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: hidden; }
  .particles i {
    position: absolute; bottom: 8%; width: calc(4px * var(--z)); height: calc(4px * var(--z)); border-radius: 50%;
    background: var(--pc); box-shadow: 0 0 calc(8px * var(--z)) var(--pc); opacity: 0;
    animation: float var(--t) ease-in-out var(--d) infinite;
  }
  .stage.act3 .particles i { animation-name: ember; bottom: 4%; }
  .stage.act2 .particles i { animation-duration: calc(var(--t) * 1.6); }
  @keyframes float { 0% { opacity: 0; transform: translate(0, 0); } 20% { opacity: 0.9; } 50% { transform: translate(var(--dx), -46px); } 80% { opacity: 0.8; } 100% { opacity: 0; transform: translate(calc(var(--dx) * -0.6), -110px); } }
  @keyframes ember { 0% { opacity: 0; transform: translate(0, 0) scale(1); } 15% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--dx), -320px) scale(0.3); } }
  @keyframes flicker { 0%, 100% { opacity: 0.85; } 40% { opacity: 1; } 55% { opacity: 0.7; } 75% { opacity: 0.95; } }

  .tevent { margin-top: 4px; padding: 3px 12px; border-radius: 10px; font-size: 0.78rem; text-align: center;
    background: rgba(255, 90, 90, 0.18); border: 1px solid rgba(255, 90, 90, 0.6); animation: tevin 0.4s ease-out; }
  .tevent.good { background: rgba(110, 220, 130, 0.16); border-color: rgba(110, 220, 130, 0.6); }
  @keyframes tevin { from { transform: scale(0.85); opacity: 0; } }
  .phase-banner { position: absolute; z-index: 6; left: 50%; top: 52%; transform: translate(-50%, -50%); padding: 12px 26px;
    font-size: 1.3rem; text-align: center; color: #fff; background: rgba(120, 10, 30, 0.82); border: 2px solid #ff6a5a; border-radius: 10px;
    box-shadow: 0 0 40px rgba(255, 60, 40, 0.7); pointer-events: none; animation: phasein 3.2s ease-out forwards; max-width: 80%; }
  @keyframes phasein { 0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; } 10% { transform: translate(-50%, -50%) scale(1.08); opacity: 1; } 85% { opacity: 1; } 100% { opacity: 0; } }

  /* ---- vignetta: boss rosso e pulsante, campione dorato ---- */
  .vignette { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
  .stage.tier-boss .vignette { background: radial-gradient(ellipse at 50% 55%, transparent 45%, rgba(120, 10, 30, 0.55) 100%); animation: bosspulse 2.4s ease-in-out infinite; }
  .stage.tier-champion .vignette { background: radial-gradient(ellipse at 50% 55%, transparent 55%, rgba(140, 100, 10, 0.4) 100%); }
  @keyframes bosspulse { 50% { opacity: 0.55; } }

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
  .nums { font-family: ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace; font-size: calc(12px * var(--ui)); opacity: 0.85; text-align: right; text-shadow: 0 1px 2px #000; }

  /* ---- Schema del nemico ---- */
  .track {
    position: absolute; top: calc(8px * var(--ui)); left: 50%; transform: translateX(-50%);
    z-index: 4; display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none;
  }
  .track-title { font-size: calc(11px * var(--ui)); letter-spacing: 2px; text-transform: uppercase; color: #d9cffb; text-shadow: 0 1px 2px #000; }
  .track-title span { color: #8f86b8; }
  .track-row { display: flex; align-items: stretch; gap: calc(4px * var(--ui)); }
  .tcard {
    --c: #ff5c8a; position: relative; display: grid; grid-template-rows: auto auto auto auto; justify-items: center; align-content: center;
    background: linear-gradient(180deg, rgba(34,22,46,0.92), rgba(20,14,30,0.94)); border: 2px solid var(--c);
    border-radius: 10px; padding: calc(4px * var(--ui)) calc(10px * var(--ui)); min-width: calc(74px * var(--ui)); gap: 1px;
    box-shadow: 0 0 calc(10px * var(--ui)) color-mix(in srgb, var(--c) 45%, transparent), inset 0 0 10px rgba(0,0,0,0.5);
  }
  .tcard.k-attack { --c: #ff5c6c; } .tcard.k-shield { --c: #6cc4ff; } .tcard.k-poison { --c: #8dff5c; } .tcard.k-buff { --c: #ffd84c; }
  .tcard .tag { font-size: calc(9px * var(--ui)); letter-spacing: 1.5px; text-transform: uppercase; color: var(--c); }
  .tcard .ti { font-size: calc(22px * var(--ui)); line-height: 1.1; }
  .tcard .tl { font-size: calc(11px * var(--ui)); color: #eee9ff; white-space: nowrap; }
  .tcard .tv { font-size: calc(15px * var(--ui)); color: #fff; text-shadow: 0 0 8px var(--c); }
  .tcard .tip { font-size: calc(10px * var(--ui)); color: #ffe9a8; white-space: nowrap; }
  .tcard.now { min-width: calc(128px * var(--ui)); transform: scale(1.06); animation: nowpulse 1.6s ease-in-out infinite, tin 0.35s cubic-bezier(.2,1.4,.4,1) both; }
  .tcard.now .ti { font-size: calc(30px * var(--ui)); } .tcard.now .tv { font-size: calc(22px * var(--ui)); }
  .tcard.next { opacity: 0.88; animation: tin 0.35s ease-out both; }
  .tcard.n1 { opacity: 0.72; } .tcard.n2 { opacity: 0.55; }
  .chev { align-self: center; color: #8f86b8; font-size: calc(20px * var(--ui)); }
  .chev.loop { font-size: calc(15px * var(--ui)); opacity: 0.55; }
  .rule { font-size: calc(11px * var(--ui)); max-width: 360px; text-align: center; color: #ffb3c6; text-shadow: 0 1px 2px #000; }
  @keyframes nowpulse { 50% { box-shadow: 0 0 calc(20px * var(--ui)) color-mix(in srgb, var(--c) 80%, transparent), inset 0 0 10px rgba(0,0,0,0.5); } }
  @keyframes tin { from { transform: translateY(-8px) scale(0.9); opacity: 0; } }

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
    .near, .fog, .tcard, .shake, .ovf-tag, .burst.overflow .b-main { animation: none; }
  }
</style>
