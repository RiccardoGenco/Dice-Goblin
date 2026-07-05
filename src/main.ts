import Decimal from 'break_infinity.js';
import { GoblinDie } from '@core/GoblinDie';
import { DieFace, FaceType, Rarity } from '@core/types';
import { DiceWorld } from '@graphics/DiceWorld';

/* ============================================================
 * DEV HARNESS (Piano di Verifica — controllo manuale)
 *
 * Lancia una borsa di 5 dadi e stampa nel log la faccia estratta
 * dalla LOGICA per ciascun dado: la faccia superiore del dado 3D
 * deve corrispondere esattamente. Verrà sostituito da GameManager
 * + App.svelte nella Fase 5.
 * ============================================================ */

const canvas = document.getElementById('arena') as HTMLCanvasElement;
const log = document.getElementById('log')!;
const rollBtn = document.getElementById('roll') as HTMLButtonElement;

const world = new DiceWorld(canvas);
window.addEventListener('resize', () =>
  world.resize(canvas.clientWidth, canvas.clientHeight)
);

// Borsa demo: 4 dadi standard + 1 dado con facce speciali
const specialFaces: DieFace[] = [
  { value: new Decimal(5), type: FaceType.NORMAL },
  { value: new Decimal(10), type: FaceType.NORMAL },
  { value: new Decimal(2), type: FaceType.MULTIPLIER },
  { value: new Decimal(3), type: FaceType.MULTIPLIER },
  { value: new Decimal(2), type: FaceType.BUFF_STR },
  { value: new Decimal(1), type: FaceType.RECURSIVE }
];
const bag = [
  new GoblinDie(Rarity.COMUNE),
  new GoblinDie(Rarity.NON_COMUNE),
  new GoblinDie(Rarity.RARO),
  new GoblinDie(Rarity.EPICO),
  new GoblinDie(Rarity.LEGGENDARIO, specialFaces)
];

const TYPE_LABEL: Record<FaceType, string> = {
  [FaceType.NORMAL]: 'NORMAL',
  [FaceType.MULTIPLIER]: '×MULT',
  [FaceType.BUFF_STR]: '+STR',
  [FaceType.RECURSIVE]: '↻REC'
};

rollBtn.addEventListener('click', async () => {
  rollBtn.disabled = true;

  // 1) La LOGICA decide i risultati (come farebbe il BattleEngine)
  const results = bag.map(die => die.roll(0));
  log.textContent = results
    .map((f, i) => `Dado ${i + 1}: ${f.value.toString()} [${TYPE_LABEL[f.type]}]`)
    .join('\n');

  // 2) Il 3D "recita" il lancio e si blocca finché non è assestato
  await world.throwDice(bag, results);

  log.textContent += '\n✔ Tutti i dadi assestati — confronta le facce!';
  rollBtn.disabled = false;
});
