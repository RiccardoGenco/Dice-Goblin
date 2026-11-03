<script lang="ts">
  import Icon from './Icon.svelte';
  import ItemBadge from './ItemBadge.svelte';
  import Counter from './Counter.svelte';
  import Rich from './Rich.svelte';
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
    overflowActive, settings, handSelection, handInfo, diceBusy, effectsView, battleResult, logLines, equipVersion,
    menuOpen, menuInfo, runSummary,
    uiPhase, goldView, goldNum, runLabel, shopOffers, shopInfo, shopSpecial, rewardBanner,
    crossroadSpecial, doors, eventView, rewardChoices, rewardKind, bagOptions, bagPickerOpen, goalsView, replacePrompt, forgeSpecial, forgeOpsLeft, forgeVersion,
    chainView, skillPreview, skillHints, rollNonce, runProgress
  } from './stores';

  let canvas: HTMLCanvasElement;
  let gm: GameManager | null = null;

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
  let goalsOpen = false;
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

  /* ---- Tastiera: 1-4 per le skill ---- */
  function onKey(e: KeyboardEvent): void {
    if ($menuOpen || logText !== null || $uiPhase !== 'battle' || e.ctrlKey || e.metaKey || e.altKey) return;
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

  /* velocità: tutte le animazioni CSS vanno al doppio in modalità veloce */
  onMount(() => {
    const t = setInterval(() => {
      const rate = $settings.fast ? 2 : 1;
      for (const a of document.getAnimations()) if (a.playbackRate !== rate) a.playbackRate = rate;
    }, 120);
    return () => clearInterval(t);
  });

  /* introduzione: tre suggerimenti la prima volta che arrivi a una scelta */
  const COACH = [
    { target: 'hand', title: 'La tua mano', text: 'A ogni turno peschi 5 dadi e ne giochi 3. Il gioco ha già scelto i migliori per far danno. Tocca un dado per metterlo in panchina o giocarlo: per una Parata o una Bava può convenire cambiare.' },
    { target: 'track', title: 'Cosa farà il nemico', text: 'In alto vedi cosa farà questo turno e nei prossimi. Se prepara uno scudo, non serve parare: colpisci. Se prepara un attacco, la Parata ti protegge. Il veleno passa oltre lo scudo.' },
    { target: 'dock', title: 'Scegli un\'azione', text: 'Il numero sulla carta dice quanto danno, scudo o veleno farai con la mano scelta. Premi una carta o i tasti 1-4. Buona caccia!' }
  ];
  let coach = 0;
  $: showCoach = !$settings.tutorialDone && $uiPhase === 'battle' && !$menuOpen && !$runSummary && logText === null && !howTo && canAct;
  function nextCoach(): void {
    if (coach < COACH.length - 1) { coach++; return; }
    coach = 0;
    settings.update(v => ({ ...v, tutorialDone: true }));
  }
  function skipCoach(): void { coach = 0; settings.update(v => ({ ...v, tutorialDone: true })); }
  function replayCoach(): void { howTo = false; coach = 0; settings.update(v => ({ ...v, tutorialDone: false })); }

  $: canAct = $battleState === BattleState.WAIT_PLAYER_ACTION && !$diceBusy && !$battleResult;
  /* La mano raggruppata: ogni carta con i lanci extra che ha generato */
  $: handGroups = $rolledChips
    .map((chip, i) => ({ chip, i }))
    .filter(x => !x.chip.extra)
    .map(x => ({ ...x, kids: $rolledChips.map((c, j) => ({ c, j })).filter(k => k.c.extra && k.c.card === x.i) }));

  function useSkill(id: SkillId): void {
    void gm?.useSkill(id);
  }

  function toggleCard(card: number): void {
    if (!canAct) return;
    gm?.toggleCard(card);
  }
</script>

<svelte:window on:keydown={onKey} />

<main class="game" data-coach={showCoach ? COACH[coach]?.target : ""}>
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
          <span class="relic" title={item ? `${item.name}${item.relic ? ' (reliquia)' : ''} — ${item.description}` : 'Slot vuoto: compra oggetti dal mercante'}>
            <ItemBadge icon={item?.icon ?? ''} rarity={item?.rarity} relic={!!item?.relic} empty={!item} size={44} />
          </span>
        {/each}
      </div>
    {/key}

    <div class="topright">
      <span class="gold" title="Oro"><Icon e="💰" /> <Counter value={$goldNum} ticks floaty /></span>
      <button class="restart icon-btn" title={$settings.muted ? 'Attiva i suoni' : 'Silenzia'} aria-label="Suoni"
        on:click={() => settings.update(v => ({ ...v, muted: !v.muted }))}><Icon e={$settings.muted ? '🔇' : '🔊'} mono /></button>
      <button class="restart icon-btn" class:on={$settings.fast} title="Modalità veloce: animazioni più rapide" aria-label="Modalità veloce"
        on:click={() => settings.update(v => ({ ...v, fast: !v.fast }))}><Icon e="⏩" mono /></button>
      <button class="restart" on:click={() => menuOpen.set(true)}><Icon e="☰" /> Menù</button>
      <button class="restart" class:armed={restartArmed} on:click={onRestart}>
        <Rich text={restartArmed ? 'Sicuro? Perdi la run' : '↻ Nuova run'} />
      </button>
    </div>
  </header>

  <!-- ===== Palco: sprite, HP, intento, dadi 3D, effetti ===== -->
  <div class="stage-area">
    <Stage>
      <canvas slot="overlay" bind:this={canvas} class="arena"></canvas>
    </Stage>
    <div class="feed" aria-live="polite">
      {#each $logLines.slice(0, 3) as line, i (line + i)}<div style="opacity:{1 - i * 0.3}"><Rich text={line} /></div>{/each}
    </div>
  </div>

  <!-- ===== Striscia del tiro: facce, moltiplicatore, potenza ===== -->
  <section class="scorebar">
    <div class="tray">
      {#key $rollNonce}
        {#each handGroups as g, n (g.i)}
          <div class="card-slot" style="--i:{n}">
            <button
              class="chip {g.chip.cssClass}"
              class:selected={$handSelection.includes(g.i)}
              class:benched={!$handSelection.includes(g.i)}
              class:selectable={canAct}
              title={$handSelection.includes(g.i) ? 'Giocato: tocca per metterlo in panchina' : 'In panchina: tocca per giocarlo'}
              on:click={() => toggleCard(g.i)}
            ><Rich text={g.chip.text} /></button>
            {#each g.kids as k (k.j)}
              <button class="chip extra {k.c.cssClass}" class:benched={!$handSelection.includes(g.i)}
                on:click={() => toggleCard(g.i)} title="Lancio extra: segue il dado che lo ha generato">↳ <Rich text={k.c.text} /></button>
            {/each}
          </div>
        {/each}
      {/key}
    </div>
    <div class="side">
      {#if $effectsView && $battleState === BattleState.WAIT_PLAYER_ACTION && ($effectsView.poison || $effectsView.shield || $effectsView.fire)}
        <div class="fxsum" title="Effetti delle facce incantate uscite">
          {#if $effectsView.poison}<span class="e-p"><Icon e="☠" /> {$effectsView.poison}/t</span>{/if}
          {#if $effectsView.shield}<span class="e-s"><Icon e="🛡" /> +{$effectsView.shield}</span>{/if}
          {#if $effectsView.fire}<span class="e-f"><Icon e="🔥" /> {$effectsView.fire}</span>{/if}
          {#each $effectsView.reactions as r (r.id)}<span class="react" title={r.text}><Icon e="⚗" /> {r.name}</span>{/each}
        </div>
      {/if}
      {#if $chainView && $battleState === BattleState.WAIT_PLAYER_ACTION}
        <div class="formula" class:hot={$chainView.tier >= 2}>
          {#if $chainView.multCount > 0}<span class="f-mult">×{$chainView.mult}</span>{/if}
          <span class="f-pow"><small>Potenza</small> {#key $chainView.power}<b class="num pop"><Counter value={$chainView.powerNum} duration={320} /></b>{/key}</span>
        </div>
      {/if}
      <div class="hand-slots" title="Tocca i dadi per scegliere quali giocare">
        <Icon e="🎲" /> Giochi <b>{$handSelection.length}/{$handInfo.slots}</b>
        <small>{$handInfo.drawn} pescati</small>
      </div>
    </div>
  </section>

  <!-- ===== Dock: la "mano" di 4 skill + zaino ===== -->
  <footer class="dock">
    <div class="hand">
      {#each SKILL_ORDER as s, i}
        <button class="card" disabled={!canAct} on:click={() => useSkill(s.id)}>
          <kbd class="key">{i + 1}</kbd>
          <span class="c-icon"><Icon e={s.icon} /></span>
          <span class="c-name">{SKILLS[s.id].name}</span>
          <span class="c-preview"><Rich text={$skillPreview[s.id] ?? '…'} /></span>
          {#if $skillHints[s.id]}<span class="c-alert {$skillHints[s.id]?.kind}"><Rich text={$skillHints[s.id]?.text ?? ''} /></span>{/if}
          <span class="c-hint">{s.hint}</span>
        </button>
      {/each}
    </div>
  </footer>

  {#if showCoach}
    <div class="coach" role="dialog" aria-label="Introduzione">
      <div class="coach-step">{coach + 1} / {COACH.length}</div>
      <h3>{COACH[coach]?.title}</h3>
      <p>{COACH[coach]?.text}</p>
      <div class="coach-actions">
        <button class="ghost" on:click={skipCoach}>Salta</button>
        <button class="skill" on:click={nextCoach}>{coach < COACH.length - 1 ? 'Avanti' : 'Ho capito'}</button>
      </div>
    </div>
  {/if}

  <!-- ===== Overlay Shop (tra un incontro e l'altro) ===== -->
  {#if $uiPhase === 'shop'}
    <div class="overlay">
      <div class="overlay-box shop-box" class:royal={$shopSpecial}>
        <h2><Rich text={$shopSpecial ? '👑 Il Mercante Reale' : '🛒 Il Mercante Goblin'} /></h2>
        {#if $shopSpecial}<p class="unlock">Prezzi scontati del 30% — bottino da boss fight!</p>{/if}
        {#if $rewardBanner}<p class="unlock"><Rich text={$rewardBanner} /></p>{/if}
        <p class="gold"><Icon e="💰" /> {$goldView} oro <span class="hpnow">· <Icon e="❤" /> {$shopInfo.hp}</span></p>
        <div class="offers">
          {#each $shopOffers.filter(o => !o.service) as offer (offer.id)}
            <button
              class="offer {offer.rarity ?? ''}"
              disabled={!offer.affordable}
              title={offer.description}
              on:click={() => gm?.buyOffer(offer.id)}
            >
              <span class="icon"><ItemBadge icon={offer.icon} rarity={offer.rarity} size={36} /></span>
              <span class="label"><Rich text={offer.label} />{#if offer.rarity} <small class="tier">{TIER_NAME[offer.rarity] ?? ''}</small>{/if}</span>
              <span class="hint"><Rich text={offer.description + (offer.note ? ` — ${offer.note}` : '')} /></span>
              <span class="cost" class:too-expensive={!offer.affordable}><Icon e="💰" /> {offer.cost}</span>
            </button>
          {/each}
          {#if $shopOffers.filter(o => !o.service).length === 0}
            <p class="hint">Banco vuoto: rilancia per vedere nuova merce.</p>
          {/if}
        </div>
        <div class="shop-actions">
          <button class="shop-reroll" disabled={!$shopInfo.canReroll} on:click={() => gm?.rerollShop()}
            title="Rimescola oggetti, faccia e dado in vendita. Ogni rilancio della visita costa di più.">
            <Icon e="🔄" /> Rilancia il banco <b class="num"><Icon e="💰" /> {$shopInfo.rerollCost}</b>
          </button>
          {#each $shopOffers.filter(o => o.service) as offer (offer.id)}
            <button class="offer service" disabled={!offer.affordable} title={offer.description}
              on:click={() => gm?.buyOffer(offer.id)}>
              <span class="icon"><Icon e={offer.icon} /></span>
              <span class="label"><Rich text={offer.label} /></span>
              <span class="cost" class:too-expensive={!offer.affordable}><Icon e="💰" /> {offer.cost}</span>
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
                  <ItemBadge icon={it?.icon ?? ''} rarity={it?.rarity} relic={!!it?.relic} empty={!it} size={40} />
                  {#if val}<small><Icon e="💰" />{formatBigNumber(val)}</small>{/if}
                </button>
              {/each}
            </div>
          </div>
        {/key}
        <button class="skill" on:click={() => void gm?.leaveShop()}><Icon e="⚔" /> Prossimo incontro</button>
      </div>
    </div>
  {/if}

  <!-- ===== Overlay Bivio (specs §7 / §7.bis) ===== -->
  {#if $uiPhase === 'crossroad'}
    <div class="overlay">
      <div class="overlay-box" class:royal={$crossroadSpecial}>
        <h2><Rich text={$crossroadSpecial ? '✨ Bivio Dorato' : '⚖️ Il Bivio'} /></h2>
        {#if $rewardBanner}<p class="unlock"><Rich text={$rewardBanner} /></p>{/if}
        <p class="hint-line">Scegli una porta: l'altra si chiuderà. <Icon e="💰" /> {$goldView} oro</p>
        <div class="doors">
          {#each $doors as d}
            <button class="door" class:golden={$crossroadSpecial} class:elite={d.kind === 'elite'} on:click={() => gm?.chooseDoor(d.kind)}>
              <span class="icon"><Icon e={d.icon} /></span>
              <span class="label">{d.label}</span>
              <span class="hint">{d.hint}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- ===== Overlay Evento ===== -->
  {#if $uiPhase === 'event' && $eventView}
    <div class="overlay">
      <div class="overlay-box event-box">
        <h2><Icon e={$eventView.icon} /> {$eventView.title}</h2>
        <p class="hint-line">{$eventView.text}</p>
        {#if $eventView.result}
          <p class="unlock">{$eventView.result}</p>
          <button class="skill" on:click={() => void gm?.leaveEvent()}><Icon e="⚔" /> Prossimo incontro</button>
        {:else}
          <div class="event-opts">
            {#each $eventView.options as o, i}
              <button class="door event-opt" disabled={!!o.blocked} on:click={() => gm?.chooseEventOption(i)}>
                <span class="label">{o.label}</span>
                <span class="hint">{o.blocked ?? o.hint}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- ===== Overlay Premio Élite ===== -->
  {#if $uiPhase === 'reward'}
    <div class="overlay">
      <div class="overlay-box royal">
        <h2>{#if $rewardKind === 'relic'}<Icon e="👑" /> Reliquia del Boss{:else}<Icon e="👹" /> Élite sconfitto{/if}</h2>
        <p class="hint-line">{$rewardKind === 'relic' ? 'Scegli una reliquia: le altre due svaniscono. Cambia il modo di giocare.' : 'Scegli un oggetto: l\'altro è perso.'}</p>
        <div class="doors">
          {#each $rewardChoices as r}
            <div class="reward-col">
              <button class="door golden reward-card {r.relic ? 'relic' : r.rarity}" on:click={() => gm?.chooseReward(r.id)}>
                <span class="icon"><ItemBadge icon={r.icon} rarity={r.rarity} relic={r.relic} size={60} /></span>
                <span class="label">{r.name}</span>
                <span class="hint">{r.description}</span>
                {#if r.note}<span class="hint warn">{r.note}</span>{/if}
              </button>
              <button class="ghost sell-reward" on:click={() => gm?.sellReward(r.id)}>
                Non lo voglio: vendi <Icon e="💰" /> {gm?.rewardSellValue(r.id)}
              </button>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- ===== Overlay Forgia (specs §9 / §9.bis) ===== -->
  {#if $uiPhase === 'forge'}
    <div class="overlay">
      <div class="overlay-box forge-box" class:royal={$forgeSpecial}>
        <h2><Rich text={$forgeSpecial ? '🔥 La Gran Forgia' : '🔨 La Forgia dei Dadi'} /></h2>
        <p class="hint-line"><Icon e="💰" /> {$goldView} oro — Operazioni rimaste: {$forgeOpsLeft}</p>
        {#if fusionMode}
          <p class="unlock"><Icon e="⚒" /> Scegli il dado da SACRIFICARE (D{(selDie ?? 0) + 1} ne assorbirà la faccia migliore)</p>
        {/if}
        <div class="forge-dice">
          {#each forgeBag as fdie, di}
            <button class="forge-die" class:selected={selDie === di}
              class:sacrifice={fusionMode && selDie !== di}
              on:click={() => onForgeDieClick(di)}>
              <span><Icon e={fdie.icon} /> D{di + 1}</span>
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
              <span><Icon e="🔥" /> Tempra</span>
              {#if tempraQ}<span class="cost"><Icon e="💰" /> {tempraQ.cost}</span>{/if}
              {#if tempraQ?.preview}<span class="hint">{tempraQ.preview}</span>{/if}
            </button>
            {#each transQs as tq (tq.label)}
              <button class="service" disabled={!tq.q.ok || $forgeOpsLeft === 0}
                title={tq.q.reason ?? tq.q.preview} on:click={() => forgeTrans(tq.t)}>
                <span><Icon e="⚗" /> {tq.label}</span>
                <span class="cost"><Icon e="💰" /> {tq.q.cost}</span>
              </button>
            {/each}
            {#each incQs as iq (iq.e)}
              <button class="service" disabled={!iq.q.ok || $forgeOpsLeft === 0}
                title={iq.q.reason ?? iq.q.preview} on:click={() => forgeIncanto(iq.e)}>
                <span><Icon e="✨" /> Incanta {iq.label}</span>
                <span class="cost"><Icon e="💰" /> {iq.q.cost}</span>
              </button>
            {/each}
            <button class="service" class:selected={fusionMode}
              disabled={forgeBag.length < 2 || $forgeOpsLeft === 0}
              title="Sacrifica un dado: questo ne eredita la faccia migliore e sale di rarità"
              on:click={() => (fusionMode = !fusionMode)}>
              <span><Icon e="⚒" /> Fusione</span>
              {#if fusioneQ}<span class="cost"><Icon e="💰" /> {fusioneQ.cost}</span>{/if}
            </button>
            {#if $forgeSpecial}
              <button class="service" disabled={!riforgQ?.ok || $forgeOpsLeft === 0}
                title={riforgQ?.reason ?? riforgQ?.preview} on:click={forgeRiforgia}>
                <span><Icon e="🌋" /> Riforgiatura</span>
                {#if riforgQ}<span class="cost"><Icon e="💰" /> {riforgQ.cost}</span>{/if}
                {#if riforgQ?.preview}<span class="hint">{riforgQ.preview}</span>{/if}
              </button>
            {/if}
          </div>
        {:else}
          <p class="hint-line">Seleziona un dado per vedere le sue facce</p>
        {/if}
        <button class="skill" on:click={() => void gm?.leaveForge()}><Icon e="⚔" /> Prossimo incontro</button>
      </div>
    </div>
  {/if}

  <!-- ===== Schermata di fine run ===== -->
  {#if $runSummary}
    <div class="overlay">
      <div class="overlay-box summary-box" class:royal={$runSummary.outcome === 'vittoria'}>
        <h2><Rich text={$runSummary.title} /></h2>
        <p class="hint-line">
          {$runSummary.endLabel}{$runSummary.killedBy ? ` — sconfitto da ${$runSummary.killedBy}` : ''}
        </p>
        {#if $rewardBanner}<p class="unlock"><Rich text={$rewardBanner} /></p>{/if}
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
          {#each $runSummary.items as it}<span title={it.name}><Icon e={it.icon} /> </span>{/each}
          {$runSummary.items.length ? '·' : 'Nessun oggetto ·'} {$runSummary.build}
        </p>
        <div class="btn-row">
          <button class="skill" on:click={endNew}><Icon e="🔄" /> Nuova run</button>
          <button class="ghost" on:click={() => openLog('last')}><Icon e="📜" /> Leggi il registro</button>
          <button class="ghost" on:click={() => gm && copyLog(gm.getLogText('last'))}><Rich text={copied ? '✔ Copiato' : '📋 Copia registro'} /></button>
          <button class="ghost" on:click={() => gm && downloadLog(gm.getLogText('last'))}><Icon e="⬇" /> Scarica</button>
          <button class="ghost" on:click={endMenu}><Icon e="☰" /> Menù</button>
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
              <small>{$menuInfo.saveLabel} · <Icon e="💰" /> {$menuInfo.gold}</small>
            </button>
          {/if}
          <button class={$menuInfo.hasSave || $menuInfo.inProgress ? 'ghost' : 'skill'} on:click={startNew}>
            <Rich text={newArmed ? 'Sicuro? Perdi la run attuale' : '⚔️ Nuova run'} />
          </button>
          <button class="ghost" on:click={() => (goalsOpen = true)}><Icon e="🏅" /> Obiettivi e borse</button>
          <button class="ghost" on:click={() => (howTo = true)}><Icon e="❓" /> Come si gioca</button>
          <button class="ghost" disabled={!$menuInfo.inProgress && !$menuInfo.hasSave} on:click={() => openLog('current')}><Icon e="📜" /> Registro della run in corso</button>
          <button class="ghost" disabled={!$menuInfo.hasLastLog} on:click={() => openLog('last')}><Icon e="🗂" /> Registro dell'ultima run</button>
        </div>
        <p class="hint-line">Il registro annota ogni turno: copialo e mandamelo dopo una partita.</p>
      </div>
    </div>
  {/if}

  <!-- ===== Slot pieni: cosa sacrificare ===== -->
  {#if $replacePrompt}
    <div class="overlay replace-overlay">
      <div class="overlay-box replace-box">
        <h2>Slot pieni</h2>
        <div class="incoming">
          <span class="icon"><ItemBadge icon={$replacePrompt.incoming.icon} rarity={$replacePrompt.incoming.rarity} relic={$replacePrompt.incoming.relic} size={52} /></span>
          <div><b>{$replacePrompt.incoming.name}</b><div class="hint-line">{$replacePrompt.incoming.description}</div>
          <div class="hint-line">{$replacePrompt.info}</div></div>
        </div>
        <p class="hint-line">Scegli l'oggetto da sacrificare: viene venduto.</p>
        <div class="offers">
          {#each $replacePrompt.options as o}
            <button class="offer replace-opt" disabled={!!o.blocked} on:click={() => gm?.confirmReplace(o.slot)}>
              <span class="icon"><ItemBadge icon={o.icon} rarity={o.rarity} relic={o.relic} size={36} /></span>
              <span class="label">{o.name}</span>
              <span class="hint"><Rich text={o.description} /></span>
              <span class="cost" class:too-expensive={!!o.blocked}>{o.blocked ?? o.value}</span>
            </button>
          {/each}
        </div>
        <button class="ghost" on:click={() => gm?.cancelReplace()}>Annulla</button>
      </div>
    </div>
  {/if}

  <!-- ===== Scelta della borsa ===== -->
  {#if $bagPickerOpen}
    <div class="overlay menu">
      <div class="overlay-box menu-box bag-box">
        <h2>Scegli la borsa</h2>
        <p class="hint-line">Ogni borsa spinge una build diversa.</p>
        <div class="bags">
          {#each $bagOptions as b}
            <button class="door bag" class:locked={b.locked} disabled={b.locked} on:click={() => gm?.chooseBag(b.id)}>
              <span class="icon"><Icon e={b.icon} /></span>
              <span class="label">{b.name}</span>
              <span class="hint">{b.locked ? b.hint : b.description}</span>
            </button>
          {/each}
        </div>
        <button class="ghost" on:click={() => { bagPickerOpen.set(false); menuOpen.set(true); }}>Indietro</button>
      </div>
    </div>
  {/if}

  <!-- ===== Obiettivi ===== -->
  {#if goalsOpen}
    <div class="overlay menu" on:click|self={() => (goalsOpen = false)}>
      <div class="overlay-box menu-box bag-box">
        <h2><Icon e="🏅" /> Obiettivi</h2>
        <p class="hint-line">Completarli sblocca borse di partenza e dadi per il negozio, per sempre.</p>
        <div class="goals">
          {#each $goalsView as g}
            <div class="goal" class:done={g.done}>
              <div class="goal-top"><b>{g.name}</b><span>{g.done ? 'Fatto' : g.progress}</span></div>
              <div class="goal-desc">{g.description}</div>
              <div class="goal-bar"><div style="width:{g.ratio * 100}%"></div></div>
              <div class="goal-reward">Premio: {g.rewardText}</div>
            </div>
          {/each}
        </div>
        <h3 class="bags-title">Borse</h3>
        <div class="bags">
          {#each $bagOptions as b}
            <div class="door bag static" class:locked={b.locked}>
              <span class="icon"><Icon e={b.icon} /></span>
              <span class="label">{b.name}</span>
              <span class="hint">{b.locked ? b.hint : b.description}</span>
            </div>
          {/each}
        </div>
        <button class="ghost" on:click={() => (goalsOpen = false)}>Chiudi</button>
      </div>
    </div>
  {/if}

  <!-- ===== Come si gioca ===== -->
  {#if howTo}
    <div class="overlay menu" on:click|self={() => (howTo = false)}>
      <div class="overlay-box howto">
        <h2><Icon e="❓" /> Come si gioca</h2>
        <ul>
          <li><b>Ogni turno</b> i dadi della borsa vengono lanciati. Il danno è (Forza + facce normali) × moltiplicatori × azione.</li>
          <li><b>La mano:</b> a ogni turno peschi 5 dadi dalla borsa e li tiri una volta sola. Ne giochi 3: tocca un dado per giocarlo o lasciarlo in panchina (i dadi smorzati non contano). La scelta di partenza è quella che fa più danno con lo Sgancio, ma per una Parata o una Bava può convenire cambiarla. I lanci extra della ricorsione seguono il loro dado e non occupano slot.</li>
          <li><b>Azioni</b> (tasti <kbd>1</kbd>-<kbd>4</kbd>): Sgancio (colpo sicuro), Parata (scudo che rimbalza se il nemico attacca), Bava (veleno forte, ignora lo scudo), Carica (salti il turno, tieni le facce, il lancio dopo vale ×1.5). Leggi sempre l'intento del nemico.</li>
          <li><b>Facce incantate:</b> <Icon e="☠" /> veleno, <Icon e="🛡" /> scudo, <Icon e="🔥" /> fuoco. Se escono insieme reagiscono: Vapori (<Icon e="☠" /><Icon e="🔥" />), Scudo ardente (<Icon e="🛡" /><Icon e="🔥" />), Spore (<Icon e="☠" /><Icon e="🛡" />).</li>
          <li><b>Dopo ogni incontro</b> scegli una porta: Mercante (oggetti su tre livelli di rarità, facce, dadi, pozioni, e un rilancio del banco che costa sempre di più) o Forgia (migliora le facce). Forza e Vitalità crescono da sole a ogni vittoria. Una parte dell'oro che non spendi ti torna come interesse. Un incontro su cinque è un Campione o un Boss, con sconti e bottino migliori.</li>
          <li><b>Gli HP restano:</b> +20% dopo ogni vittoria, pieni dopo Campioni e Boss. 5 oggetti al massimo, rivendibili a metà prezzo.</li>
          <li>3 Atti da 10 incontri. Se cadi la run finisce, ma i dadi sbloccati restano.</li>
        </ul>
        <p class="credits">Icone: <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a> (Lorc, Delapouite e altri autori), licenza CC BY 3.0.</p>
        <button class="ghost" on:click={replayCoach}>Rivedi l'introduzione</button>
        <button class="skill" on:click={() => (howTo = false)}>Ho capito</button>
      </div>
    </div>
  {/if}

  <!-- ===== Lettore del registro ===== -->
  {#if logText !== null}
    <div class="overlay menu">
      <div class="overlay-box logbox">
        <h2><Icon e="📜" /> Registro</h2>
        <pre class="logtext">{logText}</pre>
        <div class="btn-row">
          <button class="skill" on:click={() => logText && copyLog(logText)}><Rich text={copied ? '✔ Copiato' : '📋 Copia tutto'} /></button>
          <button class="ghost" on:click={() => logText && downloadLog(logText)}><Icon e="⬇" /> Scarica .txt</button>
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
  .relic { display: inline-flex; cursor: help; transition: transform 0.15s; }
  .relic:hover { transform: translateY(-2px) scale(1.06); }
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
  .offer.non-comune .tier { color: #4cc9f0; }
  .offer.raro .tier { color: #c77dff; }
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
  .f-pow b.pop { display: inline-block; animation: popnum 0.35s cubic-bezier(.2,1.6,.4,1); }
  @keyframes popnum { 0% { transform: scale(1.55); color: #fff; text-shadow: 0 0 16px #ffb84c; } 100% { transform: scale(1); } }
  .f-pow b { color: var(--gold); font-size: 28px; font-weight: 700; }
  .side { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; justify-content: flex-end; }
  .hand-slots { color: #ffe2a8; font-weight: 700; display: flex; flex-direction: column; align-items: center; line-height: 1.1; }
  .hand-slots small { font-weight: 400; font-size: 11px; color: var(--muted); }
  .card-slot { display: flex; align-items: center; gap: 4px; padding: 2px; }
  .chip.benched { opacity: 0.4; filter: grayscale(0.6); }
  .chip.extra { font-size: 15px; min-width: 0; padding: 3px 9px; }
  .fxsum { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-weight: 700; font-size: 17px; }
  .e-p { color: #7dff4c; } .e-s { color: #6cc4ff; } .e-f { color: #ff8a3c; }
  .react { color: #ffd84c; background: #3a2a52; border: 1px solid #ffd84c; border-radius: 12px; padding: 1px 10px; font-size: 14px; animation: chip-in 0.4s cubic-bezier(.2,1.5,.4,1) both; }

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
  .c-icon { font-size: 34px; line-height: 1; } .c-icon :global(.gi) { width: 1em; height: 1em; vertical-align: 0; }
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
  .icon-btn { padding: 5px 9px; display: inline-flex; align-items: center; }
  .icon-btn.on { border-color: #ffb84c; color: #ffb84c; box-shadow: 0 0 8px rgba(255,184,76,0.5); }
  .coach {
    position: fixed; left: 50%; bottom: 210px; transform: translateX(-50%); z-index: 40; width: min(460px, 92vw);
    background: #1b1530; border: 2px solid #ffb84c; border-radius: 12px; padding: 12px 16px; box-shadow: 0 8px 40px rgba(0,0,0,0.7), 0 0 24px rgba(255,184,76,0.35);
    animation: chip-in 0.4s cubic-bezier(.2,1.4,.4,1) both;
  }
  .coach h3 { margin: 2px 0 6px; color: #ffd84c; font-size: 18px; }
  .coach p { margin: 0 0 10px; font-size: 14px; line-height: 1.35; color: #ece7ff; }
  .coach-step { font-size: 11px; letter-spacing: 2px; color: #8f86b8; text-align: right; }
  .coach-actions { display: flex; gap: 10px; justify-content: flex-end; }
  :global(main.game[data-coach="hand"] .scorebar),
  :global(main.game[data-coach="track"] .track),
  :global(main.game[data-coach="dock"] .dock) { outline: 3px solid #ffb84c; outline-offset: 4px; border-radius: 12px; animation: coachglow 1.2s ease-in-out infinite; }
  @keyframes coachglow { 50% { outline-color: #fff1c4; box-shadow: 0 0 22px rgba(255,184,76,0.7); } }
  .credits { font-size: 12px; color: var(--muted); margin: 8px 0; }
  .credits a { color: var(--cyan); }
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
  .offer.non-comune { border-color: #4cc9f0; }
  .offer.raro { border-color: #c77dff; box-shadow: 0 0 8px #c77dff66; }
  .offer.comune { border-color: #8a8a99; }
  .sellrow { display: flex; flex-direction: column; gap: 6px; align-items: center; margin: 8px 0; }
  .sellrow .slots { display: flex; gap: 6px; }
  .sellslot {
    width: 64px; min-height: 66px; border-radius: 8px; background: transparent; border: 0;
    color: inherit; cursor: pointer; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 3px; padding: 2px 0; transition: transform 0.12s;
  }
  .sellslot small { font-size: 10px; color: #ffd84c; }
  .sellslot:not(:disabled):hover { transform: translateY(-2px); }
  .sellslot:disabled { cursor: default; opacity: 0.55; }
  .cost.too-expensive { color: #ff5c5c; }
  .shop-box.royal { border-color: #ffd84c; box-shadow: 0 0 24px rgba(255, 216, 76, 0.25); }

  /* ---- Bivio e Forgia ---- */
  .hint-line { font-size: 12px; opacity: 0.85; margin: 0; }
  .overlay-box.royal { border-color: #ffd84c; box-shadow: 0 0 24px rgba(255, 216, 76, 0.25); }
  .doors { display: flex; gap: 14px; justify-content: center; }
  .door {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 18px 18px; width: 220px; text-align: center; cursor: pointer; font-family: inherit;
    background: #1f3d2a; border: 1px solid #4cc94c; border-radius: 10px; color: #e8e8f0;
  }
  .door .icon { font-size: 28px; }
  .door .hint { font-size: 12px; opacity: 0.85; line-height: 1.3; }
  .door.elite { border-color: #ff6b5a; }
  .door .hint.warn { color: #ffb454; }
  .event-box { max-width: 560px; }
  .reward-card.non-comune { border-color: #4cc9f0; background: #12303a; }
  .reward-card.raro { border-color: #c77dff; background: #2c1a40; box-shadow: 0 0 16px #c77dff55; }
  .reward-card.relic { border-color: #ffd34d; background: #3a2f12; box-shadow: 0 0 22px #ffd34d66; }
  .reward-col { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
  .sell-reward { font-size: 12px; padding: 6px 8px; }
  .replace-overlay { z-index: 60; }
  .replace-box { max-width: 520px; max-height: 92vh; overflow-y: auto; }
  .incoming { display: flex; gap: 12px; align-items: center; text-align: left; background: #3a2f12; border: 1px solid #ffd34d; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
  .incoming .icon { font-size: 28px; }
  .replace-opt:disabled { opacity: 0.45; cursor: not-allowed; }
  .bag-box { max-width: 720px; max-height: 92vh; overflow-y: auto; }
  .bags { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin: 10px 0; }
  .door.bag { width: 150px; padding: 12px 10px; }
  .door.bag.locked { opacity: 0.45; filter: grayscale(0.7); }
  .door.bag.static { cursor: default; }
  .bags-title { margin: 14px 0 0; font-size: 14px; letter-spacing: 2px; color: #b9b2d9; }
  .goals { display: flex; flex-direction: column; gap: 8px; text-align: left; }
  .goal { background: #1c1938; border: 1px solid #3a3470; border-radius: 10px; padding: 10px 12px; }
  .goal.done { border-color: #4cc94c; background: #1f3d2a; }
  .goal-top { display: flex; justify-content: space-between; }
  .goal-desc { font-size: 13px; color: #cfc9ee; margin: 2px 0 6px; }
  .goal-bar { height: 6px; background: #0f0d20; border-radius: 4px; overflow: hidden; }
  .goal-bar div { height: 100%; background: #ffd34d; }
  .goal.done .goal-bar div { background: #7dff9b; }
  .goal-reward { font-size: 12px; color: #ffd34d; margin-top: 4px; }
  .event-opts { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
  .event-opt { width: 100%; padding: 12px 16px; }
  .door:disabled { opacity: 0.45; cursor: not-allowed; }
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
