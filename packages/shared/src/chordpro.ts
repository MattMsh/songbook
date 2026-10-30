import { detectNotation, type Notation } from './chords';
import { DEFAULT_GRID_SHAPE, gridChords, parseGridDirective, type ChordGrid } from './grids';

export interface Segment {
  chord: string | null;
  text: string;
}

export type Line =
  | { type: 'lyrics'; segments: Segment[] }
  | { type: 'comment'; text: string }
  | { type: 'empty' }
  | { type: 'grid'; grid: ChordGrid };

export type SectionKind = 'verse' | 'chorus' | 'bridge' | null;

export interface Section {
  kind: SectionKind;
  label: string | null;
  lines: Line[];
}

export interface SongMeta {
  title: string;
  tags: string[];
  number: number | null;
  key: string | null;
  tempo: number | null;
  time: string | null;
  capo: number | null;
  rhythm: string | null;
  accents: number[] | null;
  notation: Notation;
  /** Source of the full lyrics (custom `{link}`). */
  link: string | null;
}

export interface ParsedSong {
  meta: SongMeta;
  sections: Section[];
  /** Unique chords in order of first appearance. */
  chords: string[];
}

const ALIASES: Record<string, string> = {
  t: 'title',
  c: 'comment',
  ci: 'comment',
  cb: 'comment',
  comment_italic: 'comment',
  comment_box: 'comment',
  soc: 'start_of_chorus',
  eoc: 'end_of_chorus',
  sov: 'start_of_verse',
  eov: 'end_of_verse',
  sob: 'start_of_bridge',
  eob: 'end_of_bridge',
  sog: 'start_of_grid',
  eog: 'end_of_grid',
};

const START: Record<string, SectionKind> = {
  start_of_chorus: 'chorus',
  start_of_verse: 'verse',
  start_of_bridge: 'bridge',
};

const DIRECTIVE_RE = /^\{\s*([A-Za-z_][A-Za-z_\d-]*)(.*?)\s*\}$/;
const CHORD_TAG_RE = /\[([^\]]*)\]/g;

export function parseDirective(line: string): { name: string; value: string; attributes?: Record<string, string> } | null {
  const m = DIRECTIVE_RE.exec(line.trim());
  if (!m) return null;
  const name = ALIASES[m[1].toLowerCase()] ?? m[1].toLowerCase();
  const tail = m[2].trim();
  if (!tail || tail.startsWith(':')) return { name, value: tail.replace(/^:\s*/, '') };
  const attributes: Record<string, string> = Object.create(null);
  const pattern = /([A-Za-z_][\w-]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s"']+))/gy;
  let at = 0;
  while (at < tail.length) {
    pattern.lastIndex = at;
    const attribute = pattern.exec(tail);
    if (!attribute) return null;
    attributes[attribute[1].toLowerCase()] = (attribute[2] ?? attribute[3] ?? attribute[4]).replace(/\\([\\"'])/g, '$1');
    at = pattern.lastIndex;
    if (at < tail.length && !/\s/.test(tail[at])) return null;
    while (/\s/.test(tail[at] ?? '') && at < tail.length) at++;
  }
  return { name, value: '', attributes };
}

export function parseLyricLine(line: string): Segment[] {
  const segments: Segment[] = [];
  let chord: string | null = null;
  let last = 0;
  for (const m of line.matchAll(CHORD_TAG_RE)) {
    const text = line.slice(last, m.index);
    if (text || chord !== null) segments.push({ chord, text });
    chord = m[1].trim();
    last = m.index! + m[0].length;
  }
  const rest = line.slice(last);
  if (rest || chord !== null) segments.push({ chord, text: rest });
  return segments;
}

const toInt = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

export function parseAccents(v: string | null | undefined): number[] | null {
  const list = (v ?? '').split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return list.length ? list : null;
}

/** Comma-separated tags keep their spelling; duplicates ignore case. */
export function parseTags(value: string): string[] {
  const seen = new Set<string>();
  return value.split(',').map((tag) => tag.replace(/[{}\r\n]/g, '').trim()).filter((tag) => {
    const key = tag.toLocaleLowerCase('uk');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseChordPro(src: string): ParsedSong {
  const meta: SongMeta = {
    title: '',
    tags: [],
    number: null,
    key: null,
    tempo: null,
    time: null,
    capo: null,
    rhythm: null,
    accents: null,
    notation: 'english',
    link: null,
  };
  let explicitNotation: Notation | null = null;
  const sections: Section[] = [];
  let current: Section = { kind: null, label: null, lines: [] };
  const chords = new Set<string>();
  const startSection = (kind: SectionKind, label: string | null) => {
    if (current.lines.length || current.label) sections.push(current);
    current = { kind, label, lines: [] };
  };

  const sourceLines = src.replace(/\r\n?/g, '\n').split('\n');
  let gridShape = DEFAULT_GRID_SHAPE;
  for (let index = 0; index < sourceLines.length; index++) {
    const raw = sourceLines[index];
    const line = raw.trimEnd();
    if (line.trimStart().startsWith('#')) continue;
    const d = parseDirective(line);
    if (d) {
      const v = (d.attributes?.label ?? d.value).trim();
      if (d.name === 'start_of_grid') {
        const body: string[] = [];
        while (index + 1 < sourceLines.length && parseDirective(sourceLines[index + 1])?.name !== 'end_of_grid') body.push(sourceLines[++index]);
        const closed = index + 1 < sourceLines.length;
        if (closed) index++;
        const grid = parseGridDirective(body.join('\n'), d, gridShape);
        if (!closed) grid.issues.push('unclosed');
        gridShape = grid.shape;
        for (const chord of gridChords(grid)) chords.add(chord);
        current.lines.push({ type: 'grid', grid });
        continue;
      }
      switch (d.name) {
        case 'title': meta.title = v; break;
        case 'tags': meta.tags = parseTags([...meta.tags, v].join(',')); break;
        case 'number': meta.number = toInt(v.replace(/^№\s*/, '')); break;
        case 'key': meta.key = v || null; break;
        case 'tempo': meta.tempo = toInt(v); break;
        case 'time': meta.time = v || null; break;
        case 'capo': meta.capo = toInt(v); break;
        case 'rhythm': meta.rhythm = v || null; break;
        case 'accents': meta.accents = parseAccents(v); break;
        case 'notation': explicitNotation = v.toLowerCase() === 'german' ? 'german' : 'english'; break;
        case 'comment': current.lines.push({ type: 'comment', text: v }); break;
        case 'link': meta.link = v || null; break;
        case 'chorus': {
          // Standard ChordPro recall: repeat the last chorus here.
          const last = [current, ...sections.slice().reverse()].find((x) => x.kind === 'chorus');
          startSection('chorus', v || last?.label || 'Приспів');
          // Notes such as «тихо» belong to one performance: drop the original's, and lead with comments that follow the recall.
          const notes: Line[] = [];
          for (let n = parseDirective(sourceLines[index + 1] ?? ''); n?.name === 'comment' && !partKind(n.value); n = parseDirective(sourceLines[index + 1] ?? '')) {
            notes.push({ type: 'comment', text: n.value.trim() });
            index++;
          }
          current.lines = [...notes, ...(last?.lines ?? []).filter((l) => l.type !== 'comment' || partKind(l.text))];
          startSection(null, null);
          break;
        }
        default:
          if (d.name in START) startSection(START[d.name], v || null);
          else if (d.name.startsWith('end_of_')) startSection(null, null);
      }
      continue;
    }
    if (!line.trim()) {
      current.lines.push({ type: 'empty' });
      continue;
    }
    const segments = parseLyricLine(line);
    for (const s of segments) if (s.chord) chords.add(s.chord);
    current.lines.push({ type: 'lyrics', segments });
  }
  startSection(null, null);

  const chordList = [...chords];
  meta.notation = explicitNotation ?? detectNotation(chordList);
  return { meta, sections: trimEmpty(sections), chords: chordList };
}

function trimEmpty(sections: Section[]): Section[] {
  for (const s of sections) {
    while (s.lines[0]?.type === 'empty') s.lines.shift();
    while (s.lines.at(-1)?.type === 'empty') s.lines.pop();
  }
  return sections.filter((s) => s.lines.length || s.label);
}

/** Lyrics without chords and directives, one line per lyric line. */
export function lyricsText(song: ParsedSong): string {
  const out: string[] = [];
  for (const s of song.sections)
    for (const l of s.lines)
      if (l.type === 'lyrics' && !isChordOnlyLine(l.segments)) out.push(l.segments.map((x) => x.text).join('').trim());
  return out.filter(Boolean).join('\n');
}

/** True when a line holds only chords (and bar marks / repeat marks). */
export function isChordOnlyLine(segments: Segment[]): boolean {
  return segments.some((s) => s.chord) && segments.every((s) => /^[\s|/:x×х\d()\-–—]*$/i.test(s.text));
}

/**
 * Bars of a chord-only line such as `| [Am] - [F] | [C] - [G] |`.
 * Chords inside one bar split it evenly. Null when the line has no bar lines.
 */
export function chordBars(segments: Segment[]): { bars: string[][]; rest: string } | null {
  const tokens: (string | null)[] = []; // chord, or null for a bar line
  let rest = '';
  for (const s of segments) {
    if (s.chord) tokens.push(s.chord);
    for (const part of s.text.split(/(\|+)/)) {
      if (part.startsWith('|')) tokens.push(null);
      else rest += ' ' + part;
    }
  }
  if (!tokens.includes(null)) return null;
  const bars: string[][] = [[]];
  for (const t of tokens) {
    if (t === null) bars.push([]);
    else bars.at(-1)!.push(t);
  }
  return { bars: bars.filter((b) => b.length), rest: rest.replace(/[\s:\-–—]+/g, ' ').trim() };
}

/** Denormalized columns the server stores next to the ChordPro source. */
export function songFields(src: string) {
  const { meta } = parseChordPro(src);
  return {
    number: meta.number,
    title: meta.title || 'Без назви',
    key: meta.key,
    bpm: meta.tempo,
    timeSig: meta.time,
    rhythm: meta.rhythm,
  };
}

/** Replaces the first `{name: …}` directive, or inserts it after `{title}` (or at the top). */
export function setDirective(src: string, name: string, value: string | number | null): string {
  const lines = src.split('\n');
  const idx = lines.findIndex((l) => parseDirective(l)?.name === name);
  const text = value === null ? null : `{${name}: ${value}}`;
  if (idx >= 0) {
    if (text === null) lines.splice(idx, 1);
    else lines[idx] = text;
  } else if (text !== null) {
    const t = lines.findIndex((l) => parseDirective(l)?.name === 'title');
    lines.splice(t + 1, 0, text);
  }
  return lines.join('\n');
}

export type PartKind = 'verse' | 'chorus' | 'bridge' | 'other';

const PART_RE =
  /^\s*(куплет|verse|приспів|припев|пр|chorus|бридж|брідж|мост|bridge|вступ|вступление|інтро|интро|intro|програш|проигрыш|interlude|instrumental|кода|кінцівка|концовка|outro|ending|тег|tag|передприспів|предприпев|pre-chorus)(?!\p{L})/iu;

/** Song part named by a label such as «Приспів x2» or «Куплет 1»; null for other comments. */
export function partKind(label: string): PartKind | null {
  const word = PART_RE.exec(label)?.[1].toLowerCase();
  if (!word) return null;
  if (/^(куплет|verse)$/.test(word)) return 'verse';
  if (/^(приспів|припев|пр|chorus)$/.test(word)) return 'chorus';
  if (/^(бридж|брідж|мост|bridge)$/.test(word)) return 'bridge';
  return 'other';
}

/** Directives the editor form owns; they live in the block at the top of the song. */
export const FORM_DIRECTIVES = ['title', 'number', 'key', 'tempo', 'time', 'capo', 'rhythm', 'accents', 'notation', 'link', 'tags'];

/**
 * Splits the leading block of form directives (and blank lines) from the rest.
 * `head + body` is always the original text, so the form never reorders anything.
 */
export function splitHeader(src: string): { head: string; body: string } {
  const lines = src.split('\n');
  let i = 0;
  while (i < lines.length && (!lines[i].trim() || FORM_DIRECTIVES.includes(parseDirective(lines[i])?.name ?? ''))) i++;
  if (i === lines.length) return { head: src, body: '' };
  return { head: lines.slice(0, i).map((l) => l + '\n').join(''), body: lines.slice(i).join('\n') };
}

/** Value of the first `{name: …}` directive, or null. */
export function getDirective(src: string, name: string): string | null {
  for (const line of src.split('\n')) {
    const d = parseDirective(line);
    if (d?.name === name) return d.value.trim();
  }
  return null;
}
