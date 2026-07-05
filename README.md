# Goblin Revenge — MVP

Dice Bag Builder roguelike incrementale con scaling esponenziale ispirato alla filosofia dei moltiplicatori di *Balatro*.

## Architettura

Il principio guida è il **disaccoppiamento totale logica/grafica**: `src/core/` è TypeScript puro (nessun import da Three.js, Cannon-es o Svelte) e decide ogni risultato *a monte*. Il layer grafico (Fisica Guidata, Approccio B) si limita a "recitare" i lanci già estratti.

```
goblin-revenge/
├── package.json            # vite, ts, break_infinity.js, three, cannon-es, vitest
├── tsconfig.json           # strict: true + path alias @core/@graphics/@ui
├── vite.config.ts
├── src/
│   ├── core/               # ← MOTORE LOGICO (zero dipendenze grafiche, 100% testabile)
│   │   ├── types.ts        #   Tipi, enum, RNG iniettabile, costanti BALANCE
│   │   ├── GoblinDie.ts    #   Estrazione pesata, LCK attenuata log.
│   │   ├── DamagePipeline.ts # Pipeline 3 fasi + middleware PRE_ADD→ADD→MULT→POST_MULT
│   │   ├── skills.ts       #   Le 4 skill fisse di classe
│   │   ├── BattleEngine.ts #   Macchina a stati, Dopamine Cap, intenti nemici
│   │   └── persistence.ts  #   Hydration dei Decimal dai salvataggi
│   ├── graphics/           # ← MOTORE 3D (Three.js + Cannon-es, Fisica Guidata)
│   │   ├── TextureGenerator.ts # CanvasTexture riutilizzabili (zero leak)
│   │   ├── MagneticPhysics.ts  # Quaternione target + Slerp (yaw libero)
│   │   └── DiceWorld.ts        # Arena fisica 3g, Promise per Visual Blocking
│   ├── ui/                 # ← DOM LAYER (Svelte)
│   │   ├── stores.ts       # Store reattivi: solo viste serializzabili
│   │   └── App.svelte      # HUD, intenti, skill, slot, overlay
│   └── GameManager.ts      # Collante engine ↔ DiceWorld ↔ store
└── tests/                  # Vitest (piano di verifica del GDD)
    ├── damage.test.ts      #   Pipeline moltiplicativa + ordinamento middleware
    ├── engine.test.ts      #   Dopamine Cap, Visual Blocking, curve, hydration
    ├── magnetic.test.ts    #   Determinismo dell'allineamento sui quaternioni
    └── equipment.test.ts   #   Regola 5 slot, indipendenza dall'ordine, format
```

## Dove avviene lo scaling esponenziale

| Punto | File | Meccanismo |
|---|---|---|
| Facce MULTIPLIER | `DamagePipeline.ts` Fase 2 | k facce ×2 → danno × 2^k (composizione moltiplicativa) |
| Dopamine Cap | `BattleEngine.rollDiceChain` | overflow → danno × 1.5^(dadi pendenti) |
| HP nemici | `scaleEnemyHp` | HPbase × 1.6^level |
| Costi shop | `scaleShopCost` | Costbase × 1.5^level (< 1.6 → niente soft-lock) |
| Fortuna | `GoblinDie.roll` | attenuata con ln(1+lck)/ln(1.1) per non rompere la curva |

Tutte le grandezze che scalano usano `Decimal` (break_infinity.js) per superare il limite float di ~1.79e308 — verificato dal test che calcola 2^1200.

## Comandi

```bash
npm install
npm test        # 22 unit test (pipeline, anti-loop, quaternioni, equip)
npm run dev     # gioco completo: HUD Svelte + arena 3D integrate
```

## Roadmap commit

**Fatti (questo repo):**
1. `chore: setup Vite + TypeScript strict + Vitest`
2. `feat(core): tipi base, enum e costanti di bilanciamento`
3. `feat(core): GoblinDie, DamagePipeline e 4 skill fisse`
4. `feat(core): BattleEngine event-driven + persistence hydration`
5. `test(core): pipeline, Dopamine Cap, Visual Blocking, curve`

6. `feat(graphics): TextureGenerator — CanvasTexture dinamiche per faccia`
7. `feat(graphics): MagneticPhysics — allineamento sul quaternione target`
8. `feat(graphics): DiceWorld — arena Three.js + Cannon-es guidata (+ dev harness)`

9. `feat: GameManager + store Svelte, equipaggiamento 5 slot, formatBigNumber`
10. `feat(ui): App.svelte — HUD ibrida completa e integrazione finale`

**Prossimi (meta-progressione):**
11. `feat(meta): struttura ad Atti (10 incontri + boss), sblocchi dadi nel pool`
12. `feat(meta): shop con scaleShopCost, oro e acquisto potenziamenti facce`
13. `feat(meta): salvataggio run su localStorage via persistence.ts`

## Migliorie introdotte rispetto ai documenti di design

- **RNG iniettabile con seed (mulberry32)**: sostituisce `Math.random` hardcoded → test deterministici, replay delle run e futura validazione server-side dei punteggi.
- **Validazione runtime nella hydration**: il JSON dei salvataggi è untrusted; `hydrateDecimal` accetta mantissa/exponent, stringhe e numeri con type-guard espliciti.
- **Costanti BALANCE centralizzate**: MAX_CHAIN, growth rate e HP/VIT in un unico punto → tuning del bilanciamento senza toccare la logica.
- **`serializeDecimal` in forma stringa** (`"1.5e400"`): salvataggi più compatti del raw `{mantissa, exponent}` e retro-compatibili.
