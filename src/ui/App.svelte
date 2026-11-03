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
  let fuseSel: number[] = [];
  $: fuseItemsList = $forgeVersion >= 0 && $uiPhase === 'forge' ? (gm?.getFuseView() ?? []) : [];
  $: fuseQ = $forgeVersion >= 0 && fuseSel.length === 2 && gm ? gm.quoteFuse(fuseSel[0]!, fuseSel[1]!) : null;
  function toggleFuse(slot: number): void {
    fuseSel = fuseSel.includes(slot) ? fuseSel.filter(s => s !== slot) : [...fuseSel, slot].slice(-2);
  }
  function doFuse(): void {
    if (fuseSel.length === 2) { gm?.applyFuse(fuseSel[0]!, fuseSel[1]!); fuseSel = []; equipVersion.update(v => v + 1); }
  }
  let lastPhase = '';
  $: if ($uiPhase !== lastPhase) {
    lastPhase = $uiPhase;
    selDie = null; selFace = null; fusionMode = false; fuseSel = [];
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

  $: scolpireQ = $forgeVersion >= 0 && $uiPhase === 'forge' ? (gm?.quoteScolpire() ?? null) : null;
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
    const filename = `dice-goblin-registro-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
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

<main class="game" class:crt={$settings.crt} data-coach={showCoach ? COACH[coach]?.target : ""}>
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
        {#if gm && gm.getFamilyView().length}
          <div class="fams">
            {#each gm.getFamilyView() as f}
              <span class="fam" style="--fc:{f.color}" class:set={f.count >= 2} title={f.name + '\n' + f.lines.join('\n')}>
                <Icon e={f.icon} /> <b>{f.count}</b>
              </span>
            {/each}
          </div>
        {/if}
        {#each Array(MAX_EQUIPMENT_SLOTS) as _, i}
          {@const item = gm?.equipment.slots[i] ?? null}
          <span class="relic" title={item ? `${item.name}${item.relic ? ' (reliquia)' : ''} — ${item.description}` : 'Slot vuoto: compra oggetti dal mercante'}>
            <ItemBadge icon={item?.icon ?? ''} rarity={item?.rarity} relic={!!item?.relic} empty={!item} size={50} />
          </span>
        {/each}
      </div>
    {/key}

    <div class="topright">
      <span class="gold" title="Oro"><Icon e="💰" /> <Counter value={$goldNum} ticks floaty /></span>
      <button class="restart icon-btn no-s" title={$settings.muted ? 'Attiva i suoni' : 'Silenzia'} aria-label="Suoni"
        on:click={() => settings.update(v => ({ ...v, muted: !v.muted }))}><Icon e={$settings.muted ? '🔇' : '🔊'} mono /></button>
      <button class="restart icon-btn" class:on={$settings.fast} title="Modalità veloce: animazioni più rapide" aria-label="Modalità veloce"
        on:click={() => settings.update(v => ({ ...v, fast: !v.fast }))}><Icon e="⏩" mono /></button>
      <button class="restart icon-btn no-m" class:on={$settings.crt} title="Effetto schermo da vecchio monitor" aria-label="Effetto CRT"
        on:click={() => settings.update(v => ({ ...v, crt: !v.crt }))}><span class="crt-label">CRT</span></button>
      <button class="restart" on:click={() => menuOpen.set(true)}><Icon e="☰" /> Menù</button>
      <button class="restart no-m" class:armed={restartArmed} on:click={onRestart}>
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
              {#if offer.family}
                <span class="fam-tag" style="--fc:{offer.family.color}" title="Famiglia {offer.family.name}: ne hai già {offer.family.owned}">
                  <Icon e={offer.family.icon} /> {offer.family.name}{#if offer.family.owned > 0} · {offer.family.owned} → {offer.family.owned + 1}{/if}
                </span>
              {/if}
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
            <button class="door k-{d.kind}" class:golden={$crossroadSpecial} class:elite={d.kind === 'elite'} on:click={() => gm?.chooseDoor(d.kind)}>
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
        <div class="crogiolo">
          <button class="service" disabled={!scolpireQ?.ok || $forgeOpsLeft === 0}
            title={scolpireQ?.reason ?? scolpireQ?.preview} on:click={() => gm?.applyForge({ kind: 'scolpire' })}>
            <span><Icon e="🎲" /> Scolpisci un dado nuovo</span>
            {#if scolpireQ}<span class="cost"><Icon e="💰" /> {scolpireQ.cost}</span>{/if}
            {#if scolpireQ?.preview}<span class="hint">{scolpireQ.preview}</span>{/if}
          </button>
        </div>
        <div class="crogiolo">
          <h3><Icon e="⚗️" /> Crogiolo: fondi due oggetti</h3>
          {#if fuseItemsList.length >= 2}
            <div class="fuse-items">
              {#each fuseItemsList as it}
                <button class="fuse-item {it.rarity}" class:selected={fuseSel.includes(it.slot)} disabled={it.relic || it.fusion}
                  title={it.relic ? 'Le reliquie non si fondono' : it.fusion ? 'Già una fusione' : it.name}
                  on:click={() => toggleFuse(it.slot)}>
                  <ItemBadge icon={it.icon} rarity={it.rarity} size={34} />
                  <small>{it.name}</small><small class="fams-line">{it.families}</small>
                </button>
              {/each}
            </div>
            {#if fuseQ}
              <p class="fuse-preview">
                {#if fuseQ.name}<b>{fuseQ.name}</b> — {fuseQ.description}{:else}{fuseQ.reason}{/if}
              </p>
              <button class="service" disabled={!fuseQ.ok || $forgeOpsLeft === 0}
                title={fuseQ.reason} on:click={doFuse}>
                <span><Icon e="⚗️" /> Fondi</span><span class="cost"><Icon e="💰" /> {fuseQ.cost}</span>
              </button>
            {:else}
              <p class="hint-line">Scegli due oggetti: ne nasce uno solo, con gli effetti di entrambi e un bonus di famiglia. Libera uno slot.</p>
            {/if}
          {:else}
            <p class="hint-line">Servono almeno due oggetti.</p>
          {/if}
        </div>
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
        <h1 class="logo">DICE<br />GOBLIN</h1>
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
   *   topbar   → progresso della run, oggetti, oro
   *   palco    → il goblin, il nemico, i dadi 3D
   *   tavolo   → i dadi della mano (si alzano quando li giochi) e la potenza
   *   dock     → le quattro azioni, grosse e colorate (tasti 1-4)
   * I colori e le forme vengono da theme.css.
   * ============================================================ */
  .game {
    --num: var(--font-num); --pink: var(--ember); --green: var(--moss); --cyan: var(--crystal);
    --panel-bg: linear-gradient(180deg, var(--c3), var(--c2) 55%, var(--c1));
    --panel-sh: 0 5px 0 var(--ink), inset 0 3px 0 rgba(255, 255, 255, 0.16), inset 0 0 0 2px rgba(255, 255, 255, 0.05);
    height: 100%; box-sizing: border-box; max-width: 1440px; margin: 0 auto;
    padding: 10px 14px 12px;
    display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: 10px;
    font-family: 'Cifre Nitide', var(--font-ui); color: var(--bone);
    font-variant-ligatures: none; font-feature-settings: 'liga' 0, 'clig' 0;
  }
  kbd {
    font-family: inherit; font-size: 13px; padding: 1px 7px; border-radius: 6px;
    background: var(--ink); color: var(--bone); border: 2px solid rgba(255, 255, 255, 0.35);
  }
  .num { font-family: var(--num); }

  /* ---- Barra alta ---- */
  .topbar {
    display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px;
    background: var(--panel-bg); border: var(--bw) solid var(--ink); border-radius: var(--r-panel);
    box-shadow: var(--panel-sh); padding: 8px 14px;
  }
  .run { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .act {
    font-weight: 700; font-size: 19px; white-space: nowrap; letter-spacing: 1px; color: var(--bone);
    padding: 3px 14px; border: var(--bw) solid var(--ink); border-radius: 10px; transform: rotate(-1.5deg);
    background: linear-gradient(180deg, #ff8a5c, var(--ember) 55%, var(--ember-d));
    box-shadow: 0 3px 0 var(--ink), inset 0 2px 0 rgba(255, 255, 255, 0.4); text-shadow: 0 2px 0 var(--ink);
  }
  .pips { display: flex; gap: 6px; align-items: center; }
  .pip { width: 15px; height: 15px; border-radius: 4px; background: var(--c1); border: 2px solid var(--ink); box-shadow: 0 2px 0 var(--ink); }
  .pip.done { background: var(--moss); }
  .pip.cur { background: var(--gold); transform: scale(1.35); animation: bob 1.1s ease-in-out infinite; box-shadow: 0 2px 0 var(--ink), 0 0 10px var(--gold); }
  .pip.champ, .pip.boss { border-radius: 50%; width: 19px; height: 19px; }
  .pip.champ { border-color: var(--gold); }
  .pip.boss { border-color: var(--blood); }
  .pip.champ.done { background: var(--gold-d); }
  .pip.boss.done { background: var(--blood); }
  .relics { display: flex; gap: 8px; align-items: center; padding: 4px 10px; background: rgba(8, 4, 15, 0.55); border-radius: 12px; border: 2px solid var(--ink); box-shadow: inset 0 3px 0 rgba(0, 0, 0, 0.4); }
  .relic { display: inline-flex; cursor: help; transition: transform 0.12s; }
  .relic:hover { transform: translateY(-4px) rotate(-3deg) scale(1.08); }
  .fams { display: flex; gap: 6px; margin-right: 4px; }
  .fam {
    display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 999px; font-size: 15px; font-weight: 700; cursor: help;
    border: 2px solid var(--ink); background: color-mix(in srgb, var(--fc) 30%, var(--c1)); box-shadow: 0 2px 0 var(--ink);
  }
  .fam.set { background: color-mix(in srgb, var(--fc) 55%, var(--c1)); box-shadow: 0 2px 0 var(--ink), 0 0 12px var(--fc); }
  .topright { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: nowrap; }
  .relics { justify-self: center; }
  .gold {
    display: inline-flex; align-items: center; gap: 6px; font-family: var(--num); font-weight: 800; font-size: 24px; color: var(--gold);
    text-shadow: var(--num-stroke); padding: 2px 16px 2px 10px; border-radius: 999px; background: var(--c0);
    border: var(--bw) solid var(--ink); box-shadow: 0 3px 0 var(--ink), inset 0 0 0 2px rgba(255, 208, 74, 0.35);
  }
  .restart {
    font-family: inherit; font-size: 15px; font-weight: 600; padding: 6px 12px; cursor: pointer; color: var(--bone);
    background: linear-gradient(180deg, var(--c4), var(--c3)); border: var(--bw) solid var(--ink); border-radius: 10px;
    box-shadow: 0 3px 0 var(--ink), inset 0 2px 0 rgba(255, 255, 255, 0.2); transition: transform 0.08s;
  }
  .restart:hover { transform: translateY(-2px) rotate(-1deg); }
  .restart:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--ink); }
  .restart.armed { background: linear-gradient(180deg, #ff7a8c, var(--blood)); color: #fff; text-shadow: 0 1px 0 var(--ink); }
  .icon-btn { padding: 6px 10px; display: inline-flex; align-items: center; gap: 4px; }
  .icon-btn.on { background: linear-gradient(180deg, #ffe27a, var(--gold)); color: var(--ink); }
  .crt-label { font-family: var(--font-num); font-size: 14px; font-weight: 800; letter-spacing: 0; }

  /* ---- Palco + registro eventi ---- */
  .stage-area { position: relative; min-height: 0; }
  .feed {
    position: absolute; left: 16px; bottom: 12px; z-index: 8; pointer-events: none;
    display: flex; flex-direction: column-reverse; gap: 4px; font-size: 15px; max-width: 48%;
  }
  .feed div { width: fit-content; padding: 2px 12px; border-radius: 8px; background: rgba(8, 4, 15, 0.78); border: 2px solid rgba(0, 0, 0, 0.6); }

  /* ---- Il tavolo: la mano di dadi e la potenza ---- */
  .scorebar {
    display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 96px; padding: 12px 18px;
    border-radius: var(--r-panel); border: var(--bw) solid var(--ink);
    background:
      radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1.5px) 0 0 / 14px 14px,
      linear-gradient(180deg, #276650, #1b4a3b 60%, #153a2f);
    box-shadow: 0 5px 0 var(--ink), inset 0 3px 0 rgba(255, 255, 255, 0.16), inset 0 0 50px rgba(0, 0, 0, 0.4);
  }
  .tray { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; min-width: 0; padding-top: 12px; }
  .card-slot { display: flex; align-items: flex-end; gap: 5px; }
  .chip {
    --die-a: #fff6df; --die-b: #e3cf9f; --die-ink: #2a1a3a;
    display: inline-flex; align-items: center; justify-content: center; min-width: 64px; height: 64px; padding: 0 10px; box-sizing: border-box;
    border-radius: 14px; border: var(--bw) solid var(--ink); cursor: default;
    background: linear-gradient(180deg, var(--die-a), var(--die-b)); color: var(--die-ink);
    font-family: var(--num); font-size: 27px; font-weight: 800;
    box-shadow: 0 5px 0 var(--ink), inset 0 3px 0 rgba(255, 255, 255, 0.7), inset 0 -4px 0 rgba(0, 0, 0, 0.16);
    transition: transform 0.14s cubic-bezier(.3, 1.6, .5, 1), box-shadow 0.14s, filter 0.14s;
    animation: chip-in 0.45s cubic-bezier(.2, 1.5, .4, 1) both; animation-delay: calc(var(--i) * 70ms);
  }
  @keyframes chip-in { from { transform: translateY(14px) scale(0.5) rotate(-8deg); opacity: 0; } to { transform: none; opacity: 1; } }
  .chip.multiplier { --die-a: #ff9a6e; --die-b: var(--ember-d); --die-ink: #fff; text-shadow: 0 2px 0 var(--ink); }
  .chip.buff { --die-a: #9bf58f; --die-b: var(--moss-d); --die-ink: #fff; text-shadow: 0 2px 0 var(--ink); }
  .chip.recursive { --die-a: #8ff2e0; --die-b: #1f8f86; --die-ink: #fff; text-shadow: 0 2px 0 var(--ink); }
  .chip.selectable { cursor: pointer; }
  .chip.selectable:hover { transform: translateY(-4px) rotate(-1.5deg); }
  /* giocato: il dado si alza e brilla; in panchina: affonda e si spegne */
  .chip.selected { transform: translateY(-12px) rotate(-2deg); box-shadow: 0 12px 0 var(--ink), 0 0 0 4px var(--gold), 0 0 22px var(--gold), inset 0 3px 0 rgba(255, 255, 255, 0.7); }
  .chip.benched { transform: translateY(5px); filter: brightness(0.5) saturate(0.55); box-shadow: 0 2px 0 var(--ink); }
  .chip.extra { min-width: 0; height: 44px; font-size: 19px; padding: 0 10px; border-radius: 10px; }
  .side { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; justify-content: flex-end; }
  .fxsum { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-weight: 800; font-size: 19px; text-shadow: var(--num-stroke); }
  .fxsum > span { padding: 2px 12px; border-radius: 999px; background: var(--c0); border: 2px solid var(--ink); }
  .e-p { color: var(--venom); } .e-s { color: var(--shield); } .e-f { color: var(--fire); }
  .react { color: var(--gold); font-size: 16px; animation: chip-in 0.4s cubic-bezier(.2, 1.5, .4, 1) both; }
  .formula {
    display: flex; gap: 14px; align-items: center; white-space: nowrap; padding: 6px 18px; border-radius: 16px;
    background: var(--c0); border: var(--bw) solid var(--ink); box-shadow: 0 4px 0 var(--ink), inset 0 0 0 2px rgba(255, 255, 255, 0.07);
  }
  .f-mult {
    color: var(--bone); font-weight: 800; font-size: 32px; padding: 0 12px; border-radius: 10px; text-shadow: var(--num-stroke);
    background: linear-gradient(180deg, #ff8a5c, var(--ember-d)); border: 2px solid var(--ink);
  }
  .formula.hot .f-mult { font-size: 40px; background: linear-gradient(180deg, #ffe27a, #f29a14); color: var(--ink); text-shadow: 0 2px 0 rgba(255, 255, 255, 0.5); animation: glow-pulse 0.9s ease-in-out infinite; }
  .f-pow { display: flex; flex-direction: column; align-items: flex-end; line-height: 1; }
  .f-pow small { color: var(--ash); font-size: 14px; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 2px; }
  .f-pow b { color: var(--gold); font-size: 44px; font-weight: 800; text-shadow: var(--num-stroke); }
  .f-pow b.pop { display: inline-block; animation: popnum 0.35s cubic-bezier(.2, 1.6, .4, 1); }
  @keyframes popnum { 0% { transform: scale(1.5); color: #fff; } 100% { transform: scale(1); } }
  .hand-slots {
    display: flex; flex-direction: column; align-items: center; line-height: 1.1; padding: 6px 14px; border-radius: 14px; font-weight: 800; font-size: 19px;
    background: var(--c0); border: var(--bw) solid var(--ink); box-shadow: 0 4px 0 var(--ink); color: var(--bone);
  }
  .hand-slots small { font-weight: 400; font-size: 14px; color: var(--ash); }

  /* ---- Dock: quattro azioni, ognuna col suo colore ---- */
  .dock { display: block; }
  .hand { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; max-width: 1100px; margin: 0 auto; }
  .card {
    --sc: var(--ember-d); --sc-hi: #ff8a5c;
    position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 16px 10px 12px; cursor: pointer; font-family: inherit; color: #fff; text-shadow: 0 2px 0 var(--ink);
    background: linear-gradient(180deg, var(--sc-hi), var(--sc) 55%, color-mix(in srgb, var(--sc) 70%, #000));
    border: var(--bw) solid var(--ink); border-radius: var(--r-panel);
    box-shadow: 0 6px 0 var(--ink), inset 0 3px 0 rgba(255, 255, 255, 0.4), inset 0 -4px 0 rgba(0, 0, 0, 0.2);
    transition: transform 0.12s cubic-bezier(.3, 1.6, .5, 1), box-shadow 0.12s, filter 0.12s;
  }
  .card:nth-child(1) { --sc: #c9411e; --sc-hi: #ff8a5c; }
  .card:nth-child(2) { --sc: #2f78cf; --sc-hi: #7cc0ff; }
  .card:nth-child(3) { --sc: #3b9a35; --sc-hi: #9be85f; }
  .card:nth-child(4) { --sc: #a86a0a; --sc-hi: #ffd04a; }
  .card:hover:not(:disabled) { transform: translateY(-8px) rotate(-1deg); box-shadow: 0 14px 0 var(--ink), 0 0 26px color-mix(in srgb, var(--sc-hi) 60%, transparent), inset 0 3px 0 rgba(255, 255, 255, 0.4); }
  .card:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 2px 0 var(--ink), inset 0 3px 0 rgba(255, 255, 255, 0.4); }
  .card:disabled { cursor: default; filter: saturate(0.35) brightness(0.65); }
  .key { position: absolute; top: 8px; left: 10px; }
  .c-icon { font-size: 40px; line-height: 1; filter: drop-shadow(0 3px 0 var(--ink)); } .c-icon :global(.gi) { width: 1em; height: 1em; vertical-align: 0; }
  .c-name { font-size: 20px; font-weight: 800; text-align: center; letter-spacing: 0.5px; }
  .c-preview { font-family: var(--num); font-size: 26px; font-weight: 800; color: var(--gold); text-align: center; min-height: 34px; text-shadow: var(--num-stroke); }
  .c-alert { font-size: 14px; font-weight: 700; text-align: center; padding: 1px 10px; border-radius: 999px; border: 2px solid var(--ink); }
  .c-alert.good { background: var(--moss); color: var(--ink); text-shadow: none; }
  .c-alert.warn { background: var(--gold); color: var(--ink); text-shadow: none; }
  .c-hint { font-size: 14px; color: #fff; opacity: 0.92; text-align: center; line-height: 1.25; }

  /* ---- Telefono in verticale: tutta la battaglia in una schermata, senza scorrere ----
     barra alta compatta (2 righe) → palco che prende lo spazio avanzato → dadi → 4 azioni in 2x2 */
  @media (max-width: 760px) and (orientation: portrait) {
    .game { height: 100dvh; min-height: 0; overflow: hidden; grid-template-rows: auto minmax(180px, 1fr) auto auto; gap: 6px; padding: 6px 6px calc(6px + env(safe-area-inset-bottom)); }
    .topbar { grid-template-columns: auto 1fr; gap: 4px 8px; padding: 5px 8px; border-radius: 12px; }
    .run { gap: 8px; }
    .act { font-size: 14px; padding: 1px 9px; }
    .pips { gap: 2px; }
    .pip { width: 6px; height: 6px; border-width: 1.5px; box-shadow: none; }
    .pips { gap: 1px; } .run { gap: 6px; min-width: 0; } .topright { gap: 4px; }
    .pip.champ, .pip.boss { width: 9px; height: 9px; }
    .topright { gap: 5px; flex-wrap: nowrap; }
    .gold { font-size: 16px; padding: 0 8px 0 5px; box-shadow: 0 2px 0 var(--ink); }
    .restart { padding: 4px 8px; font-size: 0; box-shadow: 0 2px 0 var(--ink); }
    .restart :global(.gi) { font-size: 18px; }
    .no-m { display: none; }
    .relics { grid-column: 1 / -1; order: 3; justify-self: stretch; justify-content: center; gap: 4px; padding: 2px 6px; zoom: 0.62; }
    .topright { justify-self: end; }
    .act { font-size: 13px; }
    .restart { padding: 3px 6px; }
    .fam { font-size: 17px; }
    .scorebar { flex-direction: column; align-items: stretch; gap: 6px; min-height: 0; padding: 8px 10px 8px; box-shadow: 0 3px 0 var(--ink), inset 0 2px 0 rgba(255, 255, 255, 0.16); }
    .tray { gap: 7px; padding-top: 10px; justify-content: center; }
    .chip { min-width: 46px; height: 46px; font-size: 20px; padding: 0 6px; border-radius: 11px; box-shadow: 0 3px 0 var(--ink), inset 0 2px 0 rgba(255, 255, 255, 0.7); }
    .chip.selected { transform: translateY(-8px); box-shadow: 0 8px 0 var(--ink), 0 0 0 3px var(--gold), 0 0 14px var(--gold); }
    .chip.extra { height: 34px; font-size: 15px; }
    .side { flex-wrap: nowrap; justify-content: space-between; gap: 6px; }
    .fxsum { font-size: 14px; gap: 4px; } .fxsum > span { padding: 0 8px; }
    .formula { gap: 8px; padding: 2px 10px; border-radius: 12px; box-shadow: 0 3px 0 var(--ink); }
    .f-mult { font-size: 20px; padding: 0 8px; } .formula.hot .f-mult { font-size: 24px; }
    .f-pow small { font-size: 11px; letter-spacing: 2px; margin-bottom: 0; }
    .f-pow b { font-size: 30px; }
    .hand-slots { padding: 2px 10px; font-size: 16px; border-radius: 12px; box-shadow: 0 3px 0 var(--ink); } .hand-slots small { font-size: 12px; }
    .hand { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .card { padding: 6px 6px 7px; flex-direction: row; flex-wrap: wrap; justify-content: center; align-items: center; gap: 0 8px; border-radius: 13px; box-shadow: 0 4px 0 var(--ink), inset 0 2px 0 rgba(255, 255, 255, 0.4); }
    .c-icon { font-size: 24px; } .c-name { font-size: 16px; }
    .c-preview { font-size: 19px; min-height: 0; flex-basis: 100%; line-height: 1.1; }
    .c-alert { font-size: 12px; flex-basis: 100%; padding: 0 6px; margin-top: 2px; }
    .c-hint, .key { display: none; }
    .feed { font-size: 12px; max-width: 80%; left: 8px; bottom: 6px; }
    .feed div:nth-child(n+2) { display: none; }
  }
  /* schermi molto stretti o bassi: si toglie il superfluo per tenere tutto in vista */
  @media (max-width: 380px) { .no-s { display: none; } .act { font-size: 12px; padding: 1px 7px; } }
  @media (max-width: 760px) and (orientation: portrait) and (max-height: 700px) {
    .relics { display: none; }
    .f-pow small, .hand-slots small { display: none; }
    .tray { padding-top: 8px; gap: 5px; }
    .chip { min-width: 40px; height: 40px; font-size: 18px; }
    .f-pow b { font-size: 26px; } .hand-slots { font-size: 14px; }
    .c-preview { font-size: 17px; } .c-name { font-size: 14px; } .c-icon { font-size: 20px; }
    .c-alert { display: none; }
    .feed { display: none; }
  }
  /* ---- Telefono in orizzontale: palco a sinistra, dadi e azioni a destra ---- */
  @media (orientation: landscape) and (max-height: 520px) {
    .game {
      height: 100dvh; max-width: none; overflow: hidden; padding: 4px max(8px, env(safe-area-inset-right)) 4px max(8px, env(safe-area-inset-left)); gap: 6px;
      grid-template-columns: minmax(0, 1fr) clamp(300px, 40vw, 400px); grid-template-rows: auto minmax(0, 1fr) auto;
      grid-template-areas: 'top top' 'stage score' 'stage dock';
    }
    .topbar { grid-area: top; padding: 3px 10px; gap: 10px; border-radius: 12px; box-shadow: 0 3px 0 var(--ink), inset 0 2px 0 rgba(255, 255, 255, 0.16); }
    .stage-area { grid-area: stage; }
    .scorebar { grid-area: score; }
    .dock { grid-area: dock; }
    .act { font-size: 13px; padding: 0 9px; }
    .pips { gap: 2px; } .pip { width: 7px; height: 7px; border-width: 1.5px; box-shadow: none; } .pip.champ, .pip.boss { width: 10px; height: 10px; }
    .relics { zoom: 0.5; gap: 4px; padding: 2px 6px; justify-self: center; }
    .fam { font-size: 17px; }
    .topright { gap: 5px; flex-wrap: nowrap; }
    .gold { font-size: 17px; padding: 0 9px 0 5px; box-shadow: 0 2px 0 var(--ink); }
    .restart { padding: 2px 8px; font-size: 0; box-shadow: 0 2px 0 var(--ink); }
    .restart :global(.gi) { font-size: 17px; }
    .no-m { display: none; }
    .scorebar { flex-direction: column; align-items: stretch; justify-content: center; gap: 6px; min-height: 0; padding: 6px 10px; box-shadow: 0 3px 0 var(--ink), inset 0 2px 0 rgba(255, 255, 255, 0.16); }
    .tray { gap: 6px; padding-top: 8px; justify-content: center; }
    .chip { min-width: 40px; height: 40px; font-size: 18px; padding: 0 5px; border-radius: 10px; box-shadow: 0 3px 0 var(--ink), inset 0 2px 0 rgba(255, 255, 255, 0.7); }
    .chip.selected { transform: translateY(-7px); box-shadow: 0 7px 0 var(--ink), 0 0 0 3px var(--gold), 0 0 12px var(--gold); }
    .chip.extra { height: 30px; font-size: 14px; }
    .side { flex-wrap: nowrap; justify-content: space-between; gap: 6px; }
    .fxsum { font-size: 13px; gap: 4px; } .fxsum > span { padding: 0 7px; }
    .formula { gap: 8px; padding: 2px 10px; border-radius: 12px; box-shadow: 0 3px 0 var(--ink); }
    .f-mult { font-size: 18px; padding: 0 7px; } .formula.hot .f-mult { font-size: 22px; }
    .f-pow small, .hand-slots small { display: none; }
    .f-pow b { font-size: 28px; }
    .hand-slots { padding: 2px 10px; font-size: 14px; border-radius: 12px; box-shadow: 0 3px 0 var(--ink); }
    .hand { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; max-width: none; }
    .card { padding: 4px 6px 6px; flex-direction: row; flex-wrap: wrap; justify-content: center; align-items: center; gap: 0 6px; border-radius: 12px; box-shadow: 0 4px 0 var(--ink), inset 0 2px 0 rgba(255, 255, 255, 0.4); }
    .c-icon { font-size: 20px; } .c-name { font-size: 14px; }
    .c-preview { font-size: 16px; min-height: 0; flex-basis: 100%; line-height: 1.1; }
    .c-alert { display: none; }
    .c-hint, .key { display: none; }
    .feed { font-size: 12px; left: 8px; bottom: 6px; max-width: 70%; }
    .feed div:nth-child(n+2) { display: none; }
    .coach { bottom: 12px; left: 8px; transform: none; width: min(360px, 46vw); padding: 10px 12px; }
    .coach p { font-size: 14px; margin-bottom: 8px; } .coach h3 { font-size: 18px; }
    /* finestre: poca altezza, quindi più larghe che alte */
    .overlay { padding: 6px; }
    .overlay-box { --pad-x: 14px; --pad-y: 10px; max-height: 98dvh; gap: 8px; }
    .overlay-box h2 { font-size: 20px; padding: 7px 12px 6px; }
    .offers { gap: 8px; }
    .menu-box { max-width: 520px; }
    .logo { font-size: 34px; }
  }
  /* col tocco non esiste il passaggio del mouse: niente sollevamenti rimasti "appiccicati" dopo un tap */
  @media (hover: none) {
    .card:hover:not(:disabled), .skill:hover:not(:disabled), button.ghost:hover:not(:disabled), .service:hover:not(:disabled),
    .forge-die:hover, .restart:hover, .shop-reroll:hover:not(:disabled), .chip.selectable:hover { transform: none; filter: none; }
    .card:hover:not(:disabled) { box-shadow: 0 6px 0 var(--ink), inset 0 3px 0 rgba(255, 255, 255, 0.4), inset 0 -4px 0 rgba(0, 0, 0, 0.2); }
    .door:hover:not(:disabled), .offer:hover:not(:disabled) { transform: none; box-shadow: 0 6px 0 var(--ink), inset 0 8px 0 var(--acc), inset 0 11px 0 rgba(255, 255, 255, 0.16); }
  }
  @media (prefers-reduced-motion: reduce) { .chip, .card { animation: none; transition: none; } }

  /* ============================================================
   * Finestre: stessa forma per tutto. Una fascia colorata in testa dice dove sei.
   * ============================================================ */
  .overlay {
    position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; padding: 14px; box-sizing: border-box;
    background: radial-gradient(ellipse at 50% 40%, rgba(40, 22, 70, 0.78), rgba(6, 3, 12, 0.92)); backdrop-filter: blur(3px);
  }
  .overlay-box {
    --band: linear-gradient(180deg, #a77bff, #6b3fc4); --band-ink: var(--bone); --pad-x: 34px; --pad-y: 30px;
    position: relative; background: var(--panel-bg); border: var(--bw) solid var(--ink); border-radius: 20px;
    padding: var(--pad-y) var(--pad-x) 26px; text-align: center; display: flex; flex-direction: column; gap: 14px;
    max-height: 94vh; overflow-y: auto; box-sizing: border-box; max-width: 100%;
    box-shadow: 0 8px 0 var(--ink), 0 30px 70px rgba(0, 0, 0, 0.6), inset 0 3px 0 rgba(255, 255, 255, 0.18), inset 0 0 0 2px rgba(255, 255, 255, 0.05);
    animation: pop-in 0.4s cubic-bezier(.2, 1.4, .4, 1) both;
  }
  .overlay-box h2 {
    margin: calc(var(--pad-y) * -1) calc(var(--pad-x) * -1) 4px; padding: 14px 20px 12px; font-size: 28px; letter-spacing: 1.5px;
    background: var(--band); color: var(--band-ink); border-bottom: var(--bw) solid var(--ink); border-radius: 17px 17px 0 0;
    box-shadow: inset 0 3px 0 rgba(255, 255, 255, 0.4); text-shadow: 0 3px 0 var(--ink);
  }
  .overlay-box.royal { --band: linear-gradient(180deg, #ffe27a, #e9a419); --band-ink: var(--ink); box-shadow: 0 8px 0 var(--ink), 0 0 50px rgba(255, 208, 74, 0.35), inset 0 3px 0 rgba(255, 255, 255, 0.18); }
  .overlay-box.royal h2 { text-shadow: 0 2px 0 rgba(255, 255, 255, 0.5); }
  .shop-box { --band: linear-gradient(180deg, #8ae67f, #3b9a35); }
  .forge-box { --band: linear-gradient(180deg, #ff9a6e, #c9411e); }
  .event-box { --band: linear-gradient(180deg, #7cc0ff, #2f78cf); }
  .summary-box { --band: linear-gradient(180deg, #ff7a8c, #b8321c); }
  .summary-box.royal { --band: linear-gradient(180deg, #ffe27a, #e9a419); }
  .menu-box { --band: transparent; }
  @media (max-width: 760px) { .overlay-box { --pad-x: 14px; --pad-y: 18px; width: 100%; } .overlay-box h2 { font-size: 22px; } }

  .hint-line { font-size: 16px; color: var(--ash); margin: 0; }
  .hint-line :global(.gi) { vertical-align: -0.2em; }
  .unlock { margin: 0; padding: 6px 14px; border-radius: 12px; font-weight: 700; font-size: 16px; color: var(--moss); background: rgba(116, 217, 106, 0.12); border: 2px solid var(--moss-d); }
  .hpnow { font-size: 16px; color: var(--ash); font-weight: 400; }
  .credits { font-size: 14px; color: var(--ash-d); margin: 8px 0; }
  .credits a { color: var(--crystal); }

  /* ---- Pulsanti ---- */
  .skill, button.ghost, .shop-reroll, .service, .forge-die, .fuse-item {
    font-family: inherit; cursor: pointer; color: var(--bone); border: var(--bw) solid var(--ink); border-radius: var(--r-btn);
    transition: transform 0.08s cubic-bezier(.3, 1.6, .5, 1), filter 0.1s, box-shadow 0.08s;
  }
  .skill {
    font-size: 20px; font-weight: 800; letter-spacing: 0.5px; padding: 12px 24px; color: var(--ink);
    background: linear-gradient(180deg, #ffe27a, #ffbf2e 55%, #f29a14);
    box-shadow: 0 6px 0 var(--ink), inset 0 3px 0 rgba(255, 255, 255, 0.6), inset 0 -4px 0 rgba(160, 80, 0, 0.35); text-shadow: 0 1px 0 rgba(255, 255, 255, 0.45);
  }
  .skill small { display: block; font-size: 14px; font-weight: 600; opacity: 0.8; }
  .skill:hover:not(:disabled) { transform: translateY(-3px) rotate(-0.8deg); filter: brightness(1.07); }
  .skill:active:not(:disabled) { transform: translateY(4px); box-shadow: 0 2px 0 var(--ink), inset 0 3px 0 rgba(255, 255, 255, 0.6); }
  button.ghost {
    font-size: 16px; font-weight: 600; padding: 10px 16px; background: linear-gradient(180deg, var(--c4), var(--c3) 60%, var(--c2));
    box-shadow: 0 4px 0 var(--ink), inset 0 2px 0 rgba(255, 255, 255, 0.2);
  }
  button.ghost:hover:not(:disabled) { transform: translateY(-2px) rotate(-0.6deg); filter: brightness(1.12); }
  button.ghost:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 1px 0 var(--ink); }
  .skill:disabled, button.ghost:disabled, .shop-reroll:disabled, .service:disabled, .offer:disabled, .door:disabled { opacity: 0.45; cursor: not-allowed; filter: grayscale(0.5); }
  .btn-row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 8px; }

  /* ---- Carte: offerte, porte, premi ---- */
  .door, .offer {
    --acc: var(--moss);
    position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; cursor: pointer; font-family: inherit; color: var(--bone);
    padding: 18px 16px 20px; background: linear-gradient(180deg, var(--c4), var(--c3) 45%, var(--c2));
    border: var(--bw) solid var(--ink); border-radius: var(--r-panel);
    box-shadow: 0 6px 0 var(--ink), inset 0 8px 0 var(--acc), inset 0 11px 0 rgba(255, 255, 255, 0.16), inset 0 0 0 2px rgba(255, 255, 255, 0.05);
    transition: transform 0.12s cubic-bezier(.3, 1.6, .5, 1), box-shadow 0.12s, filter 0.12s;
  }
  .door:hover:not(:disabled), .offer:hover:not(:disabled) { transform: translateY(-6px) rotate(-1deg); box-shadow: 0 12px 0 var(--ink), 0 0 26px color-mix(in srgb, var(--acc) 55%, transparent), inset 0 8px 0 var(--acc), inset 0 11px 0 rgba(255, 255, 255, 0.16); }
  .door:active:not(:disabled), .offer:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 2px 0 var(--ink), inset 0 8px 0 var(--acc); }
  .door .icon, .offer .icon { font-size: 44px; line-height: 1; margin-top: 8px; filter: drop-shadow(0 3px 0 var(--ink)); }
  .door .label, .offer .label { font-weight: 800; font-size: 20px; line-height: 1.15; }
  .door .hint, .offer .hint { font-size: 15px; line-height: 1.3; color: var(--ash); }
  .hint.warn { color: var(--gold); }
  .door.golden { --acc: var(--gold); background: linear-gradient(180deg, #5a4420, #3d2f14 45%, #2b210e); }
  .door.elite { --acc: var(--blood); }
  .door.k-forge { --acc: var(--ember); } .door.k-event { --acc: var(--arcane); } .door.k-rest { --acc: var(--crystal); } .door.k-shop { --acc: var(--moss); }
  .offer.comune { --acc: var(--r-comune); }
  .offer.non-comune { --acc: var(--r-non-comune); }
  .offer.raro { --acc: var(--r-raro); box-shadow: 0 6px 0 var(--ink), 0 0 22px rgba(199, 125, 255, 0.4), inset 0 8px 0 var(--acc), inset 0 11px 0 rgba(255, 255, 255, 0.16); }
  .tier { display: inline-block; margin-top: 2px; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 700; padding: 0 8px; border-radius: 6px; background: var(--ink); color: var(--acc); }
  .fam-tag { display: inline-block; font-size: 14px; font-weight: 700; padding: 1px 10px; border-radius: 999px; border: 2px solid var(--ink); background: color-mix(in srgb, var(--fc) 35%, var(--c1)); }
  .cost {
    display: inline-flex; align-items: center; gap: 5px; margin-top: auto; padding: 3px 14px; border-radius: 999px; font-family: var(--num); font-weight: 800; font-size: 19px; color: var(--gold);
    background: var(--c0); border: 2px solid var(--ink); text-shadow: var(--num-stroke);
  }
  .cost.too-expensive { color: var(--blood); }

  .doors { display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; align-items: stretch; }
  .door { width: 230px; }
  .door.bag { width: 170px; padding: 14px 10px 16px; }
  .door.bag.locked { opacity: 0.5; filter: grayscale(0.7); }
  .door.bag.static { cursor: default; }
  .door.bag.static:hover { transform: none; }
  .event-box { max-width: 600px; }
  .event-opts { display: flex; flex-direction: column; gap: 12px; margin-top: 6px; }
  .event-opt { width: 100%; }
  .reward-col { display: flex; flex-direction: column; gap: 10px; align-items: stretch; }
  .reward-card.non-comune { --acc: var(--r-non-comune); }
  .reward-card.raro { --acc: var(--r-raro); box-shadow: 0 6px 0 var(--ink), 0 0 26px rgba(199, 125, 255, 0.5), inset 0 8px 0 var(--acc); }
  .reward-card.relic { --acc: var(--r-relic); box-shadow: 0 6px 0 var(--ink), 0 0 34px rgba(255, 211, 77, 0.6), inset 0 8px 0 var(--acc); }
  .sell-reward { font-size: 15px; padding: 8px 10px; }

  /* ---- Negozio ---- */
  .shop-box { width: min(980px, 100%); }
  .offers { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; }
  .shop-actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; align-items: center; }
  .shop-reroll { padding: 10px 18px; font-size: 17px; font-weight: 700; background: linear-gradient(180deg, var(--c4), var(--c3)); box-shadow: 0 4px 0 var(--ink), inset 0 2px 0 rgba(255, 255, 255, 0.2); display: inline-flex; align-items: center; gap: 8px; }
  .shop-reroll:hover:not(:disabled) { transform: translateY(-2px) rotate(-0.6deg); }
  .shop-actions .offer.service { min-width: 0; flex-direction: row; gap: 10px; padding: 10px 16px; box-shadow: 0 5px 0 var(--ink), inset 0 5px 0 var(--acc); --acc: var(--crystal); }
  .shop-actions .offer.service .icon { font-size: 26px; margin: 0; }
  .shop-actions .offer.service .label { font-size: 17px; }
  .sellrow { display: flex; flex-direction: column; gap: 8px; align-items: center; padding: 10px; border-radius: 14px; background: rgba(8, 4, 15, 0.45); border: 2px solid var(--ink); box-shadow: inset 0 3px 0 rgba(0, 0, 0, 0.35); }
  .sellrow .hint { font-size: 15px; color: var(--ash); }
  .sellrow .slots { display: flex; gap: 10px; }
  .sellslot { min-width: 66px; border-radius: 10px; background: transparent; border: 0; color: inherit; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 2px; transition: transform 0.12s; }
  .sellslot small { font-size: 14px; font-weight: 700; color: var(--gold); }
  .sellslot:not(:disabled):hover { transform: translateY(-4px) rotate(-2deg); }
  .sellslot:disabled { cursor: default; opacity: 0.6; }

  /* ---- Slot pieni, premio, borse, obiettivi ---- */
  .replace-overlay { z-index: 60; }
  .replace-box { width: min(820px, 100%); --band: linear-gradient(180deg, #ff7a8c, #b8321c); }
  .incoming { display: flex; gap: 14px; align-items: center; text-align: left; padding: 12px 14px; border-radius: 14px; background: rgba(255, 208, 74, 0.12); border: var(--bw) solid var(--gold-d); }
  .incoming b { font-size: 19px; }
  .replace-opt:disabled { opacity: 0.45; }
  .bag-box { width: min(780px, 100%); }
  .bags { display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; margin: 6px 0; }
  .bags-title { margin: 10px 0 0; font-size: 16px; letter-spacing: 3px; text-transform: uppercase; color: var(--ash); }
  .goals { display: flex; flex-direction: column; gap: 10px; text-align: left; }
  .goal { background: linear-gradient(180deg, var(--c3), var(--c2)); border: var(--bw) solid var(--ink); border-radius: 14px; padding: 12px 16px; box-shadow: 0 4px 0 var(--ink); }
  .goal.done { background: linear-gradient(180deg, #2f6a38, #1f4a2a); }
  .goal-top { display: flex; justify-content: space-between; font-size: 18px; }
  .goal-desc { font-size: 15px; color: var(--ash); margin: 3px 0 8px; }
  .goal-bar { height: 12px; background: var(--c0); border: 2px solid var(--ink); border-radius: 999px; overflow: hidden; }
  .goal-bar div { height: 100%; background: linear-gradient(180deg, #ffe27a, var(--gold-d)); }
  .goal.done .goal-bar div { background: linear-gradient(180deg, #b7ff9b, var(--moss)); }
  .goal-reward { font-size: 15px; color: var(--gold); margin-top: 6px; }

  /* ---- Forgia ---- */
  .forge-box { width: min(760px, 100%); }
  .crogiolo { margin-top: 6px; padding-top: 14px; border-top: 3px dashed rgba(255, 255, 255, 0.16); }
  .crogiolo h3 { margin: 0 0 10px; font-size: 18px; color: var(--gold); }
  .forge-dice, .fuse-items { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
  .forge-die { display: flex; flex-direction: column; gap: 2px; padding: 8px 14px; font-size: 17px; font-weight: 700; background: linear-gradient(180deg, var(--c4), var(--c3)); box-shadow: 0 4px 0 var(--ink), inset 0 2px 0 rgba(255, 255, 255, 0.2); }
  .forge-die .hint { font-size: 14px; font-weight: 400; color: var(--ash); }
  .forge-die:hover { transform: translateY(-2px); }
  .forge-die.selected { background: linear-gradient(180deg, #ffe27a, #f29a14); color: var(--ink); transform: translateY(-4px); box-shadow: 0 8px 0 var(--ink), 0 0 18px var(--gold); }
  .forge-die.selected .hint { color: var(--ink); }
  .forge-die.sacrifice { border-color: var(--blood); animation: pulse 0.8s infinite alternate; }
  @keyframes pulse { from { box-shadow: 0 4px 0 var(--ink), 0 0 2px var(--blood); } to { box-shadow: 0 4px 0 var(--ink), 0 0 18px var(--blood); } }
  .forge-chips { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; padding-top: 10px; }
  .services { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
  .service { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 14px; font-size: 16px; font-weight: 700; background: linear-gradient(180deg, #ff9a6e, #c9411e); color: #fff; text-shadow: 0 2px 0 var(--ink); box-shadow: 0 5px 0 var(--ink), inset 0 3px 0 rgba(255, 255, 255, 0.4); }
  .service:hover:not(:disabled) { transform: translateY(-3px) rotate(-0.8deg); }
  .service:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 1px 0 var(--ink); }
  .service.selected { outline: 4px solid var(--gold); }
  .forge-box .service { align-self: center; }
  .service .cost { font-size: 16px; padding: 0 10px; margin-top: 2px; }
  .service .hint { font-size: 14px; font-weight: 400; color: #fff; opacity: 0.9; }
  .fuse-item { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 10px; min-width: 104px; background: linear-gradient(180deg, var(--c4), var(--c3)); box-shadow: 0 4px 0 var(--ink); }
  .fuse-item.selected { background: linear-gradient(180deg, #ffe27a, #f29a14); color: var(--ink); transform: translateY(-4px); }
  .fuse-item:disabled { opacity: 0.4; cursor: not-allowed; }
  .fuse-item small { font-size: 14px; }
  .fuse-preview { margin: 10px auto; font-size: 16px; max-width: 600px; }

  /* ---- Menù, fine run, registro, tutorial ---- */
  .overlay.menu { z-index: 60; }
  .menu-box { max-width: 460px; padding-top: 28px; }
  .logo {
    font-size: 54px; line-height: 0.95; margin: 0 0 4px; color: var(--gold); letter-spacing: 3px; transform: rotate(-2deg); animation: bob 3s ease-in-out infinite;
    text-shadow: 0 4px 0 var(--ember-d), 0 8px 0 var(--ink), var(--num-stroke), 0 0 30px rgba(255, 106, 61, 0.55);
  }
  .menu-btns { display: flex; flex-direction: column; gap: 10px; margin: 10px 0; }
  .menu-btns :global(.skill), .menu-btns :global(button.ghost) { width: 100%; }
  .summary-box { width: min(560px, 100%); }
  .sum-grid { display: grid; grid-template-columns: 1fr auto; gap: 6px 18px; margin: 6px 0; font-size: 16px; text-align: left; padding: 12px 16px; border-radius: 14px; background: rgba(8, 4, 15, 0.45); border: 2px solid var(--ink); }
  .sum-l { color: var(--ash); }
  .sum-v { font-weight: 800; color: var(--gold); text-align: right; font-family: var(--num); }
  .sum-actions { display: flex; flex-direction: column; gap: 6px; margin: 6px 0; }
  .bar { position: relative; display: flex; justify-content: space-between; font-size: 15px; padding: 4px 12px; background: var(--c0); border: 2px solid var(--ink); border-radius: 10px; overflow: hidden; }
  .bar i { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(255, 106, 61, 0.4); z-index: 0; }
  .bar span, .bar b { position: relative; z-index: 1; }
  .howto { width: min(660px, 100%); text-align: left; --band: linear-gradient(180deg, #7cc0ff, #2f78cf); }
  .howto ul { padding-left: 20px; font-size: 16px; line-height: 1.5; display: flex; flex-direction: column; gap: 8px; margin: 4px 0; }
  .logbox { width: min(820px, 100%); --band: linear-gradient(180deg, #7cc0ff, #2f78cf); }
  .logtext { max-height: 56vh; overflow: auto; text-align: left; font-size: 13px; line-height: 1.4; background: var(--c0); border: var(--bw) solid var(--ink); border-radius: 12px; padding: 12px; white-space: pre-wrap; user-select: text; color: var(--ash); }
  .coach {
    position: fixed; left: 50%; bottom: 230px; transform: translateX(-50%); z-index: 40; width: min(500px, 92vw); box-sizing: border-box;
    background: var(--panel-bg); border: var(--bw) solid var(--ink); border-radius: 18px; padding: 16px 20px;
    box-shadow: 0 6px 0 var(--ink), 0 0 0 4px var(--gold), 0 0 40px rgba(255, 208, 74, 0.4); animation: pop-in 0.4s cubic-bezier(.2, 1.4, .4, 1) both;
  }
  .coach h3 { margin: 2px 0 6px; color: var(--gold); font-size: 22px; }
  .coach p { margin: 0 0 12px; font-size: 16px; line-height: 1.4; color: var(--bone); }
  .coach-step { font-size: 14px; letter-spacing: 2px; color: var(--ash); text-align: right; }
  .coach-actions { display: flex; gap: 10px; justify-content: flex-end; }
  :global(main.game[data-coach="hand"] .scorebar),
  :global(main.game[data-coach="track"] .track),
  :global(main.game[data-coach="dock"] .dock) { outline: 4px solid var(--gold); outline-offset: 5px; border-radius: 16px; animation: coachglow 1.2s ease-in-out infinite; }
  @keyframes coachglow { 50% { outline-color: #fff1c4; box-shadow: 0 0 26px rgba(255, 208, 74, 0.7); } }

  /* telefono: finestre (messe in fondo per vincere sulle regole desktop) */
  @media (max-width: 760px) {
    /* finestre: a tutta larghezza, offerte su due colonne */
    .overlay { padding: 8px; }
    .overlay-box { --pad-x: 12px; --pad-y: 14px; width: 100%; max-height: 96dvh; gap: 10px; }
    .overlay-box h2 { font-size: 21px; padding: 10px 12px 8px; }
    .overlay-box .offers { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .overlay-box .offer, .overlay-box .door { padding: 12px 8px 14px; }
    .overlay-box .offer .tier { font-size: 11px; }
    .offer .icon, .door .icon { font-size: 34px; margin-top: 6px; }
    .offer .label, .door .label { font-size: 16px; }
    .offer .hint, .door .hint { font-size: 13px; }
    .doors { gap: 10px; }
    .door { width: calc(50% - 5px); }
    .door.bag { width: calc(50% - 5px); }
    .menu-box { max-width: 100%; }
    .logo { font-size: 42px; }
  }
</style>
