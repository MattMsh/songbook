import { mod12, parseChord, type Notation } from './chords';

/** Frets run from low E to high E; null means a muted string. */
export type GuitarFrets = (number | null)[];

const INTERVALS: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11], sus2: [0, 2, 7], sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10], dim: [0, 3, 6], dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10], aug: [0, 4, 8], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9],
  add9: [0, 4, 7, 2], m9: [0, 3, 7, 10, 2], '9': [0, 4, 7, 10, 2],
  maj9: [0, 4, 7, 11, 2],
};
const qualityName = (s: string) => s.replace(/^min/, 'm').replace(/^M(?=7|9|$)/, 'maj')
  .replace(/^maj$/, '').replace(/^sus$/, 'sus4').replace(/^°/, 'dim').replace(/^ø7?$/, 'm7b5').replace(/^\+$/, 'aug');

// Movable voicings use E or A as the reference root. Each includes every chord tone.
const MOVABLE: Record<string, { root: number; frets: GuitarFrets }> = {
  '': { root: 4, frets: [0, 2, 2, 1, 0, 0] },
  m: { root: 4, frets: [0, 2, 2, 0, 0, 0] },
  '7': { root: 4, frets: [0, 2, 0, 1, 0, 0] },
  m7: { root: 4, frets: [0, 2, 0, 0, 0, 0] },
  maj7: { root: 4, frets: [0, 2, 1, 1, 0, 0] },
  sus4: { root: 4, frets: [0, 2, 2, 2, 0, 0] },
  '7sus4': { root: 4, frets: [0, 2, 0, 2, 0, 0] },
  sus2: { root: 9, frets: [null, 0, 2, 2, 0, 0] },
  dim: { root: 9, frets: [null, 0, 1, 2, 1, null] },
  dim7: { root: 9, frets: [null, 0, 1, 2, 1, 2] },
  m7b5: { root: 9, frets: [null, 0, 1, 0, 1, null] },
  aug: { root: 4, frets: [0, null, 2, 1, 1, 0] },
};
const OPEN: Record<string, GuitarFrets> = {
  '0:': [null, 3, 2, 0, 1, 0], '2:': [null, null, 0, 2, 3, 2],
  '7:': [3, 2, 0, 0, 0, 3], '9:': [null, 0, 2, 2, 2, 0],
  '9:m': [null, 0, 2, 2, 1, 0], '2:m': [null, null, 0, 2, 3, 1],
  '0:7': [null, 3, 2, 3, 1, 0], '2:7': [null, null, 0, 2, 1, 2],
  '7:7': [3, 2, 0, 0, 0, 1], '9:7': [null, 0, 2, 0, 2, 0],
  '9:m7': [null, 0, 2, 0, 1, 0], '2:m7': [null, null, 0, 2, 1, 1],
};
const SLASH: Record<string, GuitarFrets> = {
  '0::4': [0, 3, 2, 0, 1, 0], '7::11': [null, 2, 0, 0, 3, 3],
  '2::6': [2, 0, 0, 2, 3, 2], '9:m:7': [3, 0, 2, 2, 1, 0],
};

/** Returns null rather than guessing a voicing for an unsupported quality or inversion. */
export function guitarFrets(chord: string): GuitarFrets | null {
  const c = parseChord(chord);
  if (!c) return null;
  const quality = qualityName(c.quality);
  if (c.bass !== undefined && c.bass !== c.root)
    return SLASH[`${c.root}:${quality}:${c.bass}`]?.slice() ?? null;
  const open = OPEN[`${c.root}:${quality}`];
  if (open) return open.slice();
  const shape = MOVABLE[quality];
  if (!shape) return null;
  const shift = mod12(c.root - shape.root);
  return shape.frets.map((f) => f === null ? null : f + shift);
}

/** Sounding pitch classes, not a piano voicing; the displayed guitar shape gains the current capo. */
export function pianoPitchClasses(chord: string, capo = 0): { notes: number[]; bass: number } | null {
  const c = parseChord(chord);
  if (!c || !Number.isInteger(capo) || capo < 0 || capo > 11) return null;
  const intervals = INTERVALS[qualityName(c.quality)];
  if (!intervals) return null;
  const notes = intervals.map((n) => mod12(c.root + n + capo));
  const bass = mod12((c.bass ?? c.root) + capo);
  if (!notes.includes(bass)) notes.push(bass);
  return { notes: [...new Set(notes)], bass };
}

export function pitchClassName(pc: number, notation: Notation = 'english'): string {
  const names = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', notation === 'german' ? 'H' : 'B'];
  return names[mod12(pc)];
}
