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
