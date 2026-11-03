/* ============================================================
 * Suoni sintetizzati con WebAudio: nessun file, nessuna rete.
 * Il contesto audio nasce al primo gesto dell'utente (regola dei
 * browser) e tutto è spento se `muted` è vero.
 * ============================================================ */

const KEY = 'goblin-settings-v1';

export interface Settings { muted: boolean; fast: boolean; tutorialDone: boolean; crt: boolean }

export function loadSettings(): Settings {
  const d: Settings = { muted: false, fast: false, tutorialDone: false, crt: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...d, ...JSON.parse(raw) };
  } catch { /* archivio non disponibile: valori di default */ }
  return d;
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignora */ }
}

type Wave = OscillatorType;

class Sfx {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    try {
      if (!this.ctx) {
        const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC() as AudioContext;
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch { return null; }
  }

  private tone(freq: number, dur: number, type: Wave = 'sine', vol = 0.2, slideTo?: number, delay = 0): void {
    const c = this.ensure(); if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol = 0.2, f0 = 1200, kind: BiquadFilterType = 'bandpass', f1?: number, delay = 0): void {
    const c = this.ensure(); if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = kind; f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }

  /** Nota di una scala pentatonica: gradino 0 = La3 */
  private note(step: number): number {
    const scale = [0, 3, 5, 7, 10];
    const oct = Math.floor(step / 5), idx = ((step % 5) + 5) % 5;
    return 220 * Math.pow(2, (scale[idx]! + 12 * oct) / 12);
  }

  /** I dadi vengono lanciati: una raffica di colpetti */
  roll(count = 5): void {
    for (let i = 0; i < Math.min(8, count + 2); i++) {
      this.noise(0.045, 0.16, 1600 + Math.random() * 1800, 'bandpass', undefined, i * 0.055 + Math.random() * 0.03);
      this.tone(380 + Math.random() * 220, 0.04, 'triangle', 0.05, undefined, i * 0.055);
    }
  }
  /** I dadi si fermano */
  settle(): void { this.tone(170, 0.09, 'sine', 0.22, 90); this.noise(0.05, 0.1, 500, 'lowpass'); }
  /** Un dado passa in panchina o torna in gioco */
  select(on: boolean): void { this.tone(on ? 620 : 420, 0.07, 'square', 0.07, on ? 880 : 300); }
  click(): void { this.tone(540, 0.05, 'square', 0.06, 760); }
  /** Moltiplicatore: più è alto il livello, più note sale l'arpeggio */
  mult(tier: number): void {
    const n = 2 + Math.min(4, Math.max(0, tier));
    for (let i = 0; i < n; i++) this.tone(this.note(5 + i * 2), 0.16 + i * 0.01, 'triangle', 0.12 + tier * 0.02, undefined, i * 0.07);
    if (tier >= 3) this.tone(this.note(5), 0.5, 'sawtooth', 0.05, this.note(15), 0.0);
  }
  overflow(): void {
    this.tone(180, 0.8, 'sawtooth', 0.1, 1400);
    for (let i = 0; i < 5; i++) this.tone(this.note(8 + i * 2), 0.3, 'square', 0.07, undefined, 0.25 + i * 0.06);
  }
  /** Colpo: più forte con l'ordine di grandezza del danno */
  hit(power: number): void {
    const p = Math.min(5, Math.max(0, power));
    this.tone(150 - p * 8, 0.18 + p * 0.03, 'sine', 0.3, 45);
    this.noise(0.1 + p * 0.03, 0.22 + p * 0.03, 900 - p * 80, 'lowpass');
    if (p > 2.5) this.noise(0.35, 0.18, 300, 'lowpass', 80, 0.03);
  }
  shield(): void { this.tone(640, 0.18, 'square', 0.1, 980); this.noise(0.1, 0.12, 4200, 'highpass'); this.tone(1300, 0.25, 'sine', 0.06, undefined, 0.04); }
  poison(): void { for (let i = 0; i < 4; i++) this.tone(260 + Math.random() * 120, 0.09, 'sine', 0.12, 520, i * 0.06); }
  fire(): void { this.noise(0.45, 0.2, 350, 'lowpass', 2200); this.tone(110, 0.4, 'sawtooth', 0.05, 220); }
  reaction(): void { this.tone(988, 0.5, 'sine', 0.1); this.tone(1480, 0.45, 'sine', 0.07, undefined, 0.05); }
  charge(): void { this.tone(200, 0.35, 'sawtooth', 0.1, 700); }
  coin(): void { this.tone(1318, 0.07, 'square', 0.09); this.tone(1760, 0.2, 'square', 0.09, undefined, 0.07); }
  /** Monete che cadono: più oro (log10 dell'incremento), più monete nella cascata */
  loot(size = 1): void {
    const n = Math.min(12, 3 + Math.round(size * 1.6));
    for (let i = 0; i < n; i++) {
      const t = i * 0.055 + Math.random() * 0.02;
      const f = 1760 + Math.random() * 1500;
      this.tone(f, 0.05, 'square', 0.06, undefined, t);
      this.tone(f * 1.5, 0.16, 'triangle', 0.07, undefined, t + 0.03);
      this.noise(0.03, 0.05, 6500, 'highpass', undefined, t);
    }
    this.tone(this.note(10), 0.35, 'sine', 0.06, undefined, n * 0.055);
  }
  /** Tic dei contatori che salgono (si alza con l'avanzare) */
  tick(progress = 0): void { this.tone(900 + progress * 700, 0.025, 'square', 0.025); }
  /** Vendita: monete che scendono di tono */
  sell(): void { this.tone(1760, 0.07, 'square', 0.08); this.tone(1318, 0.09, 'square', 0.08, undefined, 0.07); this.tone(988, 0.18, 'triangle', 0.08, undefined, 0.15); this.noise(0.08, 0.08, 5200, 'highpass', undefined, 0.02); }
  /** Oggetto equipaggiato: tintinnio metallico */
  equip(rank = 0): void {
    this.noise(0.06, 0.16, 3600, 'highpass');
    this.tone(this.note(10 + rank), 0.2, 'triangle', 0.1);
    this.tone(this.note(12 + rank), 0.3, 'sine', 0.09, undefined, 0.07);
    if (rank >= 2) this.tone(this.note(15), 0.5, 'sine', 0.06, undefined, 0.14);
  }
  /** Reliquia o obiettivo: breve fanfara */
  fanfare(): void {
    [0, 2, 4, 7, 9].forEach((s, i) => this.tone(this.note(7 + s), 0.32, 'triangle', 0.13, undefined, i * 0.1));
    this.tone(this.note(7), 0.9, 'sawtooth', 0.04, this.note(17), 0.0);
  }
  /** Porta scelta / evento */
  door(): void { this.noise(0.25, 0.14, 500, 'lowpass', 1800); this.tone(150, 0.2, 'triangle', 0.1, 220); }
  denied(): void { this.tone(180, 0.15, 'square', 0.08, 120); }
  victory(): void { [0, 2, 4, 7].forEach((s, i) => this.tone(this.note(5 + s), 0.28, 'triangle', 0.14, undefined, i * 0.11)); }
  defeat(): void { [7, 5, 3, 0].forEach((s, i) => this.tone(this.note(2 + s), 0.4, 'sawtooth', 0.08, undefined, i * 0.2)); }
}

export const sfx = new Sfx();
