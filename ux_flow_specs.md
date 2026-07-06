# Specifica UX: L'Esperienza Utente Passo per Passo

Questo documento definisce **l'esperienza dell'utente** in *Goblin Revenge*, schermata per schermata e click per click. Complementa `game_flow_specs.md` (che definisce *gli stati*) descrivendo *cosa vede, cosa può fare e cosa prova* il giocatore in ogni momento, inclusi menu di pausa, setup iniziale della run e regole trasversali di interazione.

---

## 0. Principi Guida della UX

1. **Mai perdere progresso**: ogni azione significativa è autosalvata; chiudere il browser in qualsiasi momento non costa mai più dell'animazione in corso.
2. **Il turno è sacro, il resto è skippabile**: le decisioni di gioco richiedono attenzione; tutto il contorno (intro, celebrazioni, animazioni) si salta con un tap.
3. **Decisioni brevi e frequenti**: nessuna schermata di scelta deve richiedere più di ~30 secondi; se serve più tempo, l'informazione è presentata male.
4. **Ogni rifiuto ha un perché**: un pulsante disabilitato mostra sempre il motivo nel tooltip (oro insufficiente, cap raggiunto, operazioni esaurite).
5. **Un'unica azione primaria per schermata**: il pulsante "avanti" (⚔️ Prossimo incontro, ➡️ Continua) è sempre uno, sempre nello stesso punto (in basso, centrato).

---

## 1. Primo Avvio e Boot

| Passo | Cosa vede l'utente | Durata target |
| :--- | :--- | :--- |
| 1.1 | Schermata nera con logo 👺 *Goblin Revenge* | immediata |
| 1.2 | Barra di caricamento SOLO se il boot supera 500ms (asset 3D, texture) | < 2s |
| 1.3 | Transizione al Menu Principale (fade 300ms) | — |

Durante il boot: `loadUnlocks()`, `hasRun()`, warm-up della scena Three.js. Nessun input possibile, nessuna scelta.

---

## 2. Menu Principale

Il menu ha **tre stati** in base alla situazione del giocatore:

```
┌──────────────────────────────────┐
│         👺 GOBLIN REVENGE        │
│                                  │
│   ▶️  CONTINUA   (Atto 2 — 4/10) │   ← solo se c'è una run salvata
│   🔄  NUOVA RUN                  │
│   🎲  COLLEZIONE      (2/3 🔓)   │
│   ⚙️  OPZIONI                    │
│                                  │
│   v0.1 — 45 test verdi 🧪        │
└──────────────────────────────────┘
```

*   **Stato "prima volta"** (nessuna meta, nessuna run): solo `NUOVA RUN` è evidenziato (pulsante grande); Collezione mostra "0/3" e Opzioni è in secondo piano. Niente tutorial: il gioco si spiega con i tooltip contestuali della prima battaglia (vedi §5.8).
*   **Stato "run in corso"**: `CONTINUA` è la voce primaria, con il riassunto della run accanto (Atto, incontro, oro). `NUOVA RUN` chiede conferma: *"C'è una run in corso (Atto 2 — 4/10). Abbandonarla per sempre?"* con doppio pulsante [Abbandona] / [Torna indietro].
*   **Stato "veterano"** (meta presente, nessuna run): come "prima volta" ma la Collezione mostra i progressi ed è visivamente più ricca.

**Collezione** (da qui e solo da qui): griglia dei dadi del pool. Sbloccati = a colori con le 6 facce visibili; non sbloccati = silhouette scura con l'indicazione *"Sconfiggi il Boss dell'Atto N"*. Nessuna azione oltre alla consultazione; pulsante [← Indietro].

---

## 3. Setup della Nuova Run

Il setup avviene in **due passi rapidi** su un'unica sequenza di schermate. Obiettivo: dare identità alla run in meno di 30 secondi.

### Passo 1 — La Dote (scelta del dado)
Compare **solo se** la Collezione ha almeno 1 dado sbloccato.

```
┌──────────────────────────────────┐
│   Scegli la tua DOTE (6° dado)   │
│                                  │
│  [🟡 Dorato]  [🌀 Ricorsivo]  [Nessuna] │
│   2 facce ×    3 facce ↻      solo i 5  │
│                                  base   │
└──────────────────────────────────┘
```

Ogni carta-dado mostra le 6 facce in anteprima. La scelta "Nessuna dote" esiste per chi vuole la sfida pura (e per coerenza col primo avvio).

### Passo 2 — Il Corredo (equipaggiamento iniziale)

#### Opzioni Valutate
*   **Opzione A (Nessun equip iniziale)**: si parte a slot vuoti (stato attuale). Le prime battaglie sono piatte e uguali tra loro.
*   **Opzione B (Draft 1-di-3 - SCELTA)**: vengono pescati 3 oggetti casuali dal catalogo; il giocatore ne sceglie **uno** che parte già equipaggiato.
*   **Opzione C (Loadout di classe)**: set fissi predefiniti. Richiede il sistema classi, fuori scope MVP.

#### Soluzione Scelta (Opzione B)
Il draft 1-di-3 dà a ogni run una direzione di build fin dal primo incontro (parto flat? parto moltiplicativo?) con una sola decisione, ed è lo standard del genere (le reliquie iniziali di *Slay the Spire*). Gli altri oggetti restano acquistabili nello shop.

```
┌──────────────────────────────────┐
│   Scegli il tuo CORREDO (1 di 3) │
│                                  │
│  [💍 Anello]  [🔍 Lente]  [🗿 Idolo] │
│   +8 flat      ×1.25        ×1.5     │
│   (PRE_ADD)    (MULT)       (MULT)   │
└──────────────────────────────────┘
```

Al termine: autosave della run fresca → `ENCOUNTER_INTRO` del primo incontro. **Nessun passo 3**: due decisioni bastano.

---

## 4. Il Menu di Pausa

### Opzioni Valutate (dove è accessibile)
*   **Opzione A (Solo in battaglia)**: incoerente — il giocatore si aspetta la pausa ovunque.
*   **Opzione B (Ovunque, stato-consapevole - SCELTA)**: il pulsante ⏸ (angolo alto-destra della runbar) e il tasto `ESC` aprono la pausa in **qualsiasi fase**; le voci si adattano al contesto.

### Soluzione Scelta (Opzione B)

```
┌──────────────────────────────────┐
│            ⏸  PAUSA              │
│                                  │
│   ▶️  Riprendi                   │
│   ⚙️  Opzioni                    │
│   📖  Come si gioca  (riassunto) │
│   🏠  Salva ed esci al Menu      │
│   💀  Abbandona la Run           │
└──────────────────────────────────┘
```

Regole di comportamento:

1.  **Il gioco è a turni: la pausa non congela la fisica.** Se i dadi 3D sono in volo, l'overlay si apre sopra e il lancio si completa sotto; la logica era comunque in attesa del `waitUntilFinished`. Nessuno stato può corrompersi: la pausa **blocca solo l'input di gioco**.
2.  **🏠 Salva ed esci** (voce "sicura"): forza un autosave e torna al Menu Principale. La run resta al punto esatto (grazie ai punti di autosave, al rientro si riparte dall'inizio dell'incontro corrente — il turno a metà non si salva, ed è accettato: si perde al massimo un turno, mai un incontro).
3.  **💀 Abbandona la Run** (voce distruttiva, in rosso, in fondo): doppia conferma — *"La run andrà persa per sempre. Gli sblocchi della Collezione restano."* → cancella `RUN_KEY` → Menu.
4.  **📖 Come si gioca**: una singola schermata statica con il loop in 4 righe (lancia → scegli skill → il nemico agisce → tra un incontro e l'altro potenzia). Non un tutorial: un promemoria.
5.  `ESC` chiude la pausa se aperta (toggle). Durante gli overlay di scelta (Bivio, Shop, Forgia) `ESC` apre comunque la pausa **sopra** l'overlay corrente.

---

## 5. L'Incontro, Passo per Passo (l'esperienza del turno)

La timeline percepita dal giocatore, con i tempi target:

| # | Momento | Cosa vede / fa | Timing |
| :--- | :--- | :--- | :--- |
| 5.1 | **Intro incontro** | Il nemico appare (slide-in 400ms) con nome e barra HP; skippabile con tap | < 2s |
| 5.2 | **Intento dichiarato** | Il riquadro intento pulsa una volta (⚔️ Attacco: 25). *Prima* informazione, *poi* azione | 0.4s |
| 5.3 | **Lancio automatico** | I dadi rotolano nell'arena 3D; i chip compaiono uno a uno sotto l'arena man mano che i dadi si fermano | ~1.2s |
| 5.4 | **(Eventuale) Overflow** | Glitch: flash, "⚠️ OVERFLOW", screen-shake; il numero finale appare ingigantito | 0.8s |
| 5.5 | **Decisione** | Le 4 skill si illuminano; il gioco ATTENDE senza timer. Hover/long-press su una skill = anteprima del danno stimato | ∞ |
| 5.6 | **(Se Tiro Truccato)** | I chip diventano selezionabili (max 2), contatore "1/2", [✔ Conferma] / [✖ Annulla]; i dadi scelti si rilanciano | +1.2s |
| 5.7 | **Risoluzione** | Numero di danno fluttuante sul nemico (scala col logaritmo del valore), barra HP che scende con easing; poi l'intento nemico si esegue sul Goblin | 0.9s |
| 5.8 | **Ritorno a 5.2** | Nuovo intento. Al **primo incontro assoluto** della prima run, tre tooltip una-tantum: sull'intento ("Il nemico dichiara sempre la prossima mossa"), sui chip ("Le facce ×N moltiplicano il danno"), sulle skill ("Scegli come usare il lancio") | — |

Regole della fase:
*   **Velocità animazioni** (da Opzioni): ×1 / ×2 / istantanea. "Istantanea" salta il 3D e mostra solo i chip — per i veterani delle run lunghe.
*   Durante 5.3-5.4 e 5.7 **l'input è disabilitato** ma la pausa resta accessibile.
*   La barra HP nemica mostra un *ghost* del danno previsto quando si fa hover su una skill (anteprima non vincolante, calcolata con la pipeline reale).

---

## 6. Il Bivio (dopo ogni vittoria normale)

1. Il nemico sconfitto dissolve; toast "💰 +N oro" vola verso il contatore della runbar (600ms).
2. Overlay del Bivio: **due porte**, oro visibile, eventuale banner sblocco sopra.
3. Hover su una porta = la porta si apre leggermente e mostra il sottotitolo; l'altra si scurisce.
4. Click = la porta scelta si spalanca (300ms), l'altra si chiude con un tonfo. **Nessun ripensamento**: niente pulsante indietro, per design.
5. Dopo il Campione: stesse identiche interazioni, ma porte dorate e titolo "✨ Bivio Dorato" — il giocatore capisce *visivamente* che la posta è più alta.

---

## 7. Lo Shop, Passo per Passo

1. Il Mercante appare con le 3-4 offerte in colonna; l'oro è sempre visibile in alto.
2. Ogni offerta è un pulsante-carta: icona, nome, descrizione, prezzo. Non affordabile = opaca, prezzo in rosso, tooltip *"Ti servono altri N oro"*.
3. Click su un'offerta = acquisto **immediato** (niente doppia conferma: i prezzi sono noti e l'errore costa poco), la carta sparisce con un pop, l'oro scala con animazione contatore.
4. Acquisto di un oggetto equip a **slot pieni**: si apre il sotto-pannello *"Quale oggetto scarti?"* con i 5 slot cliccabili; [Annulla] rimborsa.
5. Il Mercante Reale: stessa struttura, bordo dorato, riga "Prezzi scontati del 30%", offerta 💎 in cima.
6. Unica uscita: [⚔️ Prossimo incontro] in basso. Se ci sono offerte ancora affordabili, il pulsante mostra un piccolo badge "!" (nudge gentile, nessun blocco).

---

## 8. La Forgia, Passo per Passo

Il flusso è **a imbuto**: dado → faccia → servizio → conferma implicita.

1. Entrata: la griglia dei dadi della borsa (D1..Dn con rarità e nome). Contatore operazioni ben visibile: "Operazioni: 2".
2. **Click su un dado** → sotto compaiono le sue 6 facce come chip; il dado resta evidenziato.
3. **Click su una faccia** → i servizi si attivano con costi e anteprima *prima → dopo* (es. "7 → 10"). I servizi non validi restano visibili ma spenti col motivo nel tooltip (*"Cap raggiunto: max 3 facce speciali"*).
4. **Click su un servizio** = esecuzione immediata: la faccia-chip si aggiorna con un flash, l'oro scala, il contatore operazioni decrementa. La *stessa* faccia resta selezionata (per confrontare il risultato).
5. **Fusione** (flusso a due click): click su ⚒️ Fusione → i *altri* dadi pulsano in rosso col messaggio "Scegli il dado da SACRIFICARE" → click sul sacrificio = fusione eseguita, la griglia si ricompone. `ESC` o ri-click su Fusione annulla la modalità.
6. A operazioni esaurite: tutti i servizi si spengono, resta solo [⚔️ Prossimo incontro].
7. Gran Forgia: bordo infuocato, "Operazioni: 3", servizio 🌋 Riforgiatura in più, prezzo Trasmutazione barrato col -50%.

---

## 9. Boss, Transizione d'Atto e Celebrazioni

1. **Intro boss**: nome proprio a lettere grandi (es. *"SIR BALDOVINO IL MOLESTO"*), stinger visivo 800ms, skippabile.
2. **Vittoria sul Campione**: toast oro ×2 → Bivio Dorato.
3. **Vittoria sul Boss d'Atto**, in sequenza (ognuna skippabile con tap):
   a. Toast oro ×3;
   b. **Celebrazione sblocco** (solo prima volta): il nuovo dado ruota al centro schermo mostrando le facce, "🔓 Aggiunto alla Collezione per sempre" — 2s;
   c. Mercante Reale → Gran Forgia (catena §game_flow §10);
   d. Cartello "ATTO 2" a schermo pieno (800ms) → primo incontro del nuovo Atto.

---

## 10. Fine Run e Recap

*   **Sconfitta**: schermo si desatura (500ms), "💀 Run terminata", poi il RECAP.
*   **Vittoria** (3° boss): esplosione dorata, "👑 RUN COMPLETATA", poi il RECAP.
*   **RECAP** (stessa schermata per entrambi, tono diverso):

```
┌──────────────────────────────────┐
│         📊 LA TUA RUN            │
│  Atto raggiunto        2 — 7/10  │
│  Danno max in un turno  4.2e8 💥 │
│  Overflow innescati          3 ⚠️│
│  Oro raccolto / speso  1240/1180 │
│  Operazioni di forgia          5 │
│                                  │
│   [🔄 Nuova Run]   [🏠 Menu]     │
└──────────────────────────────────┘
```

Il "danno max" è la statistica-trofeo: è il numero che il giocatore vorrà battere (e screenshottare).

---

## 11. Opzioni

Accessibili dal Menu e dalla Pausa (stessa schermata):

| Opzione | Valori | Default |
| :--- | :--- | :--- |
| Velocità animazioni dadi | ×1 / ×2 / Istantanea | ×1 |
| Volume effetti | 0-100 | 80 |
| Volume musica | 0-100 | 60 |
| Numeri | Compatti (1.5e9) / Estesi | Compatti |
| Reset Collezione | pulsante rosso, doppia conferma | — |

Le opzioni sono salvate in una terza chiave storage (`goblin-revenge:options`), fuori da run e meta.

---

## 12. Regole Trasversali

*   **Conferme distruttive** (sempre a due passi, col costo esplicitato): Nuova Run con run in corso, Abbandona Run, Reset Collezione. Tutto il resto è a un click.
*   **Chiusura browser**: in qualsiasi momento; al rientro si riprende dall'inizio dell'incontro corrente o dall'overlay (Bivio/Shop/Forgia) in cui ci si trovava — lo stato dell'intermezzo (operazioni residue, offerte) fa parte del salvataggio v2.
*   **`ESC`**: chiude il livello UI più alto (modalità fusione → pausa → nulla). Mai un'azione distruttiva.
*   **Idle**: nessun timeout, nessuna penalità. Il gioco aspetta.
*   **Numeri**: sempre `formatBigNumber`; i tooltip mostrano il valore esteso.

---

## 13. Mappa Input per Fase

| Fase | Azioni disponibili | Azione primaria |
| :--- | :--- | :--- |
| MAIN_MENU | Continua, Nuova Run, Collezione, Opzioni | Continua / Nuova Run |
| SETUP (dote/corredo) | Scelta carta, Nessuna dote | Scelta carta |
| BATTLE 5.5 | 4 skill, hover anteprima, ⏸ | Skill |
| BATTLE reroll | Toggle chip (max 2), Conferma, Annulla, ⏸ | Conferma |
| CROSSROAD | Porta sx, Porta dx, ⏸ | — (scelta paritaria) |
| SHOP | Acquista offerta ×N, scarto slot, Prossimo incontro, ⏸ | Prossimo incontro |
| FORGE | Dado → Faccia → Servizio, Fusione 2-click, Prossimo incontro, ⏸ | Prossimo incontro |
| RECAP | Nuova Run, Menu | Nuova Run |
| PAUSA | Riprendi, Opzioni, Come si gioca, Salva/Esci, Abbandona | Riprendi |

---

## 14. Impatti sull'Implementazione (roadmap aggiornata)

| Commit | Contenuto UX | Note |
| :--- | :--- | :--- |
| 18 | HP persistenti + SavedRun v2 (include stato intermezzo e RunStats) | prerequisito di §12 |
| 19 | MAIN_MENU (3 stati) + schermate SETUP (Dote + Corredo 1-di-3) + Collezione | §2, §3 |
| 20 | Menu di Pausa stato-consapevole + Opzioni persistenti + ESC handling | §4, §11 |
| 21 | RECAP + RunStats + celebrazioni skippabili (sblocco, cartello Atto) | §9, §10 |
| 22 | Polish del turno: anteprima danno on-hover, ghost HP, toast oro, velocità animazioni | §5 |

Ordine pensato per il valore: prima ciò che protegge il progresso (18), poi l'ossatura delle schermate (19-20), infine la ciccia celebrativa (21-22).
