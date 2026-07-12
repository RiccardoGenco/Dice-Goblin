# Specifica dei Contenuti: Nemici, Boss, Oggetti e Soluzioni ai Punti Aperti

Questo documento stabilisce **una soluzione per ogni punto mancante** identificato nella revisione del progetto, con al centro il sistema delle **6 classi nemiche** e l'espansione dei contenuti (boss, oggetti, dadi). Chiude il quadro di design dell'MVP esteso.

---

## 1. Il Sistema delle Classi Nemiche

### 1.1 Principio

Sei classi — **Guerriero, Mago, Paladino, Chierico, Bardo, Ladro** — ognuna con:
1.  **Moltiplicatori di classe** sulle statistiche base, con **varianza casuale** per incontro;
2.  **Pattern d'intenti caratteristico**: uno script deterministico e ciclico di mosse;
3.  **Mosse peculiari** che introducono nuovi tipi di intento.

### 1.2 Generazione delle statistiche

```
stat = base × crescita^level × moltClasse × variance × (moltBoss)
       dove variance ~ Uniform(0.85, 1.15) per stat, seedata sull'incontro
```

| Classe | STR | VIT | INT | Identità tattica |
| :--- | :---: | :---: | :---: | :--- |
| ⚔️ **Guerriero** | 1.30 | 1.00 | 0.60 | Aggressione pura, buca gli scudi |
| 🔮 **Mago** | 0.70 | 0.70 | 1.60 | Fragile, ma telegrafa un colpo devastante |
| 🛡️ **Paladino** | 0.80 | 1.50 | 0.80 | Muro di scudi: un check sul DPS |
| ✨ **Chierico** | 0.90 | 1.10 | 1.20 | Si cura: bisogna superare la sua cura |
| 🎵 **Bardo** | 0.80 | 0.90 | 1.30 | Indebolisce il giocatore, vince di logorio |
| 🗡️ **Ladro** | 1.15 | 0.75 | 0.80 | Ruba oro: ucciderlo in fretta paga |

**Vincolo di bilanciamento**: i moltiplicatori sono normalizzati perché la media geometrica per riga sia ≈ 1 — la curva ritarata in `balance_specs.md` resta valida in aggregato. La balance sim andrà estesa per campionare le classi e verificare il guardrail *per classe* (il Paladino è il caso critico sul TTK).

### 1.3 Pattern d'intenti: script deterministici

#### Opzioni Valutate
*   **Opzione A (Mossa casuale pesata)**: sistema attuale. Nessuna identità, nessuna pianificazione a lungo termine per il giocatore.
*   **Opzione B (Script ciclico deterministico - SCELTA)**: ogni classe ha una sequenza fissa di mosse che si ripete, con al massimo **una regola condizionale** per classe.

#### Soluzione Scelta (Opzione B)
Preserva il pilastro degli intenti deterministici (MVP §2) e lo estende: dopo 2-3 turni il giocatore *impara il ritmo della classe* e pianifica su più turni ("il Mago sta caricando: il prossimo turno scudo"). La singola regola condizionale evita la prevedibilità totale senza introdurre caos.

### 1.4 Le mosse per classe (con i nuovi tipi di intento)

| Classe | Script (ciclo) | Mosse peculiari | Regola condizionale |
| :--- | :--- | :--- | :--- |
| ⚔️ Guerriero | Attacco → Attacco → **Spezzascudo** → Furia(BUFF) | `PIERCE`: danno che **ignora gli scudi** | — |
| 🔮 Mago | Dardo → **Incanalare** → **Sfera Arcana** | `CHARGE` (telegrafo, nessun danno) → `BURST`: attacco `INT × 5` | — |
| 🛡️ Paladino | Scudo Sacro → **Colpo Ritorsivo** → Scudo → Castigo | `ATTACK_SHIELD`: attacca E si scuda nello stesso turno | — |
| ✨ Chierico | Martello → **Preghiera** → Martello → Benedizione(BUFF) | `HEAL`: recupera `INT × 4` HP | Preghiera solo se HP < 70%, altrimenti Martello |
| 🎵 Bardo | **Canzone Stonata** → Attacco → **Ballata Velenosa** → Attacco | `DEBUFF`: il danno del giocatore −30% per 2 turni | — |
| 🗡️ Ladro | Pugnalata → **Borseggio** → **Attacco Doppio** → Pugnalata | `STEAL`: ruba oro (scala col level); `MULTI_ATTACK`: 2 colpi da 0.6× (punisce gli scudi piccoli) | Ucciso il Ladro, si recupera il maltolto **+20%** |

Nuovi `IntentType` da implementare: `PIERCE`, `CHARGE`, `BURST`, `ATTACK_SHIELD`, `HEAL`, `DEBUFF`, `STEAL`, `MULTI_ATTACK`. Il debuff del Bardo si applica come moltiplicatore temporaneo in coda alla pipeline (fase `POST_MULT`), con contatore di turni sul giocatore.

Ogni classe insegna una lezione: il Guerriero punisce chi scuda sempre, il Mago insegna il timing dello scudo, il Paladino testa il DPS, il Chierico l'anti-turtle, il Bardo la pazienza, il Ladro la velocità.

---

## 2. Boss e Campioni

*   **Campioni** (5° incontro): una classe **estratta a caso**, stat ×1.7, nome generato dal template *"Campione {aggettivo} — {Classe}"* (es. *"Campione Fetido — Paladino"*). Il pattern resta quello di classe: il Campione è "la classe, ma più cattiva".
*   **Boss d'Atto** (10° incontro): identità fisse, una **meccanica firma** ciascuno, in escalation didattica:

| Atto | Boss | Classe | Meccanica firma |
| :--- | :--- | :--- | :--- |
| 1 | **Sir Baldovino il Molesto** | ⚔️ Guerriero | *Assalto Implacabile*: ogni 3° turno lo Spezzascudo colpisce due volte |
| 2 | **Madre Ildegonda** | ✨ Chierico | *Salmo della Rinascita*: sotto il 50% HP si cura del 25% (una sola volta per battaglia) |
| 3 | **Arcimago Zoltan il Verboso** | 🔮 Mago | *Apocalisse Arcana*: Incanalare dura 2 turni → BURST `INT × 8`. L'esame finale su scudi e burst |

I tre boss testano i tre muscoli della build: sopravvivenza senza scudi (Atto 1), DPS oltre la cura (Atto 2), gestione del turno chiave (Atto 3).

---

## 3. Espansione Oggetti (6 → 18)

Dodici nuovi oggetti, distribuiti sulle fasi middleware e con contro-mosse alle classi (le "tech card" della build):

| Oggetto | Fase | Effetto | Note |
| :--- | :--- | :--- | :--- |
| 🥊 Tirapugni Arrugginito | PRE_ADD | +12 flat | — |
| 🍖 Coscia di Troll | PRE_ADD | +5 flat e +10% VIT all'equip | ibrido |
| 🎯 Mirino Sbeccato | ADD | +25 alla mossa | — |
| 🪓 Ascia del Taglialegna | ADD | +40 se il turno non ha facce ×MULT | premia i lanci sfortunati |
| 📗 Manuale del Truffatore | MULT | ×1.2, ×1.4 se hai rilanciato | sinergia Tiro Truccato |
| 🐍 Anello del Serpente | MULT | ×1.35 se il nemico è avvelenato | sinergia Sputo Acido |
| 🎲 Dado Portafortuna | MULT | ×1.1 per ogni faccia ↻ uscita | sinergia ricorsivi |
| 👑 Corona Spezzata | MULT | ×1.5 contro Campioni e Boss | boss-killer |
| 🩸 Zanna Vampirica | POST_MULT | lifesteal 8% del danno | sostentamento (con HP persistenti) |
| ⚗️ Filtro Antimagia | POST_MULT | i `BURST` nemici −40% | contro-Mago/Zoltan |
| ⛪ Lama Profana | POST_MULT | gli `HEAL` nemici −50% | contro-Chierico/Ildegonda |
| 🔒 Borsa Chiodata | POST_MULT | lo `STEAL` del Ladro fallisce | contro-Ladro |

I tre contro-oggetti (Filtro, Lama, Borsa) danno allo shop una dimensione tattica nuova: *comprare in previsione del boss dell'Atto*.

---

## 4. Espansione Pool Dadi (3 → 6) e sblocchi a imprese

Tre nuovi dadi sbloccati da **imprese** (nuova meta oltre ai boss, salvata nella chiave meta):

| Dado | Facce | Impresa di sblocco |
| :--- | :--- | :--- |
| 🩸 **Dado Berserker** | 3× BUFF_STR(3), 3× NORMAL alti | Vinci una run senza mai comprare pozioni |
| 🎲 **Dado del Caos** | NORMAL 1, NORMAL 25, ×4, ↻, ↻, +STR 4 | Innesca 5 overflow in una sola run |
| ⚓ **Dado Piombato** | 6× NORMAL 8-18, nessuna speciale | Uccidi un Boss in ≤ 3 turni |

Le imprese compaiono nella Collezione come obiettivi visibili (silhouette + condizione), moltiplicando le ragioni per "ancora una run".

---

## 5. Soluzioni per gli altri punti aperti (riepilogo decisionale)

| Punto | Soluzione adottata | Dove |
| :--- | :--- | :--- |
| HP persistenti + pozioni | Confermato: commit 18 (Grog 40%, Elisir Reale 100%, cura gratis solo ai Boss) | `balance_specs.md` §4 |
| Menu/Setup/Pausa/Recap | Confermato come da specifica UX (menu 3 stati, Dote+Corredo, pausa stato-consapevole) | `ux_flow_specs.md` |
| Aspetto dei nemici | **SVG procedurali per classe**: icona + palette di classe + cornice (nessuna per i normali, argento per i Campioni, oro per i Boss). Zero asset esterni, coerente con la generazione procedurale del progetto | commit 19-20 |
| Audio | **Web Audio API con SFX sintetizzati** (niente file audio: oscillatori per lanci, impatti, monete, glitch dell'overflow). Musica rimandata al post-MVP | commit 25+ |
| Feel dell'overflow | Screen-shake CSS + flash cromatici + testo vibrante, come da GDD §3.3 | commit 25+ |
| Balance per classe | Estensione della balance sim: campiona le 6 classi, guardrail TTK per classe (Paladino = caso critico) | commit 19 |
| Deploy | GitHub Pages via GitHub Actions; la CI esegue `tsc --noEmit` + `vitest run` + `vite build` a ogni push | commit 26 |
| Bundle 589KB | `manualChunks`: vendor chunk separato per three+cannon-es | commit 26 |
| Mobile | Rimandato al post-release: layout desktop-first, media query solo di sopravvivenza | post-MVP |

---

## 6. Roadmap aggiornata

| Commit | Contenuto |
| :--- | :--- |
| 18 | HP persistenti + pozioni + cura ai Boss + SavedRun v2 |
| 19 | Sistema classi nemiche: 6 classi, nuovi IntentType, pattern script, varianza stat + balance sim per classe |
| 20 | Boss con meccaniche firma + Campioni con classe e nome generato + SVG procedurali nemici |
| 21 | Espansione oggetti (18) + dadi (6) + sblocchi a imprese |
| 22 | Menu principale + Setup run (Dote+Corredo) + Collezione con imprese |
| 23 | Menu di Pausa + Opzioni persistenti + ESC |
| 24 | RECAP + RunStats + celebrazioni |
| 25 | Feel: SFX sintetizzati, glitch overflow, screen-shake, toast |
| 26 | Release: CI, code splitting, QA browser, deploy GitHub Pages |
