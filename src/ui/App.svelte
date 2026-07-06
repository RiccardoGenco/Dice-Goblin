<script lang="ts">
  import { onMount } from 'svelte';
  import { GameManager } from '../GameManager';
  import { SKILLS } from '@core/skills';
  import { BattleState, FaceType, SkillId } from '@core/types';
  import { MAX_EQUIPMENT_SLOTS } from '@core/equipment';
  import {
    playerView, enemyView, intentView, battleState, rolledChips,
    overflowActive, uiMode, battleResult, logLines, equipVersion,
    uiPhase, goldView, runLabel, shopOffers, shopSpecial, rewardBanner,
    crossroadSpecial, forgeSpecial, forgeOpsLeft, forgeVersion
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
  function forgeRiforgia(): void {
    if (selDie !== null) gm?.applyForge({ kind: 'riforgiatura', dieIndex: selDie });
  }

  onMount(() => {
    gm = new GameManager(canvas);
    const onResize = () => gm?.resize(canvas.clientWidth, canvas.clientHeight);
    window.addEventListener('resize', onResize);
    void gm.start();
    return () => window.removeEventListener('resize', onResize);
  });

  const SKILL_ORDER: { id: SkillId; icon: string; hint: string }[] = [
    { id: SkillId.SGANCIO_BRUTALE, icon: '💥', hint: 'Danno ×1.5' },
    { id: SkillId.SCUDO_GOBLIN,    icon: '🛡️', hint: 'Danno → Scudo' },
    { id: SkillId.SPUTO_ACIDO,     icon: '☠️', hint: '20% Veleno ×3 turni' },
    { id: SkillId.TIRO_TRUCCATO,   icon: '🎲', hint: '×0.5 ma 2 reroll' }
  ];

  $: canAct = $battleState === BattleState.WAIT_PLAYER_ACTION && $uiMode === 'idle' && !$battleResult;

  function useSkill(id: SkillId): void {
    selectedChips = [];
    void gm?.useSkill(id);
  }

  function toggleChip(i: number): void {
    if ($uiMode !== 'reroll') return;
    if (selectedChips.includes(i)) {
      selectedChips = selectedChips.filter(c => c !== i);
    } else if (selectedChips.length < 2) {
      selectedChips = [...selectedChips, i];
    }
  }

  function confirmReroll(): void {
    const chosen = selectedChips;
    selectedChips = [];
    void gm?.confirmRerolls(chosen);
  }

  function cancelReroll(): void {
    selectedChips = [];
    gm?.cancelReroll();
  }
</script>

<main>
  <!-- ===== Header run: Atto/incontro, oro, nuova run ===== -->
  <section class="runbar">
    <span class="runlabel">{$runLabel}</span>
    <span class="gold">💰 {$goldView}</span>
    <button class="mini" on:click={() => void gm?.newRun()}>🔄 Nuova Run</button>
  </section>

  <!-- ===== Pannello nemico + intento (MVP §2: intenti deterministici) ===== -->
  <section class="panel enemy">
    <div class="row">
      <span class="name">🗡️ Avventuriero</span>
      {#if $intentView}
        <span class="intent" title="Intento del prossimo turno">
          {$intentView.icon} {$intentView.label}: <b>{$intentView.value}</b>
        </span>
      {/if}
    </div>
    <div class="hpbar"><div class="fill enemy-fill" style="width:{$enemyView.hpRatio * 100}%"></div></div>
    <div class="row small">
      <span>HP {$enemyView.hp} / {$enemyView.maxHp}</span>
      {#if $enemyView.shield !== '0'}<span>🛡️ {$enemyView.shield}</span>{/if}
      {#if $enemyView.poisonTurns > 0}<span>☠️ ×{$enemyView.poisonTurns}</span>{/if}
    </div>
  </section>

  <!-- ===== Arena 3D (Canvas Layer, GDD §6.2) ===== -->
  <div class="arena-wrap" class:overflow-glitch={$overflowActive}>
    <canvas bind:this={canvas} class="arena"></canvas>
    {#if $overflowActive}
      <div class="overflow-banner">⚠️ OVERFLOW DETECTED ⚠️ — GLITCHING...</div>
    {/if}
  </div>

  <!-- ===== Chip dei dadi lanciati (selezionabili in reroll) ===== -->
  <section class="chips">
    {#each $rolledChips as chip, i}
      <button
        class="chip {chip.cssClass}"
        class:selected={selectedChips.includes(i)}
        class:selectable={$uiMode === 'reroll'}
        on:click={() => toggleChip(i)}
      >{chip.text}</button>
    {/each}
    {#if $uiMode === 'reroll'}
      <span class="reroll-hint">
        Scegli fino a 2 dadi da rilanciare ({selectedChips.length}/2)
        <button class="mini" on:click={confirmReroll}>✔ Conferma</button>
        <button class="mini" on:click={cancelReroll}>✖ Annulla</button>
      </span>
    {/if}
  </section>

  <!-- ===== Pannello giocatore ===== -->
  <section class="panel player">
    <div class="row">
      <span class="name">👺 Goblin</span>
      {#if $playerView.shield !== '0'}<span>🛡️ {$playerView.shield}</span>{/if}
      {#if $playerView.poisonTurns > 0}<span>☠️ ×{$playerView.poisonTurns}</span>{/if}
    </div>
    <div class="hpbar"><div class="fill player-fill" style="width:{$playerView.hpRatio * 100}%"></div></div>
    <div class="row small"><span>HP {$playerView.hp} / {$playerView.maxHp}</span></div>

    <!-- Le 4 skill fisse di classe (MVP §3) -->
    <div class="skills">
      {#each SKILL_ORDER as s}
        <button class="skill" disabled={!canAct} on:click={() => useSkill(s.id)}>
          <span class="icon">{s.icon}</span>
          <span class="label">{SKILLS[s.id].name}</span>
          <span class="hint">{s.hint}</span>
        </button>
      {/each}
    </div>

    <!-- I 5 slot equipaggiamento (MVP §4) + inventario demo -->
    {#key $equipVersion}
      <div class="equip-row">
        <div class="slots">
          {#each Array(MAX_EQUIPMENT_SLOTS) as _, i}
            {@const item = gm?.equipment.slots[i] ?? null}
            <button
              class="slot" class:filled={item}
              title={item ? `${item.name} — ${item.description} (click: rimuovi)` : 'Slot vuoto'}
              on:click={() => item && gm?.unequipSlot(i)}
            >{item ? item.icon : '·'}</button>
          {/each}
        </div>
        <div class="inventory">
          {#each gm?.inventory ?? [] as item}
            <button class="inv-item" title={`${item.name} — ${item.description}`}
              on:click={() => gm?.equipItem(item)}>{item.icon}</button>
          {/each}
        </div>
      </div>
    {/key}
  </section>

  <!-- ===== Log di battaglia ===== -->
  <section class="log">
    {#each $logLines as line}<div>{line}</div>{/each}
  </section>

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
  main {
    max-width: 960px; margin: 0 auto; padding: 12px;
    display: flex; flex-direction: column; gap: 10px;
    font-family: monospace; color: #e8e8f0;
  }
  .panel { background: #1a1a22; border: 1px solid #33333f; border-radius: 8px; padding: 10px 14px; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .row.small { font-size: 12px; opacity: 0.85; margin-top: 4px; }
  .name { font-weight: bold; }
  .intent { background: #2b1520; border: 1px solid #ff5c8a; border-radius: 6px; padding: 2px 10px; }

  .hpbar { height: 14px; background: #101014; border-radius: 7px; overflow: hidden; margin-top: 6px; }
  .fill { height: 100%; transition: width 0.35s ease; }
  .enemy-fill { background: linear-gradient(90deg, #ff5c5c, #ff9b5c); }
  .player-fill { background: linear-gradient(90deg, #4cc94c, #7dff9b); }

  .arena-wrap { position: relative; }
  .arena { display: block; width: 100%; height: 340px; background: #101014; border-radius: 8px; }
  .overflow-glitch .arena { animation: glitch 0.12s infinite; }
  .overflow-banner {
    position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
    color: #ff5c8a; font-weight: bold; animation: glitch 0.1s infinite;
  }
  @keyframes glitch {
    0% { filter: hue-rotate(0deg); transform: translate(0); }
    50% { filter: hue-rotate(90deg); transform: translate(1px, -1px); }
    100% { filter: hue-rotate(0deg); transform: translate(-1px, 1px); }
  }

  .chips { display: flex; flex-wrap: wrap; gap: 6px; min-height: 30px; align-items: center; }
  .chip { border-radius: 6px; padding: 3px 10px; border: 1px solid #444; background: #2b2b33; color: #e8e8f0; }
  .chip.multiplier { border-color: #ff5c8a; color: #ff5c8a; }
  .chip.buff { border-color: #7dff9b; color: #7dff9b; }
  .chip.recursive { border-color: #5cd0ff; color: #5cd0ff; }
  .chip.selectable { cursor: pointer; }
  .chip.selected { outline: 2px solid #ffb84c; }
  .reroll-hint { font-size: 12px; color: #ffb84c; display: flex; gap: 6px; align-items: center; }
  .mini { font-size: 11px; padding: 2px 8px; cursor: pointer; background: #33333f; color: inherit; border: 1px solid #555; border-radius: 4px; }

  .skills { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px; }
  .skill {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    background: #3d1f4f; color: #ffd9e5; border: 1px solid #ff5c8a;
    border-radius: 8px; padding: 8px 4px; cursor: pointer; font-family: inherit;
  }
  .skill:disabled { opacity: 0.35; cursor: default; }
  .skill .icon { font-size: 20px; }
  .skill .label { font-size: 12px; font-weight: bold; }
  .skill .hint { font-size: 10px; opacity: 0.8; }

  .equip-row { display: flex; justify-content: space-between; margin-top: 10px; gap: 12px; }
  .slots, .inventory { display: flex; gap: 6px; }
  .slot {
    width: 36px; height: 36px; border-radius: 8px; font-size: 18px; cursor: pointer;
    background: #101014; border: 1px dashed #444; color: #666;
  }
  .slot.filled { border-style: solid; border-color: #ffb84c; }
  .inv-item {
    width: 32px; height: 32px; border-radius: 8px; font-size: 16px; cursor: pointer;
    background: #1f3d2a; border: 1px solid #4cc94c;
  }

  .log { font-size: 12px; opacity: 0.8; display: flex; flex-direction: column; gap: 2px; min-height: 80px; }

  .overlay {
    position: fixed; inset: 0; background: rgba(10, 10, 14, 0.85);
    display: flex; align-items: center; justify-content: center; z-index: 10;
  }
  .overlay-box {
    background: #1a1a22; border: 1px solid #ff5c8a; border-radius: 12px;
    padding: 28px 40px; text-align: center; display: flex; flex-direction: column; gap: 12px;
  }

  /* ---- Meta: runbar e shop ---- */
  .runbar {
    display: flex; justify-content: space-between; align-items: center;
    background: #14141a; border: 1px solid #33333f; border-radius: 8px; padding: 6px 14px;
  }
  .runlabel { font-weight: bold; color: #ffb84c; }
  .gold { color: #ffd84c; }
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
