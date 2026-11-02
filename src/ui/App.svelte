<script lang="ts">
  import { onMount } from 'svelte';
  import { GameManager } from '../GameManager';
  import Stage from './Stage.svelte';
  import { SKILLS } from '@core/skills';
  import { BattleState, FaceType, SkillId } from '@core/types';
  import { MAX_EQUIPMENT_SLOTS } from '@core/equipment';
  import { formatBigNumber } from '@core/format';
  const TIER_NAME: Record<string, string> = { 'comune': 'Tier 1 · comune', 'non-comune': 'Tier 2 · non comune', 'raro': 'Tier 3 · raro' };
  import {
    playerView, enemyView, intentView, battleState, rolledChips,
    overflowActive, rerollsLeft, diceBusy, effectsView, battleResult, logLines, equipVersion,
    menuOpen, menuInfo, runSummary,
    uiPhase, goldView, runLabel, shopOffers, shopInfo, shopSpecial, rewardBanner,
    crossroadSpecial, forgeSpecial, forgeOpsLeft, forgeVersion,
    chainView, skillPreview, skillHints, rollNonce, runProgress
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
    return () => ro.disconnect();
  });

  /* ---- Menù, registro e fine run ---- */
  let logText: string | null = null;
  let howTo = false;
  let copied = false;
  let newArmed = false;
  let newTimer: ReturnType<typeof setTimeout> | undefined;

  function openLog(which: 'current' | 'last'): void { logText = gm?.getLogText(which) ?? ''; }
  async function copyLog(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback: selezione nel textarea
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* niente */ }
      ta.remove();
    }
    copied = true;
    setTimeout(() => { copied = false; }, 1800);
  }
  async function downloadLog(text: string): Promise<void> {
    const filename = `goblin-revenge-registro-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
    // nella pagina pubblicata il download passa dal visualizzatore (capability `downloads`)
    const c = (window as unknown as { claude?: { use?: (n: string) => Promise<{ save: (r: { filename: string; data: string }) => Promise<unknown> } | null> } }).claude;
    if (c?.use) {
      try {
        const dl = await c.use('downloads');
        if (dl) { await dl.save({ filename, data: text }); return; }
      } catch { /* rifiutato o non disponibile: si prova il metodo normale */ }
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function startNew(): void {
    // con una run in corso serve un secondo clic
    if (($menuInfo.hasSave || $menuInfo.inProgress) && !newArmed) {
      newArmed = true;
      newTimer = setTimeout(() => { newArmed = false; }, 3000);
      return;
    }
    clearTimeout(newTimer); newArmed = false;
    gm?.newRunFromMenu();
  }
  function endNew(): void { gm?.newRunFromMenu(); }
  function endMenu(): void { runSummary.set(null); menuOpen.set(true); }

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
    if ($menuOpen || logText !== null || $uiPhase !== 'battle' || e.ctrlKey || e.metaKey || e.altKey) return;
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
    { id: SkillId.PARATA,          icon: '🛡️', hint: 'Scudo; se attacca, rimbalza 50%' },
    { id: SkillId.BAVA,            icon: '☠️', hint: '60% Veleno ×3, ignora scudo' },
    { id: SkillId.CARICA,          icon: '⚡', hint: 'Salta il turno: tieni le facce, poi ×1.5' }
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
            title={item ? `${item.name} — ${item.description}` : 'Slot vuoto: compra oggetti dal mercante'}
          >{item ? item.icon : ''}</button>
        {/each}
      </div>
    {/key}

    <div class="topright">
      <span class="gold" title="Oro">💰 {$goldView}</span>
      <button class="restart" on:click={() => menuOpen.set(true)}>☰ Menù</button>
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
          <span class="f-pow"><small>Potenza</small> <b class="num">{$chainView.power}</b></span>
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
          {#if $skillHints[s.id]}<span class="c-alert {$skillHints[s.id]?.kind}">{$skillHints[s.id]?.text}</span>{/if}
          <span class="c-hint">{s.hint}</span>
        </button>
      {/each}
    </div>
  </footer>

  <!-- ===== Overlay Shop (tra un incontro e l'altro) ===== -->
  {#if $uiPhase === 'shop'}
    <div class="overlay">
      <div class="overlay-box shop-box" class:royal={$shopSpecial}>
        <h2>{$shopSpecial ? '👑 Il Mercante Reale' : '🛒 Il Mercante Goblin'}</h2>
        {#if $shopSpecial}<p class="unlock">Prezzi scontati del 30% — bottino da boss fight!</p>{/if}
        {#if $rewardBanner}<p class="unlock">{$rewardBanner}</p>{/if}
        <p class="gold">💰 {$goldView} oro <span class="hpnow">· ❤️ {$shopInfo.hp}</span></p>
        <div class="offers">
          {#each $shopOffers.filter(o => !o.service) as offer (offer.id)}
            <button
              class="offer {offer.rarity ?? ''}"
              disabled={!offer.affordable}
              title={offer.description}
              on:click={() => gm?.buyOffer(offer.id)}
            >
              <span class="icon">{offer.icon}</span>
              <span class="label">{offer.label}{#if offer.rarity} <small class="tier">{TIER_NAME[offer.rarity] ?? ''}</small>{/if}</span>
              <span class="hint">{offer.description}{offer.note ? ` — ${offer.note}` : ''}</span>
              <span class="cost" class:too-expensive={!offer.affordable}>💰 {offer.cost}</span>
            </button>
          {/each}
          {#if $shopOffers.filter(o => !o.service).length === 0}
            <p class="hint">Banco vuoto: rilancia per vedere nuova merce.</p>
          {/if}
        </div>
        <div class="shop-actions">
          <button class="shop-reroll" disabled={!$shopInfo.canReroll} on:click={() => gm?.rerollShop()}
            title="Rimescola oggetti, faccia e dado in vendita. Ogni rilancio della visita costa di più.">
            🔄 Rilancia il banco <b class="num">💰 {$shopInfo.rerollCost}</b>
          </button>
          {#each $shopOffers.filter(o => o.service) as offer (offer.id)}
            <button class="offer service" disabled={!offer.affordable} title={offer.description}
              on:click={() => gm?.buyOffer(offer.id)}>
              <span class="icon">{offer.icon}</span>
              <span class="label">{offer.label}</span>
              <span class="cost" class:too-expensive={!offer.affordable}>💰 {offer.cost}</span>
            </button>
          {/each}
        </div>
        {#key $equipVersion + ':' + $goldView}
          <div class="sellrow" aria-label="I tuoi oggetti">
            <span class="hint">I tuoi oggetti (clic: vendi a metà prezzo)</span>
            <div class="slots">
              {#each Array(MAX_EQUIPMENT_SLOTS) as _, i}
                {@const it = gm?.equipment.slots[i] ?? null}
                {@const val = gm?.sellValueOf(i) ?? null}
                <button class="sellslot {it?.rarity ?? ''}" disabled={!it}
                  title={it ? `${it.name} — ${it.description}` : 'Slot vuoto'}
                  on:click={() => gm?.sellSlot(i)}>
                  <span>{it ? it.icon : ''}</span>
                  {#if val}<small>💰{formatBigNumber(val)}</small>{/if}
                </button>
              {/each}
            </div>
          </div>
        {/key}
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

  <!-- ===== Schermata di fine run ===== -->
  {#if $runSummary}
    <div class="overlay">
      <div class="overlay-box summary-box" class:royal={$runSummary.outcome === 'vittoria'}>
        <h2>{$runSummary.title}</h2>
        <p class="hint-line">
          {$runSummary.endLabel}{$runSummary.killedBy ? ` — sconfitto da ${$runSummary.killedBy}` : ''}
        </p>
        {#if $rewardBanner}<p class="unlock">{$rewardBanner}</p>{/if}
        <div class="sum-grid">
          {#each $runSummary.rows as [label, value]}
            <span class="sum-l">{label}</span><span class="sum-v">{value}</span>
          {/each}
        </div>
        {#if $runSummary.actions.length}
          <div class="sum-actions">
            {#each $runSummary.actions as a}
              <div class="bar"><span>{a.name}</span><i style={`width:${a.pct}%`}></i><b>{a.pct}%</b></div>
            {/each}
          </div>
        {/if}
        <p class="hint-line">
          {#each $runSummary.items as it}<span title={it.name}>{it.icon} </span>{/each}
          {$runSummary.items.length ? '·' : 'Nessun oggetto ·'} {$runSummary.build}
        </p>
        <div class="btn-row">
          <button class="skill" on:click={endNew}>🔄 Nuova run</button>
          <button class="ghost" on:click={() => openLog('last')}>📜 Leggi il registro</button>
          <button class="ghost" on:click={() => gm && copyLog(gm.getLogText('last'))}>{copied ? '✔ Copiato' : '📋 Copia registro'}</button>
          <button class="ghost" on:click={() => gm && downloadLog(gm.getLogText('last'))}>⬇️ Scarica</button>
          <button class="ghost" on:click={endMenu}>☰ Menù</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ===== Menù iniziale ===== -->
  {#if $menuOpen}
    <div class="overlay menu">
      <div class="overlay-box menu-box">
        <h1 class="logo">GOBLIN<br />REVENGE</h1>
        <p class="hint-line">Un goblin, una borsa di dadi e una vendetta esponenziale.</p>
        <div class="menu-btns">
          {#if $menuInfo.hasSave || $menuInfo.inProgress}
            <button class="skill" on:click={() => gm?.resumeFromMenu()}>
              ▶ {$menuInfo.inProgress ? 'Riprendi' : 'Continua'}
              <small>{$menuInfo.saveLabel} · 💰 {$menuInfo.gold}</small>
            </button>
          {/if}
          <button class={$menuInfo.hasSave || $menuInfo.inProgress ? 'ghost' : 'skill'} on:click={startNew}>
            {newArmed ? 'Sicuro? Perdi la run attuale' : '⚔️ Nuova run'}
          </button>
          <button class="ghost" on:click={() => (howTo = true)}>❓ Come si gioca</button>
          <button class="ghost" disabled={!$menuInfo.inProgress && !$menuInfo.hasSave} on:click={() => openLog('current')}>📜 Registro della run in corso</button>
          <button class="ghost" disabled={!$menuInfo.hasLastLog} on:click={() => openLog('last')}>🗂️ Registro dell'ultima run</button>
        </div>
        <p class="hint-line">Il registro annota ogni turno: copialo e mandamelo dopo una partita.</p>
      </div>
    </div>
  {/if}

  <!-- ===== Come si gioca ===== -->
  {#if howTo}
    <div class="overlay menu" on:click|self={() => (howTo = false)}>
      <div class="overlay-box howto">
        <h2>❓ Come si gioca</h2>
        <ul>
          <li><b>Ogni turno</b> i dadi della borsa vengono lanciati. Il danno è (Forza + facce normali) × moltiplicatori × azione.</li>
          <li><b>Rilanci gratuiti:</b> tocca i dadi da rilanciare e premi <kbd>R</kbd>. Gli altri restano fermi.</li>
          <li><b>Azioni</b> (tasti <kbd>1</kbd>-<kbd>4</kbd>): Sgancio (colpo sicuro), Parata (scudo che rimbalza se il nemico attacca), Bava (veleno forte, ignora lo scudo), Carica (salti il turno, tieni le facce, il lancio dopo vale ×1.5). Leggi sempre l'intento del nemico.</li>
          <li><b>Facce incantate:</b> ☠ veleno, 🛡 scudo, 🔥 fuoco. Se escono insieme reagiscono: Vapori (☠🔥), Scudo ardente (🛡🔥), Spore (☠🛡).</li>
          <li><b>Dopo ogni incontro</b> scegli una porta: Mercante (oggetti su tre livelli di rarità, facce, dadi, pozioni, e un rilancio del banco che costa sempre di più) o Forgia (migliora le facce). Forza e Vitalità crescono da sole a ogni vittoria. Una parte dell'oro che non spendi ti torna come interesse. Un incontro su cinque è un Campione o un Boss, con sconti e bottino migliori.</li>
          <li><b>Gli HP restano:</b> +20% dopo ogni vittoria, pieni dopo Campioni e Boss. 5 oggetti al massimo, rivendibili a metà prezzo.</li>
          <li>3 Atti da 10 incontri. Se cadi la run finisce, ma i dadi sbloccati restano.</li>
        </ul>
        <button class="skill" on:click={() => (howTo = false)}>Ho capito</button>
      </div>
    </div>
  {/if}

  <!-- ===== Lettore del registro ===== -->
  {#if logText !== null}
    <div class="overlay menu">
      <div class="overlay-box logbox">
        <h2>📜 Registro</h2>
        <pre class="logtext">{logText}</pre>
        <div class="btn-row">
          <button class="skill" on:click={() => logText && copyLog(logText)}>{copied ? '✔ Copiato' : '📋 Copia tutto'}</button>
          <button class="ghost" on:click={() => logText && downloadLog(logText)}>⬇️ Scarica .txt</button>
          <button class="ghost" on:click={() => (logText = null)}>Chiudi</button>
        </div>
      </div>
    </div>
  {/if}
</main>

<style>
  /* Nel font pixel il 5 sembra una S e il 2 si legge male: cifre e simboli numerici
     vengono presi da un font di sistema leggibile, le parole restano in pixel. */
  @font-face {
    font-family: 'Cifre Nitide';
    src: local('DejaVu Sans Mono'), local('Menlo'), local('Consolas'), local('Roboto Mono'), local('Courier New');
    unicode-range: U+0030-0039, U+0025, U+002B, U+002D, U+002E, U+002F, U+00D7;
  }

  /* ============================================================
   * Schermata di gioco: una sola vista a tutta altezza, niente scroll.
   *   topbar  → progresso run, relitti equipaggiati, oro
   *   palco   → sprite, HP, intento, dadi 3D (occupa tutto lo spazio libero)
   *   scorebar→ facce del tiro, moltiplicatore, potenza
   *   dock    → la "mano" di 4 skill (tasti 1-4) + zaino
   * ============================================================ */
  .game {
    --num: ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace; --ink: #ece8f6; --muted: #9a93b3; --line: #3a3354; --panel: #17132a;
    --pink: #ff5c8a; --gold: #ffd84c; --green: #7dff9b; --cyan: #5cd0ff;
    height: 100%; box-sizing: border-box; max-width: 1400px; margin: 0 auto;
    padding: 8px 12px 10px;
    display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: 8px;
    font-family: 'Cifre Nitide', 'Pixelify Sans', ui-monospace, monospace; color: var(--ink);
    font-variant-ligatures: none; font-feature-settings: 'liga' 0, 'clig' 0;
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
  .gold { font-family: var(--num); color: var(--gold); font-weight: 700; font-size: 18px; }
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
  .num { font-family: var(--num); }
  .hpnow { font-size: 14px; color: var(--muted); font-weight: 400; }
  .tier { margin-left: 8px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .offer.comune .tier { color: #9aa0a6; }
  .offer.non-comune .tier { color: #7dff9b; }
  .offer.raro .tier { color: #ffb84c; }
  .shop-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 10px 0; }
  .shop-actions .shop-reroll { white-space: nowrap; background: #241f3d; border: 2px solid #4a4268; color: var(--ink); border-radius: 8px; padding: 8px 14px; cursor: pointer; font-family: inherit; font-size: 14px; }
  .shop-actions .shop-reroll:disabled { opacity: 0.45; cursor: default; }
  .shop-actions .offer.service { min-width: 0; flex-direction: row; gap: 8px; padding: 8px 14px; }
  .chip {
    border-radius: 6px; padding: 5px 14px; border: 2px solid #4a4268; background: #241f3d; color: var(--ink);
    font-family: var(--num); font-size: 19px; font-weight: 700; min-width: 42px;
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
  .c-preview { font-family: var(--num); font-size: 20px; font-weight: 700; color: var(--gold); text-align: center; min-height: 28px; }
  .c-alert { font-size: 12px; font-weight: 700; text-align: center; }
  .c-alert.good { color: #7dff9b; }
  .c-alert.warn { color: #ffb84c; }
  .c-hint { font-size: 12px; color: #c9b8e8; opacity: 0.85; text-align: center; }
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
  .overlay-box > button, .overlay-box button.skill {
    font-family: inherit; font-size: 16px; font-weight: 600; padding: 10px 18px; cursor: pointer;
    color: #fff; background: linear-gradient(180deg, #3a1f55, #231238);
    border: 2px solid #ff5c8a; border-radius: 8px; box-shadow: 0 3px 0 #14091f;
  }
  .overlay-box > button:hover, .overlay-box button.skill:hover { filter: brightness(1.2); }
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
  .offer.non-comune, .sellslot.non-comune { border-color: #4cc9f0; }
  .offer.raro, .sellslot.raro { border-color: #c77dff; box-shadow: 0 0 8px #c77dff66; }
  .offer.comune { border-color: #8a8a99; }
  .sellrow { display: flex; flex-direction: column; gap: 6px; align-items: center; margin: 8px 0; }
  .sellrow .slots { display: flex; gap: 6px; }
  .sellslot {
    width: 54px; height: 54px; border-radius: 8px; background: #1b1626; border: 1px dashed #4a4160;
    color: inherit; cursor: pointer; display: flex; flex-direction: column; align-items: center;
    justify-content: center; font-size: 20px; padding: 0;
  }
  .sellslot small { font-size: 10px; color: #ffd84c; }
  .sellslot:not(:disabled) { border-style: solid; }
  .sellslot:disabled { cursor: default; opacity: 0.6; }
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
  /* ---- Menù, fine run, registro ---- */
  .overlay.menu { z-index: 60; }
  .menu-box { text-align: center; max-width: 420px; }
  .logo { font-size: 44px; line-height: 1; margin: 0 0 6px; color: var(--gold); letter-spacing: 3px; text-shadow: 0 3px 0 #5a2d00, 0 0 24px #ffb84c66; }
  .menu-btns { display: flex; flex-direction: column; gap: 8px; margin: 14px 0; }
  .menu-btns small { display: block; font-size: 11px; opacity: 0.8; font-weight: normal; }
  button.ghost {
    font-family: inherit; background: #1b1626; border: 1px solid #4a4160; color: inherit; border-radius: 8px;
    padding: 9px 12px; font: inherit; font-size: 13px; cursor: pointer;
  }
  button.ghost:hover:not(:disabled) { border-color: #ff6fa8; }
  button.ghost:disabled { opacity: 0.4; cursor: default; }
  .btn-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 12px; }
  .summary-box { max-width: 520px; }
  .sum-grid { display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; margin: 10px 0; font-size: 13px; text-align: left; }
  .sum-l { opacity: 0.75; }
  .sum-v { font-weight: bold; color: var(--gold); text-align: right; }
  .sum-actions { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
  .bar { position: relative; display: flex; justify-content: space-between; font-size: 12px; padding: 3px 8px; background: #1b1626; border-radius: 6px; overflow: hidden; }
  .bar i { position: absolute; left: 0; top: 0; bottom: 0; background: #ff6fa833; z-index: 0; }
  .bar span, .bar b { position: relative; z-index: 1; }
  .howto { max-width: 560px; text-align: left; }
  .howto ul { padding-left: 18px; font-size: 13px; line-height: 1.45; display: flex; flex-direction: column; gap: 6px; }
  .logbox { max-width: 760px; width: 94vw; }
  .logtext {
    max-height: 56vh; overflow: auto; text-align: left; font-size: 11px; line-height: 1.35;
    background: #0c0a14; border: 1px solid var(--line); border-radius: 8px; padding: 10px; white-space: pre-wrap; user-select: text;
  }
</style>
