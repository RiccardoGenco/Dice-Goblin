import { describe, expect, it } from 'vitest';
import Decimal from 'break_infinity.js';
import { RunLog, faceLabel } from '../src/core/RunLog';
import { describeActiveItems, findItem, neutralCtx, buildCtx } from '../src/core/equipment';
import { DieFace, FaceType, SkillId } from '../src/core/types';

const face = (value: number, type = FaceType.NORMAL, effect?: DieFace['effect']): DieFace =>
  ({ value: new Decimal(value), type, effect });

describe('RunLog', () => {
  it('scrive un testo leggibile con intestazione e righe indentate', () => {
    const log = new RunLog({ hpGrowth: 1.24 });
    log.add('fight', '━━ Atto 1 — 1/10 ━━');
    log.add('turn', 'Turno 1');
    log.add('action', 'AZIONE Sgancio Brutale');
    log.stats.actions['Sgancio Brutale'] = 2;
    const text = log.toText();
    expect(text).toContain('REGISTRO RUN');
    expect(text).toContain('hpGrowth=1.24');
    expect(text).toContain('Sgancio Brutale 2');
    expect(text).toContain('\n  Turno 1');
    expect(text).toContain('\n    AZIONE Sgancio Brutale');
  });

  it('fa il giro di salvataggio senza perdere numeri enormi', () => {
    const log = new RunLog({});
    log.add('note', 'x');
    log.stats.damageDealt = new Decimal('3.2e40');
    log.stats.goldSpent = new Decimal(1234);
    log.finish('sconfitta', 'Atto 2 — 3/10', 'Mago');
    const back = RunLog.deserialize(log.serialize())!;
    expect(back.stats.damageDealt.eq(new Decimal('3.2e40'))).toBe(true);
    expect(back.meta.outcome).toBe('sconfitta');
    expect(back.meta.killedBy).toBe('Mago');
    expect(back.entries.length).toBe(1);
    expect(back.finished).toBe(true);
  });

  it('un salvataggio corrotto non fa danni', () => {
    expect(RunLog.deserialize('{non json')).toBeNull();
    expect(RunLog.deserialize(null)).toBeNull();
    expect(RunLog.deserialize('{"v":99}')).toBeNull();
  });

  it('scarta le righe più vecchie oltre il limite e lo segnala', () => {
    const log = new RunLog({});
    for (let i = 0; i < 9600; i++) log.add('roll', `r${i}`);
    expect(log.entries.length).toBeLessThan(9600);
    expect(log.toText()).toContain('registro troncato');
    expect(log.entries[log.entries.length - 1]!.text).toBe('r9599');
  });
});

describe('faceLabel', () => {
  it('mostra effetto, moltiplicatore, forza e ricorsione', () => {
    expect(faceLabel(face(6))).toBe('6');
    expect(faceLabel(face(7, FaceType.NORMAL, 'veleno'))).toBe('☠7');
    expect(faceLabel(face(2, FaceType.MULTIPLIER))).toBe('×2');
    expect(faceLabel(face(3, FaceType.BUFF_STR))).toBe('+3💪');
    expect(faceLabel(face(1, FaceType.RECURSIVE))).toBe('↻');
  });
});

describe('describeActiveItems', () => {
  const items = ['lente-avida', 'zanna-ricurva', 'fungo-marcio', 'dadi-truccati', 'talismano-caos']
    .map(id => findItem(id)!);

  it('elenca solo gli oggetti che scattano e distingue bonus piatti da moltiplicatori', () => {
    const ctx = buildCtx({ ...neutralCtx(), skill: SkillId.SGANCIO_BRUTALE, faces: [face(5), face(5)] });
    const out = describeActiveItems(items, ctx);
    expect(out.some(t => t.startsWith("Monocolo dell'Assassino") && t.includes('×1.25'))).toBe(true);
    expect(out.some(t => t.startsWith('Zanna di Worg') && t.includes('+15'))).toBe(true);
    expect(out.some(t => t.startsWith('Talismano del Caos') && t.includes('×1.082'))).toBe(true);
    expect(out.some(t => t.startsWith('Spora del Sottosuolo'))).toBe(false); // solo con Bava
    expect(out.some(t => t.startsWith("Dadi dell'Imbroglione") && t.includes('regola'))).toBe(true);
  });

  it('Spora del Sottosuolo compare con Bava', () => {
    const ctx = buildCtx({ ...neutralCtx(), skill: SkillId.BAVA });
    expect(describeActiveItems(items, ctx).some(t => t.startsWith('Spora del Sottosuolo') && t.includes('×1.5'))).toBe(true);
  });
});
