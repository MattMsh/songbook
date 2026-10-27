import { describe, expect, it, vi } from 'vitest';
import {
  beatGrid,
  chordContext,
  isChordOnlyLine,
  keyChoices,
  lineDiff,
  lyricsText,
  normalizeSearch,
  parseChord,
  parseChordPro,
  parseLyricLine,
  parseSearch,
  partKind,
  chordBars,
  splitHeader,
  getDirective,
  ftsMatch,
  setDirective,
  shiftBetween,
  songFields,
  startTicker,
  tapTempo,
  transposeChord,
  spellingFor,
  type Clock,
  DEFAULT_PART_TYPES,
  matchPart,
  parsePartTypes,
  clickBar,
} from '../src';

const SHARP = spellingFor(parseChord('G'));
const FLAT = spellingFor(parseChord('F'));
const en = { to: 'english' } as const;

describe('chords', () => {
  it('parses root, quality and bass', () => {
    expect(parseChord('F#m7')).toMatchObject({ root: 6, quality: 'm7', bass: undefined, acc: 1 });
    expect(parseChord('C/E')).toMatchObject({ root: 0, quality: '', bass: 4 });
    expect(parseChord('Bbmaj7')).toMatchObject({ root: 10, quality: 'maj7' });
    expect(parseChord('Csus4')).toMatchObject({ quality: 'sus4' });
    expect(parseChord('Слава')).toBeNull();
    expect(parseChord('Amen')).toBeNull();
  });

  it('transposes with sharps or flats by key', () => {
    expect(transposeChord('Am', 2, { ...en, spelling: SHARP })).toBe('Bm');
    expect(transposeChord('C', 1, { ...en, spelling: SHARP })).toBe('C#');
    expect(transposeChord('C', 1, { ...en, spelling: FLAT })).toBe('Db');
    expect(transposeChord('G7', -2, { ...en, spelling: FLAT })).toBe('F7');
    expect(transposeChord('E', 12, { ...en, spelling: SHARP })).toBe('E');
  });

  it('transposes slash chords including the bass', () => {
    expect(transposeChord('C/E', 2, { ...en, spelling: SHARP })).toBe('D/F#');
    expect(transposeChord('G/B', 3, { ...en, spelling: FLAT })).toBe('Bb/D');
  });

  it('reads B and H as B natural and Bb/Hb as B-flat', () => {
    expect(parseChord('H')!.root).toBe(11);
    expect(parseChord('B')!.root).toBe(11);
    expect(parseChord('Bb')!.root).toBe(10);
    expect(parseChord('Hb')!.root).toBe(10);
    const de = { to: 'german', spelling: SHARP } as const;
    expect(transposeChord('Hm', 0, { to: 'english', spelling: SHARP })).toBe('Bm');
    expect(transposeChord('Bm', 0, de)).toBe('Hm');
    expect(transposeChord('A', 2, de)).toBe('H');
    expect(transposeChord('Hb', 0, { to: 'german', spelling: FLAT })).toBe('Bb');
    expect(transposeChord('Hb', 0, { to: 'english', spelling: FLAT })).toBe('Bb');
    expect(transposeChord('G/H', 3, { to: 'german', spelling: FLAT })).toBe('Bb/D');
  });

  it('treats H and B as the same note', () => {
    for (const [h, b] of [['Hm', 'Bm'], ['Hb', 'Bb'], ['H', 'B'], ['H#', 'B#'], ['G/H', 'G/B']])
      expect(parseChord(h)).toEqual(parseChord(b));
    const keep = (c: string, to: 'german' | 'english') => transposeChord(c, 0, { to, spelling: SHARP });
    expect(['Hm', 'Bm', 'Hb', 'G/H'].map((c) => keep(c, 'german'))).toEqual(['Hm', 'Hm', 'Bb', 'G/H']);
    expect(['Hm', 'Hb', 'G/H', 'Bb'].map((c) => keep(c, 'english'))).toEqual(['Bm', 'Bb', 'G/B', 'Bb']);
  });

  it('respells chord names that do not exist', () => {
    const keep = (c: string, to: 'german' | 'english') => transposeChord(c, 0, { to, spelling: SHARP });
    expect(['H#', 'B#7', 'E#m', 'Fb', 'Am/H#'].map((c) => keep(c, 'german'))).toEqual(['C', 'C7', 'Fm', 'E', 'Am/C']);
    expect(keep('Cb', 'german')).toBe('H');
    expect(keep('Cb', 'english')).toBe('B');
    expect(transposeChord('H#', 1, { to: 'german', spelling: SHARP })).toBe('C#');
  });

  it('keeps the written accidental for chords outside the key', () => {
    const g = spellingFor(parseChord('G'));
    expect(transposeChord('Hb', 0, { to: 'english', spelling: g })).toBe('Bb');
    expect(transposeChord('Bb', 0, { to: 'german', spelling: g })).toBe('Bb');
    expect(transposeChord('Hm', 0, { to: 'english', spelling: g })).toBe('Bm');
    expect(transposeChord('D#dim', 0, { ...en, spelling: spellingFor(parseChord('C')) })).toBe('D#dim');
    // A diatonic note follows the key, whatever the source wrote.
    expect(transposeChord('G#', 2, { ...en, spelling: spellingFor(parseChord('F')) })).toBe('Bb');
  });

  it('detects German notation from the song', () => {
    expect(parseChordPro('[Hm]Слава [G]Тобі').meta.notation).toBe('german');
    expect(parseChordPro('[Bm]Слава [G/B]Тобі').meta.notation).toBe('english');
    expect(parseChordPro('{notation: german}\n[Bb]Слава').meta.notation).toBe('german');
  });

  it('applies capo as chord shapes', () => {
    const ctx = chordContext({ key: 'A', chords: ['A'], notation: 'english', transpose: 0, capo: 2 });
    expect(ctx.soundingKey).toBe('A');
    expect(ctx.shapeKey).toBe('G');
    expect(ctx.map('A')).toBe('G');
    expect(ctx.map('E/G#')).toBe('D/F#');
  });

  it('combines transpose, capo and display notation', () => {
    const ctx = chordContext({
      key: 'Hm', chords: ['Hm'], notation: 'german', display: 'english', transpose: -2, capo: 0,
    });
    expect(ctx.soundingKey).toBe('Am');
    expect(ctx.map('Hm')).toBe('Am');
    expect(ctx.map('Hb')).toBe('Ab');
  });

  it('treats chords as shapes for the song capo', () => {
    const song = { key: 'H', chords: ['G', 'C', 'Em', 'D'], notation: 'german' as const, songCapo: 4 };
    const asWritten = chordContext({ ...song, transpose: 0, capo: 4 });
    expect(asWritten.soundingKey).toBe('H');
    expect(asWritten.shapeKey).toBe('G');
    expect(asWritten.map('Em')).toBe('Em');
    expect(asWritten.baseKey?.root).toBe(11);
    const noCapo = chordContext({ ...song, display: 'english', transpose: 0, capo: 0 });
    expect(['G', 'C', 'Em', 'D'].map(noCapo.map)).toEqual(['B', 'E', 'G#m', 'F#']);
    const capo2 = chordContext({ ...song, transpose: 0, capo: 2 });
    expect(capo2.shapeKey).toBe('A');
    expect(capo2.map('G')).toBe('A');
  });

  it('falls back to the first chord as key and lists 12 keys', () => {
    const ctx = chordContext({ key: null, chords: ['Em', 'C'], notation: 'english', transpose: 1, capo: 0 });
    expect(ctx.soundingKey).toBe('Fm');
    expect(keyChoices(parseChord('Am')!, 'german').map((k) => k.name)).toContain('Hm');
    expect(keyChoices(parseChord('C')!, 'english')).toHaveLength(12);
    expect(shiftBetween(9, 7)).toBe(-2);
    expect(shiftBetween(0, 7)).toBe(-5);
    expect(shiftBetween(0, 6)).toBe(6);
  });
});

describe('chordpro', () => {
  const src = `{title: Слава Тобі}
{number: 12}
{key: Am}
{tempo: 72}
{time: 6/8}
{rhythm: ↓ ↓↑ ↑↓↑}
{accents: 1 4}
# a comment
{c: Куплет 1}
[Am]Слава [F]Тобі, Го[C]споди

{soc: Приспів}
[G]Алілуя
{eoc}
[Am] | [F] | [C]`;

  it('parses meta, sections and chords', () => {
    const s = parseChordPro(src);
    expect(s.meta).toMatchObject({
      title: 'Слава Тобі', number: 12, key: 'Am', tempo: 72, time: '6/8',
      rhythm: '↓ ↓↑ ↑↓↑', accents: [1, 4], notation: 'english',
    });
    expect(s.chords).toEqual(['Am', 'F', 'C', 'G']);
    expect(s.sections.map((x) => [x.kind, x.label])).toEqual([[null, null], ['chorus', 'Приспів'], [null, null]]);
    expect(s.sections[0].lines[0]).toEqual({ type: 'comment', text: 'Куплет 1' });
  });

  it('splits lyric lines into chord segments', () => {
    expect(parseLyricLine('[Am]Слава Го[F]споди')).toEqual([
      { chord: 'Am', text: 'Слава Го' },
      { chord: 'F', text: 'споди' },
    ]);
    expect(parseLyricLine('Без акордів')).toEqual([{ chord: null, text: 'Без акордів' }]);
    expect(parseLyricLine('[Am][F]')).toEqual([{ chord: 'Am', text: '' }, { chord: 'F', text: '' }]);
    expect(isChordOnlyLine(parseLyricLine('[Am] | [F] x2'))).toBe(true);
    expect(isChordOnlyLine(parseLyricLine('[Am]Слава'))).toBe(false);
    expect(isChordOnlyLine(parseLyricLine('[G] | [G] – x4'))).toBe(true);
  });

  it('recognises song parts by label', () => {
    expect(['Куплет 1', 'ПРИСПІВ x2', 'Пр.', 'Бридж x3', 'Outro', 'Програш', 'Припев'].map(partKind)).toEqual([
      'verse', 'chorus', 'chorus', 'bridge', 'other', 'other', 'chorus',
    ]);
    expect(partKind('Прийди')).toBeNull();
    expect(partKind('Нотація H/B: H — це сі')).toBeNull();
  });

  it('matches song blocks by name and alias', () => {
    const id = (label: string) => matchPart(label, DEFAULT_PART_TYPES)?.id ?? null;
    expect(['Куплет 1', 'ПРИСПІВ x2', 'Пр.', 'Припев', 'Бридж x3', 'Outro', 'Вступление', 'Заспів', 'Pre-chorus 2', 'Чорус'].map(id)).toEqual([
      'verse', 'chorus', 'chorus', 'chorus', 'bridge', 'ending', 'intro', 'prechorus', 'prechorus', null,
    ]);
    // Whole words only: «Прийди» is a lyric, not «Пр».
    expect(id('Прийди')).toBeNull();
    expect(id('Нотація H/B: H — це сі')).toBeNull();
    expect(id('Завершение (тихо)')).toBe('ending');
  });

  it('renders one bar of clicks as a WAV file', () => {
    const rate = 8000;
    const wav = clickBar(120, ['strong', 'weak', 'weak'], rate);
    const view = new DataView(wav.buffer);
    const beat = rate / 2; // 120 BPM: half a second per beat
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(rate);
    expect(view.getUint32(40, true)).toBe(3 * beat * 2);
    expect(wav.length).toBe(44 + 3 * beat * 2);
    const sample = (i: number) => view.getInt16(44 + i * 2, true);
    const peak = (from: number) => Math.max(...Array.from({ length: 100 }, (_, t) => Math.abs(sample(from + t))));
    // Each beat starts with a click; the strong one is louder; silence in between.
    expect(peak(0)).toBeGreaterThan(peak(beat) * 1.5);
    expect(peak(2 * beat)).toBeGreaterThan(1000);
    expect(sample(beat - 1)).toBe(0);
  });

  it('validates the admin block list', () => {
    expect(parsePartTypes(DEFAULT_PART_TYPES)).toEqual(DEFAULT_PART_TYPES);
    expect(parsePartTypes([{ id: 'a', name: ' Тег ', aliases: [' Tag ', ''], color: 'gray' }])).toEqual([
      { id: 'a', name: 'Тег', aliases: ['Tag'], color: 'gray' },
    ]);
    expect(parsePartTypes([])).toEqual({ error: 'types' });
    expect(parsePartTypes([{ id: 'a', name: 'X', aliases: [], color: 'purple' }])).toEqual({ error: 'color' });
    expect(parsePartTypes([{ id: 'a', name: '', aliases: [], color: 'red' }])).toEqual({ error: 'name' });
    const dup = { id: 'a', name: 'X', aliases: [], color: 'red' };
    expect(parsePartTypes([dup, dup])).toEqual({ error: 'id' });
  });

  it('repeats the last chorus and reads the link', () => {
    const song = parseChordPro('{link: https://example.com/1}\n{soc: Приспів x2}\n[C] | [G]\n{eoc}\n{sob: Бридж}\n[D]\n{eob}\n{chorus: Приспів x2}');
    expect(song.meta.link).toBe('https://example.com/1');
    expect(song.sections.map((x) => [x.kind, x.label, x.lines.length])).toEqual([
      ['chorus', 'Приспів x2', 1],
      ['bridge', 'Бридж', 1],
      ['chorus', 'Приспів x2', 1],
    ]);
    expect(parseChordPro('{chorus}').sections[0].label).toBe('Приспів');
  });

  it('splits chord-only lines into bars', () => {
    expect(chordBars(parseLyricLine('[G] | [G] | [G] | [G] – x4'))).toEqual({ bars: [['G'], ['G'], ['G'], ['G']], rest: 'x4' });
    expect(chordBars(parseLyricLine('| [Am] - [F] | [C] - [G] |'))).toEqual({ bars: [['Am', 'F'], ['C', 'G']], rest: '' });
    expect(chordBars(parseLyricLine('[Am] | [F] | [C] | [G] x2'))).toEqual({ bars: [['Am'], ['F'], ['C'], ['G']], rest: 'x2' });
    expect(chordBars(parseLyricLine('|: [Em] - [D] | [C] :|'))).toEqual({ bars: [['Em', 'D'], ['C']], rest: '' });
    expect(chordBars(parseLyricLine('[Am] [F]'))).toBeNull();
  });

  it('extracts lyrics and server fields', () => {
    expect(lyricsText(parseChordPro(src))).toBe('Слава Тобі, Господи\nАлілуя');
    expect(songFields(src)).toEqual({ number: 12, title: 'Слава Тобі', key: 'Am', bpm: 72, timeSig: '6/8', rhythm: '↓ ↓↑ ↑↓↑' });
    expect(songFields('[C]Текст').title).toBe('Без назви');
  });

  it('splits the header block losslessly', () => {
    const song = '{title: A}\n{number: 2}\n{accents: 1 4}\n\n{c: Куплет}\n[C]Текст\n{key: G}';
    const { head, body } = splitHeader(song);
    expect(head).toBe('{title: A}\n{number: 2}\n{accents: 1 4}\n\n');
    expect(body).toBe('{c: Куплет}\n[C]Текст\n{key: G}');
    expect(head + body).toBe(song);
    expect(splitHeader('[C]Текст')).toEqual({ head: '', body: '[C]Текст' });
    expect(splitHeader('{title: A}')).toEqual({ head: '{title: A}', body: '' });
    expect(getDirective(head, 'number')).toBe('2');
    expect(getDirective(head, 'key')).toBeNull();
  });

  it('sets directives', () => {
    expect(setDirective('{title: A}\nx', 'number', 5)).toBe('{title: A}\n{number: 5}\nx');
    expect(setDirective('{title: A}\n{number: 1}', 'number', 7)).toBe('{title: A}\n{number: 7}');
    expect(setDirective('x', 'key', 'G')).toBe('{key: G}\nx');
    expect(setDirective('{key: G}\nx', 'key', null)).toBe('x');
  });
});

describe('search', () => {
  it('folds Ukrainian and Russian spellings', () => {
    expect(normalizeSearch('Святий')).toBe(normalizeSearch('Святый'));
    expect(normalizeSearch("п'ять")).toBe(normalizeSearch('пять'));
    expect(normalizeSearch('п’ять')).toBe('пят');
    expect(normalizeSearch('Її')).toBe('ии');
    expect(normalizeSearch('Єдиний')).toBe(normalizeSearch('единый'));
    expect(normalizeSearch('Ёлка Эхо')).toBe('елка ехо');
    expect(normalizeSearch('Ґанок')).toBe('ганок');
    expect(normalizeSearch('сім’я, подъезд!')).toBe('симя подезд');
    expect(normalizeSearch('Сла́ва')).toBe('слава');
  });

  it('parses numbers and text queries', () => {
    expect(parseSearch('12')).toEqual({ kind: 'number', number: '12' });
    expect(parseSearch('№ 12')).toEqual({ kind: 'number', number: '12' });
    expect(parseSearch('  ')).toEqual({ kind: 'all' });
    expect(parseSearch('Святий Бог')).toEqual({ kind: 'text', tokens: ['святии', 'бог'] });
    expect(ftsMatch(['свят', 'бог'])).toBe('"свят"* "бог"*');
  });
});

describe('diff', () => {
  it('produces an LCS line diff', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc\nd')).toEqual([
      { op: 'eq', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'add', text: 'x' },
      { op: 'eq', text: 'c' },
      { op: 'add', text: 'd' },
    ]);
    expect(lineDiff('same', 'same')).toEqual([{ op: 'eq', text: 'same' }]);
    expect(lineDiff('a\nb\n\n', 'a\nb')).toEqual([{ op: 'eq', text: 'a' }, { op: 'eq', text: 'b' }]);
  });
});

describe('beats', () => {
  it('builds accent grids', () => {
    expect(beatGrid('4/4')).toEqual(['strong', 'weak', 'medium', 'weak']);
    expect(beatGrid('3/4')).toEqual(['strong', 'weak', 'weak']);
    expect(beatGrid('6/8')).toEqual(['strong', 'weak', 'weak', 'medium', 'weak', 'weak']);
    expect(beatGrid('2/4')).toEqual(['strong', 'weak']);
    expect(beatGrid(null)).toHaveLength(4);
    expect(beatGrid('4/4', [2, 4])).toEqual(['weak', 'strong', 'weak', 'strong']);
  });

  it('computes tap tempo', () => {
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([0, 500, 5000, 6000])).toBe(60);
    expect(tapTempo([100])).toBeNull();
  });

  it('schedules ticks against absolute time (no drift)', () => {
    vi.useFakeTimers();
    let now = 0;
    const delays: number[] = [];
    const clock: Clock = {
      now: () => now,
      setTimeout: (fn, ms) => {
        delays.push(ms);
        return setTimeout(() => {
          now += ms + 7; // every timer fires 7 ms late
          fn();
        }, ms);
      },
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    };
    const ticks: number[] = [];
    const stop = startTicker(120, (n) => ticks.push(n), clock);
    vi.advanceTimersByTime(2000);
    stop();
    vi.useRealTimers();
    expect(ticks.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(delays[0]).toBe(500);
    expect(delays[1]).toBe(493); // the late tick is compensated
  });
});
