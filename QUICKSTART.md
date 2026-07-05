# Goblin Revenge — Quickstart

## Installazione e avvio

```bash
# 1. Installa le dipendenze (una volta sola)
npm install

# 2. Avvia il dev server
npm run dev

# 3. Apri http://localhost:5173/ nel browser
```

Dovresti vedere:
- **Pannello nemico** in alto con intento (⚔️/🛡️/☠️/💪)
- **Arena 3D** nel mezzo (canvas bianco > dadi appariranno al tiro)
- **Pannello giocatore** in basso con:
  - Barre HP (verde vs rosso)
  - 4 pulsanti skill (💥/🛡️/☠️/🎲)
  - 5 slot equip (e inventario di oggetti demo)
  - Log di battaglia sopra

## Come giocare (gameplay loop)

1. **Il turno inizia**: il nemico dichiara l'intento nel riquadro in alto
2. **Scegli una skill**:
   - 💥 **Sgancio Brutale**: danno ×1.5 piatto
   - 🛡️ **Scudo del Goblin**: il danno diventa punti scudo temporanei
   - ☠️ **Sputo Acido**: 20% del danno come veleno per 3 turni
   - 🎲 **Tiro Truccato**: danno ×0.5 ma fino a 2 dadi rilanciabili
3. **I dadi vengono lanciati**: vedi l'animazione 3D e i chip colorati
4. **Risoluzione**: il danno viene calcolato e applicato
5. **Il nemico agisce**: soffri danni/veleno/scudo della sua azione
6. **Nuovo turno** oppure fine battaglia (overlay)

## Cosa vedi nella UI

### Chip dei dadi
- **Bianco** `"5"`: danno normale (Fase FLAT)
- **Rosa** `"×2"`: moltiplicatore esponenziale (Fase MULT) ← **crescita rapida!**
- **Verde** `"+STR 3"`: buff permanente
- **Azzurro** `"↻"`: lancio extra ricorsivo

### Equip (5 slot sotto)
- Clicca un oggetto nell'inventario per equipaggiare
- Clicca uno slot pieno per rimuovere
- Ogni oggetto amplifica il danno o altre stat in una fase della pipeline:
  - `💍` Anello: +8 piatto
  - `🔍` Lente: ×1.25 moltiplicatore
  - `🗿` Idolo: ×1.5 moltiplicatore (combina con i dadi!)

### Fine battaglia
- **Vittoria**: il nemico successivo avrà 1.6× HP (curva esponenziale)
- **Sconfitta**: retry l'Atto attuale

## Architettura tecnica (per lo sviluppo)

```
src/core/         # Logica pura (engine, dadi, pipeline danno)
src/graphics/     # Three.js + Cannon-es (dadi 3D)
src/ui/           # Svelte HUD + store
src/GameManager.ts # Collante: engine ↔ 3D ↔ UI
tests/            # Unit test (22 verdi)
```

## Comandi utili

```bash
npm test          # Esegui i 22 test
npm run build     # Build di produzione (dist/)
npm run dev       # Dev server hot-reload
npx tsc --noEmit  # Typecheck strict
```

## Note di design (dalla specifica)

- **Dopamine Cap** a 30 dadi: se la catena ricorsiva esplode, il danno viene × `1.5^(dadi pendenti)`
- **Pipeline a 3 fasi immutabili**: FLAT → MULT → skillMod (l'ordine è fissato per la crescita esponenziale)
- **5 slot equipaggiamento**: al sesto oggetto il giocatore deve sceglierne uno da scartare
- **Curva difficoltà**: nemici crescono di 1.6^level, costi shop di 1.5^level (pacing bilanciato)
- **Intenti deterministici**: il nemico dichiara l'azione prima, nessuna sorpresa RNG

## Troubleshooting

**"Vedo una pagina bianca"**
- Apri la console (F12) e controlla per errori
- Se vedi `Failed to fetch dynamically imported module`, riavvia con `npm run dev`

**"I dadi non vengono lanciati"**
- Controlla che il canvas sia visibile (sfondo bianco nell'arena)
- Verifica che il browser supporti WebGL (prova in Chrome/Firefox recenti)

**"Il gioco va lento"**
- Apri DevTools > Performance e profila
- I dadi 3D usano Cannon-es physics; su macchine lente potrebbe stuttare

---

Buon divertimento con il Goblin! 👺
