<script lang="ts">
  import { onMount } from 'svelte';
  import { GameManager } from '../GameManager';
  import { SKILLS } from '@core/skills';
  import { BattleState, SkillId } from '@core/types';
  import { MAX_EQUIPMENT_SLOTS } from '@core/equipment';
  import {
    playerView, enemyView, intentView, battleState, rolledChips,
    overflowActive, uiMode, battleResult, logLines, equipVersion,
    uiPhase, goldView, runLabel, shopOffers, rewardBanner
  } from './stores';

  let canvas: HTMLCanvasElement;
  let gm: GameManager | null = null;
  let selectedChips: number[] = [];

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
      <div class="overlay-box shop-box">
        <h2>🛒 Il Mercante Goblin</h2>
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
</style>
