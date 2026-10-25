export type Notation = 'english' | 'german';

export interface Chord {
  root: number;
  quality: string;
  bass?: number;
  /** Accidental direction as written (-1 flat, 1 sharp); keeps borrowed chords spelled as the author meant. */
  acc?: number;
  bassAcc?: number;
}

export interface Spelling {
  table: string[];
  /** Pitch classes of the key's major scale; notes outside it keep their written accidental. */
  scale: number[] | null;
}

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// C major / A minor: borrowed chords are usually spelled Bb, Eb, Ab but F#, C#.
const NATURAL = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

const CHORD_RE =
  /^([A-H])([#b♯♭]?)((?:maj|min|dim|aug|sus|add|m|M|\+|°|ø|\d|#|b|♯|♭|\(|\))*)(?:\/([A-H])([#b♯♭]?))?$/;

export const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** B and H are both B natural; B-flat is written Bb or Hb. */
function noteValue(letter: string, acc: string): [value: number, acc: number] {
  const dir = acc === '#' || acc === '♯' ? 1 : acc === 'b' || acc === '♭' ? -1 : 0;
  return [mod12(LETTER[letter] + dir), dir];
}

export function isChord(s: string): boolean {
  return CHORD_RE.test(s);
}

export function parseChord(s: string): Chord | null {
  const m = CHORD_RE.exec(s.trim());
  if (!m) return null;
  const [root, acc] = noteValue(m[1], m[2]);
  const [bass, bassAcc] = m[4] ? noteValue(m[4], m[5]) : [undefined, undefined];
  return { root, quality: m[3], bass, acc, bassAcc };
}

export const isMinor = (c: Chord) => /^m(?!aj)/.test(c.quality) || c.quality.startsWith('min');

function noteName(v: number, spelling: Spelling, notation: Notation, acc = 0): string {
  const pc = mod12(v);
  const outside = spelling.scale && !spelling.scale.includes(pc);
  const name = (outside && acc ? (acc < 0 ? FLAT : SHARP) : spelling.table)[pc];
  // Notation only names B natural: H (German) or B; B-flat stays Bb.
  return notation === 'german' && name === 'B' ? 'H' : name;
}

/** Sharps or flats that suit a key. */
export function spellingFor(key: Chord | null): Spelling {
  if (!key) return { table: NATURAL, scale: null };
  const major = isMinor(key) ? mod12(key.root + 3) : key.root;
  const table = major === 0 ? NATURAL : [5, 10, 3, 8, 1].includes(major) ? FLAT : SHARP;
  return { table, scale: [0, 2, 4, 5, 7, 9, 11].map((i) => mod12(major + i)) };
}

export function formatChord(c: Chord, spelling: Spelling, notation: Notation): string {
  const bass = c.bass === undefined ? '' : '/' + noteName(c.bass, spelling, notation, c.bassAcc);
  return noteName(c.root, spelling, notation, c.acc) + c.quality + bass;
}

export function keyName(key: Chord, notation: Notation): string {
  const minor = isMinor(key);
  return noteName(key.root, { table: minor ? MINOR_KEYS : MAJOR_KEYS, scale: null }, notation) + (minor ? 'm' : '');
}

/** All 12 keys in the same mode (major/minor) as `key`, for a key picker. */
export function keyChoices(key: Chord, notation: Notation): { name: string; root: number }[] {
  return Array.from({ length: 12 }, (_, root) => ({ name: keyName({ ...key, root }, notation), root }));
}

/** Semitone shift from one root to another, in the range -5..+6. */
export function shiftBetween(from: number, to: number): number {
  const d = mod12(to - from);
  return d > 6 ? d - 12 : d;
}

export function detectNotation(chords: string[]): Notation {
  return chords.some((c) => /(^|\/)H/.test(c)) ? 'german' : 'english';
}

export function transposeChord(
  s: string,
  semis: number,
  o: { to: Notation; spelling: Spelling },
): string {
  // Untransposed chords keep the author's spelling; only the letter for B natural follows the notation.
  // H#, B#, E#, Cb, Fb are not real chord names, so they are respelled (H# → C).
  if (semis === 0 && isChord(s) && !/(^|\/)([BHE][#♯]|[CF][b♭])/.test(s))
    return s.replace(/(^|\/)([BH])(?![b♭])/g, (_, pre: string) => pre + (o.to === 'german' ? 'H' : 'B'))
      .replace(/(^|\/)H(?=[b♭])/g, '$1B');
  const c = parseChord(s);
  if (!c) return s;
  return formatChord(
    { ...c, root: c.root + semis, bass: c.bass === undefined ? undefined : c.bass + semis },
    o.spelling,
    o.to,
  );
}

export interface ChordContext {
  map: (chord: string) => string;
  /** Key the song sounds in after transposition. */
  soundingKey: string | null;
  /** Key of the chord shapes the player uses with the capo. */
  shapeKey: string | null;
  /** Sounding key without transposition (for the key picker). */
  baseKey: Chord | null;
}

/**
 * Combines song key, notation, transpose and capo into one chord mapper for rendering.
 * With a song capo (`{capo}`), chords are written as shapes for that capo and `{key}` is the sounding key.
 */
export function chordContext(o: {
  key: string | null;
  chords: string[];
  notation: Notation;
  display?: Notation;
  transpose: number;
  capo: number;
  songCapo?: number;
}): ChordContext {
  const to = o.display ?? o.notation;
  const songCapo = o.songCapo ?? 0;
  const key = o.key ? parseChord(o.key) : null;
  const first = o.chords[0] ? parseChord(o.chords[0]) : null;
  // Key of the chords as written.
  const written = key ? { ...key, root: mod12(key.root - songCapo) } : first;
  const shift = o.transpose + songCapo - o.capo;
  const at = (n: number) => written && { ...written, root: mod12(written.root + n) };
  const shape = at(shift);
  const spelling = spellingFor(shape);
  return {
    map: (ch) => transposeChord(ch, shift, { to, spelling }),
    soundingKey: written && keyName(at(songCapo + o.transpose)!, to),
    shapeKey: shape && keyName(shape, to),
    baseKey: at(songCapo),
  };
}
