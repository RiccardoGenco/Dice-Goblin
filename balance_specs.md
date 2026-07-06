# Specifica di Bilanciamento: Economia, Curve e Pozioni

Questo documento raccoglie la fase di riflessione sul bilanciamento di *Goblin Revenge*: il metodo usato (simulazione Monte Carlo con il motore reale), i problemi trovati nella curva originale, le decisioni prese con i numeri finali, e il design delle pozioni di cura.

---

## 1. Metodo: la Balance Sim

Anziché bilanciare a intuito, è stato scritto un **simulatore della run completa** (`tests/balance.test.ts`) che usa le classi reali del gioco (GoblinDie, DamagePipeline, RunManager, Forge, formule dello Shop) e gioca 30 incontri con un bot "greedy":

*   **Forgia** (priorità): trasmuta NORMAL→MULTIPLIER sotto il cap, altrimenti tempra la ×MULT più alta;
*   **Shop**: fino a 4 acquisti di +30% STR e 2 di +25% VIT per visita, finché l'oro basta;
*   **Boss fight**: usa gli intermezzi speciali (sconti, 3 operazioni).

Il danno per turno è campionato con Monte Carlo (250 lanci reali per incontro, catena ricorsiva e Dopamine Cap inclusi). Metriche: **TTK** (turni per uccidere il nemico), **pressione HP** (% degli HP del giocatore persi nella battaglia se non si difende mai), oro residuo e facce ×MULT accumulate.

**Limiti dichiarati del bot**: non equipaggia oggetti (~×2 di danno con 5 slot pieni) e non usa le skill (Scudo, Tiro Truccato). I TTK reali di un giocatore competente sono quindi **circa la metà** di quelli riportati. Il simulatore resta nel repository come **test di regressione**: se un futuro tuning rompe la curva, la CI fallisce.

---

## 2. La curva originale era rotta (dati)

Con i valori pre-tuning (HP nemici ×1.6/incontro, costi ×1.5, inflazione acquisti ×1.25, Trasmutazione base 90):

| Livello | TTK bot | Diagnosi |
| :--- | :--- | :--- |
| 4 (Campione 1) | 13 | già un muro |
| 9 (Boss 1) | **174** | soft-lock di fatto |
| 29 (Boss 3) | **1.774.223** | assurdo |

Tre cause misurate:

1.  **L'inflazione ×1.25 per acquisto, composta per sempre**: ~60 acquisti in una run = prezzi ×640.000. Il potere d'acquisto *diminuiva* nel tempo — l'opposto del feel incrementale.
2.  **Trasmutazione a base 90** = 9 incontri di reddito per un'operazione: la leva esponenziale del giocatore (facce ×MULT) non partiva mai (il bot chiudeva la run con le stesse 2 facce ×MULT iniziali).
3.  **HP nemici ×1.6 per incontro su 30 incontri = ×830.000 totale**, irraggiungibile per leve del giocatore a base ~1.3 per acquisto.

---

## 3. Decisioni e valori finali

Quattro iterazioni di tuning misurate (i set intermedi e i loro esiti sono nella cronologia git). Valori finali:

| Costante | Prima | **Dopo** | Razionale |
| :--- | :--- | :--- | :--- |
| `ENEMY_HP_GROWTH` | 1.6 | **1.38** | ×11.400 su 29 livelli: raggiungibile da build STR+MULT ben giocate |
| `ENEMY_STR_GROWTH` | =HP (1.6) | **1.22** (nuova) | La difesa ha meno leve dell'attacco: la pressione cresce più piano degli HP |
| `SHOP_COST_GROWTH` | 1.5 | **1.28** | Sotto il reddito (1.5): il potere d'acquisto CRESCE lungo la run (feel incrementale) |
| `GOLD_REWARD_GROWTH` | =costi | **1.5** (nuova) | Separata dai costi; il tentativo a 1.45 strozzava la metà run (misurato) |
| `GOLD_REWARD_BASE` | 10 | **12** | Un incontro ≈ metà di un potenziamento base |
| `PURCHASE_INFLATION` | 1.25 | **1.05** | Anti-accumulo gentile: ×18 a fine run invece di ×640.000 |
| Trasmutazione (base) | 90 | **40** (Gran Forgia: 20) | La leva esponenziale deve partire nell'Atto 1 |
| Valore faccia trasmutata | ×1.5 | **×2** | A ×1.5 il guadagno atteso per faccia era +15%: troppo debole per inseguire 1.38 |
| `CHAMPION_STAT_MULT` | 1.8 | **1.7** | Muro percepibile ma non letale al primo Campione |
| `BOSS_STAT_MULT` | 2.5 | **2.2** | Boss 1 restava un TTK-21+ anche con build decente |

### La curva finale (bot senza equipaggiamento)

```
Lvl   0-3: TTK 2-3    (onboarding)          Campione 1 (lv4):  TTK  7
Lvl  5-8: TTK 4-7    (prima rampa)          Boss 1     (lv9):  TTK 23  ← il muro-esame
Lvl 10-13: TTK 6-10                          Campione 2 (lv14): TTK 25
Lvl 15-18: TTK 8-10   (build online)         Boss 2     (lv19): TTK 19
Lvl 20-23: TTK 4-5    (power fantasy)        Campione 3 (lv24): TTK 10
Lvl 25-28: TTK 4-5                           Boss 3     (lv29): TTK 10
```

Con l'equipaggiamento reale (÷~2): normali 1-5, boss 5-12. La forma è quella giusta per un incrementale: **difficoltà front-loaded** (Boss 1 e Campione 2 sono gli esami della build) che si scioglie nella power fantasy dell'Atto 3, dove i moltiplicatori composti prendono il sopravvento. Facce ×MULT del bot: 2 → 14 lungo la run (la leva esponenziale decolla, requisito verificato dal test di regressione).

### Eccesso d'oro nel finale

Il bot chiude con ~950k d'oro non spendibile (le trasmutazioni sono esaurite dal cap, resta solo la tempra). È accettabile per l'MVP — a build completa l'oro è punteggio — ma è annotato come **sink futuro**: rilanci di offerte a pagamento, riforgiature ripetibili, cosmetici.

---

## 4. Pozioni di Cura

### Il dato che le motiva
La "pressione HP" del bot (danno atteso subito senza mai difendersi) supera il 100% degli HP già a metà Atto 1 e resta alta per tutta la run. Le contromisure esistenti sono lo **Scudo del Goblin** (che converte un intero turno di danno in scudo — a fine run copre qualunque colpo, ma costa il turno) e gli acquisti di VIT. Manca una valvola per il **logorio tra un incontro e l'altro**, che diventerà reale con gli **HP persistenti** (commit 18).

### Opzioni Valutate
*   **Opzione A (Nessuna pozione)**: solo Scudo + cura ai boss. Il logorio si accumula senza rimedio: una battaglia giocata male condanna le tre successive.
*   **Opzione B (Pozioni consumabili in slot)**: oggetti da portare in battaglia. Richiede inventario consumabili, nuova UI, decisioni di timing in combattimento. Ricco ma fuori scope MVP.
*   **Opzione C (Cura istantanea nello shop - SCELTA)**: la pozione si beve al banco: acquisto = cura immediata, nessun inventario.

### Soluzione Scelta (Opzione C)

| Pozione | Dove | Effetto | Costo base | Limite |
| :--- | :--- | :--- | :--- | :--- |
| 🍺 **Grog del Goblin** | Mercante normale | Ripristina il **40%** degli HP massimi | 15 (curva 1.28^lv) | max 1 per visita |
| 🧪 **Elisir Reale** | Solo Mercante Reale | Ripristina il **100%** | 35 (scontato 30% come tutto il Reale) | max 1 per visita |

Regole di design:
*   L'offerta compare **solo se** gli HP non sono già pieni (niente offerte morte).
*   Il limite 1-per-visita impedisce di trasformare l'oro in immortalità: curarsi costa *visite* (cioè bivi spesi sul Mercante anziché sulla Forgia), non solo oro. Il bivio Shop/Forgia acquista così una dimensione in più: *ho bisogno di curarmi o di crescere?*
*   La **cura completa gratuita** resta esclusiva dell'ACT_TRANSITION (dopo i Boss d'Atto): i boss rimangono il traguardo-respiro della run.
*   Implementazione: nel **commit 18**, insieme agli HP persistenti (le pozioni non hanno senso prima).

---

## 5. Riepilogo delle curve (stato finale)

```
Reddito/incontro:   12 × 1.5^lv   (Campione ×2, Boss ×3)
Costi shop/forgia:  base × 1.28^lv × 1.05^acquisti   (Reale/Gran Forgia: sconti)
HP nemici:          80 × 1.38^lv × (1.7 Campione | 2.2 Boss)
STR nemica:         3 × 1.22^lv × (1.7 | 2.2)
Leve del giocatore: STR ×1.3/acquisto (lineare) · facce ×2 trasmutate (esponenziale,
                    cap 3/dado) · tempra +0.5 su ×MULT · equip (fino a ~×2)
```

Guardrail automatici in `tests/balance.test.ts`: TTK del bot mai > 25; almeno 10 facce ×MULT a fine run. Ogni futura modifica alle costanti deve passare da lì.
