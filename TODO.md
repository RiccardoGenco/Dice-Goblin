# Goblin Revenge — Checklist del lavoro rimanente

Stato attuale: MVP giocabile (20 commit, 37 test verdi). Fatto: motore core, pipeline esponenziale, dadi 3D guidati, HUD Svelte, run 3 Atti con Campione/Boss ogni 5 incontri, Shop + Mercante Reale, salvataggio e sblocchi permanenti.

Legenda: 🔴 gameplay core mancante · 🟡 meta/UX · 🟢 polish · 🔵 tecnico

---

## 🔴 Gameplay core (bloccanti per il flusso completo delle specs)

- [x] **Forgia dei Dadi** (`src/core/Forge.ts` + test) — game_flow_specs §9
  - [x] Tempra: NORMAL ×1.5 (floor), MULTIPLIER +0.5
  - [x] Trasmutazione: cambio tipo faccia, **cap 3 facce non-NORMAL per dado**
  - [x] Fusione: sacrifica un dado, un altro eredita la faccia migliore e sale di rarità
  - [x] Limite 2 operazioni per visita, anteprima prima/dopo, `redrawFace()` sulle texture
- [x] **Gran Forgia** (variante speciale post-boss) — specs §9.bis
  - [x] 3 operazioni invece di 2
  - [x] Trasmutazione a costo dimezzato (base 45)
  - [x] Riforgiatura esclusiva: tutte le facce NORMAL di un dado ×1.25
- [x] **Bivio INTERMISSION** (due porte, se ne sceglie una) — specs §7
  - [x] Bivio speciale con porte dorate dopo il Campione — specs §7.bis
- [ ] **HP persistenti tra gli incontri** — prerequisito della "cura completa"
  - Oggi ogni battaglia riparte a HP pieni: la tensione roguelike non esiste
  - [ ] Salvare `hp` corrente in `SavedRun` (v2) e passarlo al `BattleEngine`
  - [ ] Cura completa SOLO in ACT_TRANSITION (unico heal del gioco) — specs §10
- [ ] **ACT_TRANSITION completa** — specs §10
  - [x] Sequenza: sblocco → Mercante Reale → Gran Forgia → nuovo Atto
  - [ ] Cura completa (dipende dagli HP persistenti qui sopra)

## 🟡 Meta e UX (dalle specs, non bloccanti per giocare)

- [ ] **GameFlow.ts**: FSM di alto livello esplicita (oggi il flusso è implicito in GameManager) — specs §0
- [ ] **Setup Run in 2 passi**: Dote (dado) + Corredo (draft equip 1-di-3) — ux_specs §3
- [ ] **Menu di Pausa** stato-consapevole (⏸/ESC ovunque, Salva-ed-esci vs Abbandona) — ux_specs §4
- [ ] **Opzioni persistenti** (velocità animazioni ×1/×2/istantanea, volumi, formato numeri) — ux_specs §11
- [ ] **MAIN_MENU**: Continua / Nuova Run (con conferma sovrascrittura) / Collezione / Opzioni — specs §2
- [ ] **Collezione**: pool dadi con sbloccati evidenziati e silhouette dei mancanti
- [ ] **Oggetti equip a pagamento**: spostarli nello shop (oggi gratuiti nella HUD) — specs §8.3
  - [ ] Con 5 slot pieni l'acquisto chiede quale oggetto scartare
- [ ] **RunStats + RECAP**: danno max in un turno, overflow count, oro raccolto/speso, op. di forgia — specs §11
- [ ] **SavedRun v2**: hp corrente, runStats, stato intermezzo (offerte/operazioni residue) — retro-compatibile via `version`
- [ ] **ENCOUNTER_INTRO**: presentazione nemico skippabile, nomi propri per i boss — specs §4

## 🟢 Polish

- [ ] FX: glow shader per rarità dei dadi, particellari sull'impatto, screen-shake sull'overflow
- [ ] Fase Glitch UI dell'overflow più ricca (flash, testi vibranti) — GDD §3.3
- [ ] Audio: SFX lanci/rimbalzi/impatti, musica adattiva (normale vs boss)
- [ ] Sprite/SVG dei nemici (oggi solo testo) e varianti visive per Campione/Boss
- [ ] Reroll visivo: rilanciare SOLO i dadi scelti (oggi si rilanciano tutti)
- [ ] Chip dei lanci ricorsivi extra: feedback visivo dedicato (oggi non hanno dado 3D corrispondente)
- [ ] Responsive mobile (layout HUD e canvas)

## 🔵 Tecnico e rilascio

- [x] Bilanciamento: prima passata con balance sim (curve ritarate, vedi balance_specs.md)
- [ ] Bilanciamento: playtest umano di conferma (il bot non usa equip né skill)
- [ ] Sink per l'oro di fine run (rilanci offerte, riforgiature ripetibili)
- [ ] Test d'integrazione del flusso completo (vittoria → shop → incontro → boss → sblocco)
- [ ] Code splitting del bundle (warning Vite: chunk > 500KB, separare three/cannon)
- [ ] QA manuale browser: checklist su Chrome/Firefox/Safari (WebGL, localStorage, resize)
- [ ] Deploy: build statica su GitHub Pages o itch.io
- [ ] CI minimale: `tsc --noEmit` + `vitest run` su push

---

## Ordine consigliato (prossimi commit)

1. ~~**16** — Forge.ts + test~~ ✅
2. ~~**17** — Bivio Intermission + Gran Forgia + UI forgia~~ ✅
3. **18** — HP persistenti + cura ai boss + pozioni (Grog/Elisir) + SavedRun v2 (con stato intermezzo)
4. **19** — MAIN_MENU (3 stati) + Setup Run (Dote + Corredo) + Collezione
5. **20** — Menu di Pausa + Opzioni persistenti + ESC handling
6. **21** — RECAP + RunStats + celebrazioni skippabili
7. **22+** — Polish del turno (anteprima danno, toast oro), FX, audio, mobile, deploy
