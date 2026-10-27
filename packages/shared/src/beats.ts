export type Accent = 'strong' | 'medium' | 'weak';

/**
 * Beat accents for one bar. Explicit `accents` (1-based) win; otherwise
 * 4/4 → 1, 3; 6/8 → 1, 4; 3/4 → 1.
 */
export function beatGrid(time: string | null | undefined, accents?: number[] | null): Accent[] {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(time?.trim() ?? '');
  let n = m ? Number(m[1]) : 4;
  const den = m ? Number(m[2]) : 4;
  if (n < 1 || n > 32) n = 4;
  if (accents?.length) return Array.from({ length: n }, (_, i) => (accents.includes(i + 1) ? 'strong' : 'weak'));
  const grid: Accent[] = Array(n).fill('weak');
  grid[0] = 'strong';
  if (den === 8 && n > 3 && n % 3 === 0) for (let i = 3; i < n; i += 3) grid[i] = 'medium';
  else if (n >= 4 && n % 2 === 0) grid[n / 2] = 'medium';
  return grid;
}

/** BPM from tap timestamps (ms). Taps older than a 2 s pause are ignored. */
export function tapTempo(taps: number[]): number | null {
  let start = taps.length - 1;
  while (start > 0 && taps[start] - taps[start - 1] < 2000) start--;
  const recent = taps.slice(start).slice(-8);
  if (recent.length < 2) return null;
  const avg = (recent.at(-1)! - recent[0]) / (recent.length - 1);
  return Math.round(Math.min(300, Math.max(20, 60000 / avg)));
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const defaultClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * Metronome ticker. Each tick is scheduled against the absolute start time,
 * so timer jitter does not accumulate into drift.
 */
export function startTicker(bpm: number, onTick: (n: number) => void, clock: Clock = defaultClock): () => void {
  const interval = 60000 / bpm;
  const start = clock.now();
  let n = 0;
  let timer: unknown;
  const tick = () => {
    onTick(n++);
    timer = clock.setTimeout(tick, Math.max(0, start + n * interval - clock.now()));
  };
  tick();
  return () => clock.clearTimeout(timer);
}

/** Click sound per beat accent: pitch in Hz and loudness 0..1. */
const CLICK: Record<Accent, { freq: number; gain: number }> = {
  strong: { freq: 1760, gain: 0.9 },
  medium: { freq: 1175, gain: 0.9 },
  weak: { freq: 1175, gain: 0.45 },
};

/**
 * One bar of metronome clicks as a mono 16-bit WAV file. Looping the file natively keeps
 * every beat exactly on time, which a JS timer starting each click cannot do.
 */
export function clickBar(bpm: number, grid: Accent[], rate = 22050): Uint8Array {
  const beat = Math.round((rate * 60) / bpm);
  const samples = beat * grid.length;
  const clickLength = Math.min(beat, Math.round(rate * 0.04));
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);
  grid.forEach((accent, i) => {
    const { freq, gain } = CLICK[accent];
    for (let t = 0; t < clickLength; t++) {
      const v = gain * Math.exp(-t / (rate * 0.006)) * Math.sin((2 * Math.PI * freq * t) / rate);
      view.setInt16(44 + (i * beat + t) * 2, Math.round(v * 32767), true);
    }
  });
  return new Uint8Array(view.buffer);
}
