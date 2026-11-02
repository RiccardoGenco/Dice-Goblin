<script lang="ts">
  import { onMount } from 'svelte';
  import { GameManager } from '../GameManager';
  import Stage from './Stage.svelte';
  import { SKILLS } from '@core/skills';
  import { BattleState, FaceType, SkillId } from '@core/types';
  import { MAX_EQUIPMENT_SLOTS } from '@core/equipment';
  import {
    playerView, enemyView, intentView, battleState, rolledChips,
    overflowActive, rerollsLeft, diceBusy, effectsView, battleResult, logLines, equipVersion,
    uiPhase, goldView, runLabel, shopOffers, shopSpecial, rewardBanner,
    crossroadSpecial, forgeSpecial, forgeOpsLeft, forgeVersion,
    chainView, skillPreview, rollNonce, runProgress
  } from './stores';

  let canvas: HTMLCanvasElement;
  let gm: GameManager | null = null;
  let selectedChips: number[] = [];

  /* ---- Forgia: stato di selezione ---- */
  let selDie: number | null = null;
  let selFace: number | null = null;
  let fusionMode = false;
  let lastPhase = '';
  $: if ($uiPhase !== lastPhase) {
    lastPhase = $uiPhase;
    selDie = null; selFace = null; fusionMode = false;
  }
  $: forgeBag = $forgeVersion >= 0 && $uiPhase === 'forge' ? (gm?.getForgeBagView() ?? []) : [];
  $: tempraQ = $forgeVersion >= 0 && selDie !== null && selFace !== null
    ? (gm?.quoteTempra(selDie, selFace) ?? null) : null;
  const TRANS_TARGETS = [
    { t: FaceType.MULTIPLIER, label: '→ ×MULT' },
    { t: FaceType.RECURSIVE, label: '→ ↻' },
    { t: FaceType.BUFF_STR, label: '→ +STR' }
  ];
  $: transQs = $forgeVersion >= 0 && selDie !== null && selFace !== null && gm
    ? TRANS_TARGETS.map(tt => ({ ...tt, q: gm.quoteTrasmutazione(selDie ?? 0, selFace ?? 0, tt.t) }))
    : [];
  const INCANTI = [
    { e: 'veleno' as const, label: '☠ Veleno' },
    { e: 'scudo' as const, label: '🛡 Scudo' },
    { e: 'fuoco' as const, label: '🔥 Fuoco' }
  ];
  $: incQs = $forgeVersion >= 0 && selDie !== null && selFace !== null && gm
    ? INCANTI.map(x => ({ ...x, q: gm.quoteIncanto(selDie ?? 0, selFace ?? 0, x.e) }))
    : [];
  $: fusioneQ = $forgeVersion >= 0 && selDie !== null && forgeBag.length > 1
    ? (gm?.quoteFusione(selDie, selDie === 0 ? 1 : 0) ?? null) : null;
  $: riforgQ = $forgeVersion >= 0 && selDie !== null && $forgeSpecial
    ? (gm?.quoteRiforgiatura(selDie) ?? null) : null;

  function onForgeDieClick(di: number): void {
    if (fusionMode && selDie !== null && di !== selDie) {
      // Fusione: selDie assorbe, di viene sacrificato
      gm?.applyForge({ kind: 'fusione', targetIndex: selDie, sacrificeIndex: di });
      fusionMode = false; selDie = null; selFace = null;
      return;
    }
    selDie = di; selFace = null; fusionMode = false;
  }
  function forgeTempra(): void {
    if (selDie !== null && selFace !== null)
      gm?.applyForge({ kind: 'tempra', dieIndex: selDie, faceIndex: selFace });
  }
  function forgeTrans(target: FaceType): void {
    if (selDie !== null && selFace !== null)
      gm?.applyForge({ kind: 'trasmutazione', dieIndex: selDie, faceIndex: selFace, target });
  }
  function forgeIncanto(effect: 'veleno' | 'scudo' | 'fuoco'): void {
    if (selDie !== null && selFace !== null)
      gm?.applyForge({ kind: 'incanto', dieIndex: selDie, faceIndex: selFace, effect });
  }
  function forgeRiforgia(): void {
    if (selDie !== null) gm?.applyForge({ kind: 'riforgiatura', dieIndex: selDie });
  }

  onMount(() => {
    gm = new GameManager(canvas);
    // Il canvas copre il palco, che cambia misura con la finestra: osserva il canvas stesso
    const ro = new ResizeObserver(() => gm?.resize(canvas.clientWidth, canvas.clientHeight));
    ro.observe(canvas);
    void gm.start();
    return () => ro.disconnect();
  });

  /* ---- Nuova run: serve un secondo clic entro 3 secondi ---- */
  let restartArmed = false;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  function onRestart(): void {
    if (!restartArmed) {
      restartArmed = true;
      restartTimer = setTimeout(() => { restartArmed = false; }, 3000);
      return;
    }
    clearTimeout(restartTimer);
    restartArmed = false;
    void gm?.newRun();
  }

  /* ---- Tastiera: 1-4 skill, R rilancia i dadi selezionati, Esc deseleziona ---- */
  function onKey(e: KeyboardEvent): void {
    if ($uiPhase !== 'battle' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); doReroll(); return; }
    if (e.key === 'Escape') { selectedChips = []; return; }
    const idx = Number(e.key) - 1;
    if (idx >= 0 && idx < SKILL_ORDER.length && canAct) {
      e.preventDefault();
      useSkill(SKILL_ORDER[idx]!.id);
    }
  }

  const SKILL_ORDER: { id: SkillId; icon: string; hint: string }[] = [
    { id: SkillId.SGANCIO_BRUTALE, icon: '💥', hint: 'Danno ×1.5' },
    { id: SkillId.SCUDO_GOBLIN,    icon: '🛡️', hint: 'Danno → Scudo' },
    { id: SkillId.SPUTO_ACIDO,     icon: '☠️', hint: '20% Veleno ×3 turni' },
    { id: SkillId.TIRO_TRUCCATO,   icon: '🎲', hint: '×0.5, tieni i rilanci' }
  ];

  $: canAct = $battleState === BattleState.WAIT_PLAYER_ACTION && !$diceBusy && !$battleResult;
  $: canReroll = canAct && $rerollsLeft > 0;
  /* nuovo lancio: la selezione riparte da zero */
  $: if ($rollNonce >= 0) selectedChips = [];

  function useSkill(id: SkillId): void {
    selectedChips = [];
    void gm?.useSkill(id);
  }

  function toggleChip(i: number): void {
    if (!canReroll) return;
    selectedChips = selectedChips.includes(i) ? selectedChips.filter(c => c !== i) : [...selectedChips, i];
  }

  function doReroll(): void {
    if (!canReroll || selectedChips.length === 0) return;
    const chosen = selectedChips;
    selectedChips = [];
    void gm?.rerollDice(chosen);
  }
</script>

<svelte:window on:keydown={onKey} />

<main class="game">
  <!-- ===== Barra alta: progresso della run, relitti, oro ===== -->
  <header class="topbar">
    <div class="run">
      <span class="act">Atto {$runProgress.act}</span>
      <div class="pips" title={$runLabel}>
        {#each Array(10) as _, i}
          <span
            class="pip"
            class:done={i < $runProgress.encounter - 1}
            class:cur={i === $runProgress.encounter - 1}
            class:champ={i === 4}
            class:boss={i === 9}
          ></span>
        {/each}
      </div>
    </div>

    {#key $equipVersion}
      <div class="relics" aria-label="Equipaggiamento">
        {#each Array(MAX_EQUIPMENT_SLOTS) as _, i}
          {@const item = gm?.equipment.slots[i] ?? null}
          <button
            class="relic" class:filled={item}
            title={item ? `${item.name} — ${item.description} (clic: rimuovi)` : 'Slot vuoto'}
            on:click={() => item && gm?.unequipSlot(i)}
          >{item ? item.icon : ''}</button>
        {/each}
      </div>
    {/key}

    <div class="topright">
      <span class="gold" title="Oro">💰 {$goldView}</span>
      <button class="restart" class:armed={restartArmed} on:click={onRestart}>
        {restartArmed ? 'Sicuro? Perdi la run' : '↻ Nuova run'}
      </button>
    </div>
  </header>

  <!-- ===== Palco: sprite, HP, intento, dadi 3D, effetti ===== -->
  <div class="stage-area">
    <Stage>
      <canvas slot="overlay" bind:this={canvas} class="arena"></canvas>
    </Stage>
    <div class="feed" aria-live="polite">
      {#each $logLines.slice(0, 3) as line, i (line + i)}<div style="opacity:{1 - i * 0.3}">{line}</div>{/each}
    </div>
  </div>

  <!-- ===== Striscia del tiro: facce, moltiplicatore, potenza ===== -->
  <section class="scorebar">
    <div class="tray">
      {#key $rollNonce}
        {#each $rolledChips as chip, i}
          <button
            class="chip {chip.cssClass}"
            style="--i:{i}"
            class:selected={selectedChips.includes(i)}
            class:selectable={canReroll}
            on:click={() => toggleChip(i)}
          >{chip.text}</button>
        {/each}
      {/key}
    </div>
    <div class="side">
      {#if $effectsView && $battleState === BattleState.WAIT_PLAYER_ACTION && ($effectsView.poison || $effectsView.shield || $effectsView.fire)}
        <div class="fxsum" title="Effetti delle facce incantate uscite">
          {#if $effectsView.poison}<span class="e-p">☠ {$effectsView.poison}/t</span>{/if}
          {#if $effectsView.shield}<span class="e-s">🛡 +{$effectsView.shield}</span>{/if}
          {#if $effectsView.fire}<span class="e-f">🔥 {$effectsView.fire}</span>{/if}
          {#each $effectsView.reactions as r (r.id)}<span class="react" title={r.text}>⚗️ {r.name}</span>{/each}
        </div>
      {/if}
      {#if $chainView && $battleState === BattleState.WAIT_PLAYER_ACTION}
        <div class="formula" class:hot={$chainView.tier >= 2}>
          {#if $chainView.multCount > 0}<span class="f-mult">×{$chainView.mult}</span>{/if}
          <span class="f-pow"><small>Potenza</small> <b>{$chainView.power}</b></span>
        </div>
      {/if}
      <button class="reroll" disabled={!canReroll || selectedChips.length === 0} on:click={doReroll}
        title="Seleziona i dadi da rilanciare, gli altri restano">
        🎲 Rilancia {selectedChips.length > 0 ? `(${selectedChips.length})` : ''}
        <small>{$rerollsLeft} rimasti · <kbd>R</kbd></small>
      </button>
    </div>
  </section>

  <!-- ===== Dock: la "mano" di 4 skill + zaino ===== -->
  <footer class="dock">
    <div class="hand">
      {#each SKILL_ORDER as s, i}
        <button class="card" disabled={!canAct} on:click={() => useSkill(s.id)}>
          <kbd class="key">{i + 1}</kbd>
          <span class="c-icon">{s.icon}</span>
          <span class="c-name">{SKILLS[s.id].name}</span>
          <span class="c-preview">{$skillPreview[s.id] ?? '…'}</span>
          <span class="c-hint">{s.hint}</span>
        </button>
      {/each}
    </div>
    {#key $equipVersion}
      <div class="bag">
        <span class="bag-title">Zaino</span>
        <div class="bag-items">
          {#each gm?.inventory ?? [] as item}
            <button class="inv-item" title={`${item.name} — ${item.description} (clic: equipaggia)`}
              on:click={() => gm?.equipItem(item)}>{item.icon}</button>
          {/each}
        </div>
      </div>
    {/key}
  </footer>

  <!-- ===== Overlay Shop (tra un incontro e l'altro) ===== -->
  {#if $uiPhase === 'shop'}
    <div class="overlay">
      <div class="overlay-box shop-box" class:royal={$shopSpecial}>
        <h2>{$shopSpecial ? '👑 Il Mercante Reale' : '🛒 Il Mercante Goblin'}</h2>
        {#if $shopSpecial}<p class="unlock">Prezzi scontati del 30% — bottino da boss fight!</p>{/if}
        {#if $rewardBanner}<p class="unlock">{$rewardBanner}</p>{/if}
        <p class="gold">💰 {$goldView} oro</p>
        <div class="offers">
          {#each $shopOffers as offer (offer.id)}
            <button
              class="offer"
              disabled={!offer.affordable}
              title={offer.description}
              on:click={() => gm?.buyOffer(offer.id)}
            >
              <span class="icon">{offer.icon}</span>
              <span class="label">{offer.label}</span>
              <span class="hint">{offer.description}</span>
              <span class="cost" class:too-expensive={!offer.affordable}>💰 {offer.cost}</span>
            </button>
          {/each}
          {#if $shopOffers.length === 0}
            <p class="hint">Hai svuotato il banco del mercante!</p>
          {/if}
        </div>
        <button class="skill" on:click={() => void gm?.leaveShop()}>⚔️ Prossimo incontro</button>
      </div>
    </div>
  {/if}

  <!-- ===== Overlay Bivio (specs §7 / §7.bis) ===== -->
  {#if $uiPhase === 'crossroad'}
    <div class="overlay">
      <div class="overlay-box" class:royal={$crossroadSpecial}>
        <h2>{$crossroadSpecial ? '✨ Bivio Dorato' : '⚖️ Il Bivio'}</h2>
        {#if $rewardBanner}<p class="unlock">{$rewardBanner}</p>{/if}
        <p class="hint-line">Scegli una porta: l'altra si chiuderà. 💰 {$goldView} oro</p>
        <div class="doors">
          <button class="door" class:golden={$crossroadSpecial} on:click={() => gm?.chooseDoor('shop')}>
            <span class="icon">{$crossroadSpecial ? '👑' : '🛒'}</span>
            <span class="label">{$crossroadSpecial ? 'Mercante Reale' : 'Il Mercante'}</span>
            <span class="hint">{$crossroadSpecial ? 'Sconto 30% e offerta premium' : 'Stat, oggetti e dadi'}</span>
          </button>
          <button class="door" class:golden={$crossroadSpecial} on:click={() => gm?.chooseDoor('forge')}>
            <span class="icon">🔨</span>
            <span class="label">{$crossroadSpecial ? 'Gran Forgia' : 'La Forgia'}</span>
            <span class="hint">{$crossroadSpecial ? '3 operazioni, Trasmutazione -50%' : 'Scolpisci le facce dei dadi'}</span>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ===== Overlay Forgia (specs §9 / §9.bis) ===== -->
  {#if $uiPhase === 'forge'}
    <div class="overlay">
      <div class="overlay-box forge-box" class:royal={$forgeSpecial}>
        <h2>{$forgeSpecial ? '🔥 La Gran Forgia' : '🔨 La Forgia dei Dadi'}</h2>
        <p class="hint-line">💰 {$goldView} oro — Operazioni rimaste: {$forgeOpsLeft}</p>
        {#if fusionMode}
          <p class="unlock">⚒️ Scegli il dado da SACRIFICARE (D{(selDie ?? 0) + 1} ne assorbirà la faccia migliore)</p>
        {/if}
        <div class="forge-dice">
          {#each forgeBag as fdie, di}
            <button class="forge-die" class:selected={selDie === di}
              class:sacrifice={fusionMode && selDie !== di}
              on:click={() => onForgeDieClick(di)}>
              <span>{fdie.icon} D{di + 1}</span>
              <span class="hint">{fdie.blueprintName ?? fdie.rarityName}</span>
            </button>
          {/each}
        </div>
        {#if selDie !== null && forgeBag[selDie]}
          <div class="chips forge-chips">
            {#each forgeBag[selDie].faces as chip, fi}
              <button class="chip {chip.cssClass}" class:selected={selFace === fi}
                on:click={() => { selFace = fi; fusionMode = false; }}>{chip.text}</button>
            {/each}
          </div>
          <div class="services">
            <button class="service" disabled={!tempraQ?.ok || $forgeOpsLeft === 0}
              title={tempraQ?.reason ?? 'Seleziona una faccia'} on:click={forgeTempra}>
              <span>🔥 Tempra</span>
              {#if tempraQ}<span class="cost">💰 {tempraQ.cost}</span>{/if}
              {#if tempraQ?.preview}<span class="hint">{tempraQ.preview}</span>{/if}
            </button>
            {#each transQs as tq (tq.label)}
              <button class="service" disabled={!tq.q.ok || $forgeOpsLeft === 0}
                title={tq.q.reason ?? tq.q.preview} on:click={() => forgeTrans(tq.t)}>
                <span>⚗️ {tq.label}</span>
                <span class="cost">💰 {tq.q.cost}</span>
              </button>
            {/each}
            {#each incQs as iq (iq.e)}
              <button class="service" disabled={!iq.q.ok || $forgeOpsLeft === 0}
                title={iq.q.reason ?? iq.q.preview} on:click={() => forgeIncanto(iq.e)}>
                <span>✨ Incanta {iq.label}</span>
                <span class="cost">💰 {iq.q.cost}</span>
              </button>
            {/each}
            <button class="service" class:selected={fusionMode}
              disabled={forgeBag.length < 2 || $forgeOpsLeft === 0}
              title="Sacrifica un dado: questo ne eredita la faccia migliore e sale di rarità"
              on:click={() => (fusionMode = !fusionMode)}>
              <span>⚒️ Fusione</span>
              {#if fusioneQ}<span class="cost">💰 {fusioneQ.cost}</span>{/if}
            </button>
            {#if $forgeSpecial}
              <button class="service" disabled={!riforgQ?.ok || $forgeOpsLeft === 0}
                title={riforgQ?.reason ?? riforgQ?.preview} on:click={forgeRiforgia}>
                <span>🌋 Riforgiatura</span>
                {#if riforgQ}<span class="cost">💰 {riforgQ.cost}</span>{/if}
                {#if riforgQ?.preview}<span class="hint">{riforgQ.preview}</span>{/if}
              </button>
            {/if}
          </div>
        {:else}
          <p class="hint-line">Seleziona un dado per vedere le sue facce</p>
        {/if}
        <button class="skill" on:click={() => void gm?.leaveForge()}>⚔️ Prossimo incontro</button>
      </div>
    </div>
  {/if}

  <!-- ===== Overlay fine run / sconfitta ===== -->
  {#if $uiPhase === 'run-complete'}
    <div class="overlay">
      <div class="overlay-box">
        <h2>👑 RUN COMPLETATA!</h2>
        <p>Hai sconfitto tutti e 3 i Boss. Il pool dei dadi è più ricco per sempre.</p>
        {#if $rewardBanner}<p class="unlock">{$rewardBanner}</p>{/if}
        <button class="skill" on:click={() => void gm?.newRun()}>🔄 Nuova Run</button>
      </div>
    </div>
  {:else if $battleResult === 'defeat'}
    <div class="overlay">
      <div class="overlay-box">
        <h2>💀 Run terminata</h2>
        <p>Il Goblin è caduto. Gli sblocchi permanenti restano tuoi.</p>
        <button class="skill" on:click={() => void gm?.newRun()}>🔄 Nuova Run</button>
      </div>
    </div>
  {/if}
</main>

<style>
  /* ============================================================
   * Schermata di gioco: una sola vista a tutta altezza, niente scroll.
   *   topbar  → progresso run, relitti equipaggiati, oro
   *   palco   → sprite, HP, intento, dadi 3D (occupa tutto lo spazio libero)
   *   scorebar→ facce del tiro, moltiplicatore, potenza
   *   dock    → la "mano" di 4 skill (tasti 1-4) + zaino
   * ============================================================ */
  .game {
    --ink: #ece8f6; --muted: #9a93b3; --line: #3a3354; --panel: #17132a;
    --pink: #ff5c8a; --gold: #ffd84c; --green: #7dff9b; --cyan: #5cd0ff;
    height: 100%; box-sizing: border-box; max-width: 1400px; margin: 0 auto;
    padding: 8px 12px 10px;
    display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: 8px;
    font-family: 'Pixelify Sans', ui-monospace, monospace; color: var(--ink);
  }
  .mini {
    font-size: 12px; padding: 3px 10px; cursor: pointer; font-family: inherit;
    background: #2a2442; color: inherit; border: 1px solid #5a5080; border-radius: 4px;
  }
  kbd {
    font-family: inherit; font-size: 10px; padding: 0 5px; border-radius: 3px;
    border: 1px solid currentColor; opacity: 0.7;
  }

  /* ---- Barra alta ---- */
  .topbar {
    display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px;
  }
  .run { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .act { font-weight: 700; color: #ffb84c; letter-spacing: 1px; white-space: nowrap; }
  .pips { display: flex; gap: 5px; align-items: center; }
  .pip { width: 10px; height: 10px; border-radius: 2px; background: #2a2442; border: 1px solid #4a4268; }
  .pip.done { background: #6a5da8; border-color: #8c7fd0; }
  .pip.cur { background: var(--green); border-color: #fff; box-shadow: 0 0 8px var(--green); transform: scale(1.25); }
  .pip.champ, .pip.boss { border-radius: 50%; width: 13px; height: 13px; border-color: var(--gold); }
  .pip.boss { border-color: var(--pink); }
  .pip.champ.done, .pip.boss.done { background: #8a6a2a; }
  .relics { display: flex; gap: 6px; }
  .relic {
    width: 38px; height: 38px; border-radius: 6px; font-size: 20px; cursor: pointer; padding: 0;
    background: #0e0b1c; border: 1px dashed #4a4268; color: var(--muted);
  }
  .relic.filled { border-style: solid; border-color: #ffb84c; background: #2a2010; }
  .topright { display: flex; justify-content: flex-end; align-items: center; gap: 14px; }
  .gold { color: var(--gold); font-weight: 700; font-size: 18px; }
  .restart {
    font-family: inherit; font-size: 12px; padding: 4px 10px; cursor: pointer; color: var(--muted);
    background: transparent; border: 1px solid var(--line); border-radius: 4px;
  }
  .restart:hover { color: var(--ink); border-color: #6a5da8; }
  .restart.armed { color: #fff; background: #6a1830; border-color: var(--pink); }

  /* ---- Palco + registro eventi ---- */
  .stage-area { position: relative; min-height: 0; }
  .feed {
    position: absolute; left: 14px; bottom: 10px; z-index: 8; pointer-events: none;
    display: flex; flex-direction: column-reverse; gap: 2px; font-size: 13px; max-width: 46%;
    text-shadow: 0 1px 2px #000, 0 0 6px #000;
  }

  /* ---- Striscia del tiro ---- */
  .scorebar {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    min-height: 54px; padding: 4px 12px; border-radius: 8px;
    background: linear-gradient(180deg, #1c1735, #120f24); border: 1px solid var(--line);
  }
  .tray { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-width: 0; }
  .chip {
    border-radius: 6px; padding: 5px 14px; border: 2px solid #4a4268; background: #241f3d; color: var(--ink);
    font-family: inherit; font-size: 20px; font-weight: 600; min-width: 42px;
    animation: chip-in 0.4s cubic-bezier(.2,1.5,.4,1) both; animation-delay: calc(var(--i) * 70ms);
  }
  @keyframes chip-in { from { transform: translateY(10px) scale(0.5); opacity: 0; } to { transform: none; opacity: 1; } }
  .chip.multiplier { border-color: var(--pink); color: var(--pink); font-weight: 700; box-shadow: 0 0 10px rgba(255,92,138,0.55); }
  .chip.buff { border-color: var(--green); color: var(--green); }
  .chip.recursive { border-color: var(--cyan); color: var(--cyan); }
  .chip.selectable { cursor: pointer; }
  .chip.selected { outline: 3px solid #ffb84c; outline-offset: 2px; }
  .formula { display: flex; gap: 18px; align-items: baseline; white-space: nowrap; }
  .f-mult { color: var(--pink); font-weight: 700; font-size: 26px; text-shadow: 0 0 10px rgba(255,92,138,0.6); }
  .formula.hot .f-mult { font-size: 34px; color: #ffb84c; text-shadow: 0 0 14px rgba(255,150,0,0.85); }
  .f-pow small { color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 2px; }
  .f-pow b { color: var(--gold); font-size: 28px; font-weight: 700; }
  .side { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; justify-content: flex-end; }
  .reroll {
    background: #1f1a33; border: 2px solid #ffb84c; color: #ffe2a8; border-radius: 10px;
    padding: 6px 14px; font: inherit; font-weight: 700; cursor: pointer; display: flex; flex-direction: column; align-items: center; line-height: 1.1;
  }
  .reroll small { font-weight: 400; font-size: 11px; color: var(--muted); }
  .reroll:disabled { opacity: 0.4; cursor: default; border-color: #4a4466; }
  .fxsum { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-weight: 700; font-size: 17px; }
  .e-p { color: #7dff4c; } .e-s { color: #6cc4ff; } .e-f { color: #ff8a3c; }
  .react { color: #ffd84c; background: #3a2a52; border: 1px solid #ffd84c; border-radius: 12px; padding: 1px 10px; font-size: 14px; animation: chip-in 0.4s cubic-bezier(.2,1.5,.4,1) both; }
  .reroll-hint { font-size: 14px; color: #ffb84c; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

  /* ---- Dock: la mano di carte ---- */
  .dock { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: end; }
  .hand { display: grid; grid-template-columns: repeat(4, minmax(0, 210px)); gap: 12px; justify-content: center; }
  .card {
    position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 14px 8px 10px; cursor: pointer; font-family: inherit; color: var(--ink);
    background: linear-gradient(180deg, #3a1f55, #231238); border: 2px solid var(--pink); border-radius: 10px;
    box-shadow: 0 4px 0 #14091f; transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease;
  }
  .card:hover:not(:disabled) { transform: translateY(-8px); box-shadow: 0 12px 0 #14091f, 0 0 18px rgba(255,92,138,0.45); }
  .card:active:not(:disabled) { transform: translateY(-2px); }
  .card:focus-visible { outline: 3px solid var(--cyan); outline-offset: 2px; }
  .card:disabled { opacity: 0.4; cursor: default; filter: saturate(0.5); }
  .key { position: absolute; top: 6px; left: 8px; }
  .c-icon { font-size: 34px; line-height: 1; }
  .c-name { font-size: 15px; font-weight: 700; text-align: center; }
  .c-preview { font-size: 22px; font-weight: 700; color: var(--gold); text-align: center; min-height: 28px; }
  .c-hint { font-size: 12px; color: #c9b8e8; opacity: 0.85; text-align: center; }
  .bag {
    display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; min-width: 130px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  }
  .bag-title { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 2px; }
  .bag-items { display: flex; flex-wrap: wrap; gap: 6px; max-width: 170px; }
  .inv-item {
    width: 34px; height: 34px; border-radius: 6px; font-size: 18px; cursor: pointer; padding: 0;
    background: #1f3d2a; border: 1px solid #4cc94c;
  }
  .inv-item:hover { transform: translateY(-2px); }

  /* ---- Schermi stretti (telefono in verticale) ---- */
  @media (max-width: 760px) {
    .game { height: auto; min-height: 100%; grid-template-rows: auto minmax(260px, 40vh) auto auto; gap: 6px; padding: 6px 8px 8px; }
    .topbar { grid-template-columns: 1fr auto; gap: 6px 8px; padding: 6px 8px; }
    .act { font-size: 13px; }
    .pips { gap: 3px; }
    .pip { width: 8px; height: 8px; }
    .pip.champ, .pip.boss { width: 10px; height: 10px; }
    .relics { grid-column: 1 / -1; order: 3; justify-content: center; gap: 4px; }
    .relic { width: 30px; height: 30px; font-size: 16px; }
    .restart { display: none; }
    .scorebar { flex-direction: column; align-items: stretch; gap: 4px; min-height: 0; padding: 6px 8px; }
    .chip { font-size: 16px; padding: 3px 10px; min-width: 34px; }
    .f-mult { font-size: 20px; }
    .formula.hot .f-mult { font-size: 24px; }
    .f-pow b { font-size: 22px; }
    .formula { justify-content: space-between; }
    .side { justify-content: space-between; gap: 8px; }
      .dock { grid-template-columns: 1fr; }
    .hand { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .card { padding: 8px 6px 6px; flex-direction: row; flex-wrap: wrap; justify-content: center; gap: 2px 8px; }
    .c-icon { font-size: 24px; }
    .c-name { font-size: 13px; }
    .c-preview { font-size: 17px; min-height: 0; flex-basis: 100%; }
    .c-hint { display: none; }
    .key { display: none; }
    .bag { flex-direction: row; align-items: center; padding: 4px 8px; }
    .feed { font-size: 11px; max-width: 70%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .chip, .card { animation: none; transition: none; }
  }

  .overlay {
    position: fixed; inset: 0; background: rgba(10, 10, 14, 0.85);
    display: flex; align-items: center; justify-content: center; z-index: 10;
  }
  .overlay-box {
    background: linear-gradient(180deg, #1d1736, #130f26); border: 2px solid #ff5c8a; border-radius: 12px;
    padding: 28px 40px; text-align: center; display: flex; flex-direction: column; gap: 12px;
    max-height: 92vh; overflow-y: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.6);
  }
  .overlay-box h2 { margin: 0; letter-spacing: 1px; }
  /* pulsanti d'azione dell'overlay (Prossimo incontro, Continua...) in tema col gioco */
  .overlay-box > button {
    font-family: inherit; font-size: 16px; font-weight: 600; padding: 10px 18px; cursor: pointer;
    color: #fff; background: linear-gradient(180deg, #3a1f55, #231238);
    border: 2px solid #ff5c8a; border-radius: 8px; box-shadow: 0 3px 0 #14091f;
  }
  .overlay-box > button:hover { filter: brightness(1.2); }
  .overlay-box > button:focus-visible { outline: 3px solid #5cd0ff; outline-offset: 2px; }
  @media (max-width: 760px) { .overlay-box { padding: 18px 14px; width: calc(100% - 24px); box-sizing: border-box; } .shop-box, .forge-box { min-width: 0; } }

  /* ---- Meta: shop ---- */
  .unlock { color: #7dff9b; font-weight: bold; }
  .shop-box { min-width: 420px; }
  .offers { display: flex; flex-direction: column; gap: 8px; }
  .offer {
    display: grid; grid-template-columns: 32px 1fr auto; grid-template-rows: auto auto;
    gap: 2px 10px; align-items: center; text-align: left; cursor: pointer;
    background: #1f3d2a; border: 1px solid #4cc94c; border-radius: 8px;
    padding: 8px 12px; color: #e8e8f0; font-family: inherit;
  }
  .offer .icon { grid-row: span 2; font-size: 20px; }
  .offer .label { font-weight: bold; font-size: 13px; }
  .offer .hint { grid-column: 2; font-size: 11px; opacity: 0.75; }
  .offer .cost { grid-row: span 2; color: #ffd84c; font-size: 12px; }
  .offer:disabled { opacity: 0.4; cursor: default; }
  .cost.too-expensive { color: #ff5c5c; }
  .shop-box.royal { border-color: #ffd84c; box-shadow: 0 0 24px rgba(255, 216, 76, 0.25); }

  /* ---- Bivio e Forgia ---- */
  .hint-line { font-size: 12px; opacity: 0.85; margin: 0; }
  .overlay-box.royal { border-color: #ffd84c; box-shadow: 0 0 24px rgba(255, 216, 76, 0.25); }
  .doors { display: flex; gap: 14px; justify-content: center; }
  .door {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 18px 22px; min-width: 170px; cursor: pointer; font-family: inherit;
    background: #1f3d2a; border: 1px solid #4cc94c; border-radius: 10px; color: #e8e8f0;
  }
  .door .icon { font-size: 28px; }
  .door .label { font-weight: bold; }
  .door .hint { font-size: 10px; opacity: 0.75; }
  .door.golden { background: #3d3016; border-color: #ffd84c; }
  .door:hover { transform: translateY(-2px); }

  .forge-box { min-width: 460px; max-width: 560px; }
  .forge-dice { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .forge-die {
    display: flex; flex-direction: column; gap: 2px; padding: 8px 12px;
    background: #101014; border: 1px solid #444; border-radius: 8px;
    color: #e8e8f0; cursor: pointer; font-family: inherit;
  }
  .forge-die.selected { border-color: #ffb84c; outline: 1px solid #ffb84c; }
  .forge-die.sacrifice { border-color: #ff5c5c; animation: pulse 0.8s infinite alternate; }
  @keyframes pulse { from { box-shadow: 0 0 2px #ff5c5c; } to { box-shadow: 0 0 12px #ff5c5c; } }
  .forge-die .hint { font-size: 10px; opacity: 0.7; }
  .forge-chips { justify-content: center; }
  .services { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
  .service {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    padding: 6px 10px; font-size: 12px; cursor: pointer; font-family: inherit;
    background: #3d1f4f; border: 1px solid #ff5c8a; border-radius: 8px; color: #ffd9e5;
  }
  .service:disabled { opacity: 0.35; cursor: default; }
  .service.selected { outline: 2px solid #ffb84c; }
  .service .cost { color: #ffd84c; font-size: 11px; }
  .service .hint { font-size: 10px; opacity: 0.8; }
</style>
