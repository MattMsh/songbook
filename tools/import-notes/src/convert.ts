import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isChord, partKind } from '@songbook/shared';
import { walk } from './fs';

// ---------- HTML → text ----------

const ENTITIES: Record<string, string> = {
  nbsp: '\u00a0', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", laquo: '«', raquo: '»',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', shy: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const BLOCK = /^(div|p|h[1-6]|li|ul|ol|tr|table|blockquote|pre)$/i;
const MONO_RE = /<tt\b|font-family:[^;">]*(menlo|courier|monaco|consolas|monospace)/i;

export function htmlToText(html: string): { text: string; mono: boolean; title: string | null } {
  const title = /<!--\s*title:\s*([\s\S]*?)\s*-->/.exec(html)?.[1] ?? null;
  const src = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\r?\n/g, '');
  let out = '';
  // A block boundary ends the current line only once, so nested divs and `<div><br></div>` don't double up.
  const endLine = () => {
    if (out && !out.endsWith('\n')) out += '\n';
  };
  for (const part of src.split(/(<[^>]*>)/)) {
    const tag = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(part);
    if (!tag) {
      out += decodeEntities(part);
    } else if (tag[2].toLowerCase() === 'br') {
      out += '\n';
    } else if (BLOCK.test(tag[2])) {
      endLine();
    }
  }
  return { text: out.replace(/\u00a0/g, ' ').replace(/\n+$/, ''), mono: MONO_RE.test(html), title };
}

// ---------- chord lines ----------

const LOOKALIKE: Record<string, string> = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', м: 'm', с: 'c' };
const REPEAT_RE = /^(\(?[xх×]\d+\)?|\(?\d+[xх×]\)?)$/i;
const PIECE_RE = /[^\s|()[\]\-–]+/g;

interface ChordPos { col: number; len: number; chord: string }

/** Chords with their columns if every token on the line is a chord; else null. */
export function chordLine(line: string): { chords: ChordPos[]; cyrillic: boolean; ratio: number } {
  const chords: ChordPos[] = [];
  let words = 0;
  let cyrillic = false;
  for (const tok of line.matchAll(/\S+/g)) {
    if (REPEAT_RE.test(tok[0])) continue;
    for (const p of tok[0].matchAll(PIECE_RE)) {
      if (REPEAT_RE.test(p[0])) continue;
      words++;
      let chord = p[0];
      if (!isChord(chord)) {
        const mapped = [...chord].map((ch) => LOOKALIKE[ch] ?? ch).join('');
        if (!isChord(mapped)) continue;
        chord = mapped;
        cyrillic = true;
      }
      chords.push({ col: tok.index! + p.index!, len: p[0].length, chord });
    }
  }
  return { chords, cyrillic, ratio: words ? chords.length / words : 0 };
}

const isChordLine = (r: ReturnType<typeof chordLine>) => r.chords.length > 0 && r.ratio === 1;

// Approximate glyph widths in em for the Notes default font (SF / Helvetica-like).
const NARROW = new Set([..." iljI.,:;!|'’ʼfrtії"]);
const WIDE = new Set([...'mwMWшщжюымШЩЖЮЫМДФ']);
export function charWidth(ch: string): number {
  if (NARROW.has(ch)) return 0.28;
  if (WIDE.has(ch)) return 0.85;
  if (/\d/.test(ch)) return 0.56;
  if (ch !== ch.toLowerCase()) return 0.65;
  return 0.53;
}
const textWidth = (s: string) => [...s].reduce((w, ch) => w + charWidth(ch), 0);

/** Lyric index whose visual offset is nearest to the chord column. */
function lyricIndex(chordText: string, col: number, lyric: string, mono: boolean): number {
  if (mono) return col;
  const x = textWidth(chordText.slice(0, col));
  let w = 0;
  for (let i = 0; i < lyric.length; i++) {
    const next = w + charWidth(lyric[i]);
    if (x < (w + next) / 2) return i;
    w = next;
  }
  return lyric.length;
}

export function mergeChords(chordText: string, chords: ChordPos[], lyricLine: string, mono: boolean): string {
  const lead = /^\s*/.exec(lyricLine)![0].length;
  const shift = (i: number) => Math.max(0, i - lead);
  const lyric = lyricLine.trim();
  const isLetter = (ch: string | undefined) => !!ch && /[\p{L}'’]/u.test(ch);
  const at = chords.map((c) => {
    let i = shift(lyricIndex(chordText, c.col, lyricLine, mono));
    // Chord drawn one char too far right lands inside a word: snap to the word start.
    if (i >= lyric.length) return lyric.length;
    if (isLetter(lyric[i - 1]) && !isLetter(lyric[i - 2])) i--;
    return i;
  });
  let out = lyric;
  for (let k = chords.length - 1; k >= 0; k--) {
    const i = at[k];
    const tag = `[${chords[k].chord}]`;
    out = i >= out.length && k === chords.length - 1 ? `${out}${out.endsWith(' ') ? '' : ' '}${tag}` : out.slice(0, i) + tag + out.slice(i);
  }
  return out;
}

const chordOnly = (line: string, chords: ChordPos[]) => {
  let out = line;
  for (const c of [...chords].reverse()) out = out.slice(0, c.col) + `[${c.chord}]` + out.slice(c.col + c.len);
  return out.trim();
};

// ---------- meta and sections ----------

const META: [RegExp, string][] = [
  [/^(тональність|тональность|key)$/i, 'key'],
  [/^(bpm|темп|tempo)$/i, 'tempo'],
  [/^(розмір|размер|time)$/i, 'time'],
  [/^(капо|capo)$/i, 'capo'],
  [/^(бій|бой|ритм|rhythm|strum)$/i, 'rhythm'],
];

function metaPart(part: string): [string, string] | null {
  // "4 cap" style: the number comes first.
  const capo = /^\s*(\d{1,2})\s*(?:cap|capo|капо|кап)\.?\s*$/i.exec(part);
  if (capo) return ['capo', capo[1]];
  const m = /^\s*([\p{L}]+)\s*(?:[:\-–—]\s*|\s+(?=\d))(.+?)\s*$/u.exec(part);
  if (!m) return null;
  const name = META.find(([re]) => re.test(m[1]))?.[1];
  if (!name) return null;
  let v = m[2];
  if (name === 'tempo' || name === 'capo') v = /\d+/.exec(v)?.[0] ?? '';
  if (name === 'time') v = /\d+\s*\/\s*\d+/.exec(v)?.[0].replace(/\s/g, '') ?? '';
  if (name === 'key') v = chordLine(v).chords[0]?.chord ?? '';
  return v ? [name, v] : null;
}

/** Meta pairs if the whole line is meta (several parts may be joined with `,` or `;`). */
export function metaLine(line: string): [string, string][] | null {
  if (!line.trim()) return null;
  const parts = line.split(/[,;]/).map(metaPart);
  return parts.every(Boolean) ? (parts as [string, string][]) : null;
}

const SECTION_RE =
  /^\s*(куплет|приспів|припев|пр|бридж|брідж|мост|програш|проигрыш|вступ|вступление|інтро|интро|кода|кінцівка|концовка|тег|передприспів|предприпев|verse|chorus|pre-chorus|bridge|intro|outro|interlude|instrumental|tag|ending)(?!\p{L})(\.?)\s*(\d*)\s*([:.]?)\s*(.*)$/iu;

export type SectionKind = 'chorus' | 'verse' | 'bridge' | null;

export function sectionHeader(line: string): { label: string; rest: string; kind: SectionKind } | null {
  const m = SECTION_RE.exec(line);
  if (!m) return null;
  const [, word, dot, num, sep] = m;
  let rest = m[5];
  // "Мост через реку" is a lyric; a header needs a separator, a number or nothing after it.
  if (rest && !sep && !num && !dot && !isChordLine(chordLine(rest)) && !REPEAT_RE.test(rest)) return null;
  // "ПРИСПІВ: x2" → label "Приспів x2".
  const repeat = REPEAT_RE.test(rest) ? ' ' + rest.replace(/[()]/g, '').replace(/[хХ×X]/, 'x') : '';
  if (repeat) rest = '';
  const name = word[0].toUpperCase() + word.slice(1).toLowerCase();
  const label = (name + dot + (num ? ' ' + num : '') + repeat).trim();
  const kind = partKind(word);
  return { label, rest, kind: kind === 'other' ? null : kind };
}

// ---------- note → ChordPro ----------

export interface Converted {
  chordpro: string;
  number: number | null;
  title: string;
  warnings: string[];
  chords: string[];
}

const TITLE_RE = /^\s*(?:№\s*(\d+)[.)]?|(\d+)\s*[.)]|(\d+)\s+(?=\p{L}))\s*(.*?)\s*$/u;
const URL_RE = /^https?:\/\/\S+$/;
const SECTION_TAGS = { chorus: ['{soc: ', '{eoc}'], verse: ['{sov: ', '{eov}'], bridge: ['{sob: ', '{eob}'] } as const;

/** Trailing "(H) (82)" in a title: a key and a tempo. */
function titleMeta(title: string): { title: string; meta: [string, string][] } {
  const meta: [string, string][] = [];
  let t = title;
  for (let m; (m = /\s*\(([^()]*)\)\s*$/.exec(t)); ) {
    const v = m[1].trim();
    const key = chordLine(v).chords;
    if (/^\d{2,3}$/.test(v) && +v >= 30 && +v <= 300) meta.unshift(['tempo', v]);
    else if (key.length === 1 && key[0].len === v.length) meta.unshift(['key', key[0].chord]);
    else break;
    t = t.slice(0, m.index);
  }
  // Notes titles are often in capitals; keep a readable sentence case.
  if (t === t.toUpperCase() && /\p{Lu}/u.test(t)) t = t[0] + t.slice(1).toLowerCase();
  return { title: t.trim(), meta };
}

export function convertNote(text: string, o: { mono?: boolean; fallbackTitle?: string } = {}): Converted {
  const mono = !!o.mono;
  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\u00a0/g, ' ').split('\n').map((l) => l.trimEnd());
  const warnings = new Set<string>();
  const meta: [string, string][] = [];
  const body: string[] = [];
  const chords = new Set<string>();
  const use = (r: ReturnType<typeof chordLine>) => {
    if (r.cyrillic) warnings.add('cyrillic_in_chords');
    r.chords.forEach((c) => chords.add(c.chord));
  };

  let i = lines.findIndex((l) => l.trim());
  let number: number | null = null;
  let title = o.fallbackTitle ?? '';
  if (i >= 0 && !isChordLine(chordLine(lines[i])) && !metaLine(lines[i])) {
    const m = TITLE_RE.exec(lines[i]);
    if (m) number = Number(m[1] ?? m[2] ?? m[3]);
    const parsed = titleMeta(m ? m[4] : lines[i].trim());
    title = parsed.title || title;
    meta.push(...parsed.meta);
    i++;
  }
  if (i < 0) i = lines.length;

  let open: SectionKind = null;
  let hadChorus = false;
  const close = () => {
    if (open) body.push(SECTION_TAGS[open][1]);
    open = null;
  };
  /** A section block needs content right under its header; a blank line ends it. */
  const hasContent = (from: number) => {
    const next = lines[from + 1];
    return !!next?.trim() && !sectionHeader(next) && !metaLine(next) && !URL_RE.test(next.trim());
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      close();
      body.push('');
      continue;
    }
    const m = metaLine(line);
    if (m) {
      meta.push(...m);
      continue;
    }
    if (URL_RE.test(line.trim())) {
      meta.push(['link', line.trim()]);
      continue;
    }
    const header = sectionHeader(line);
    if (header) {
      close();
      const content = !!header.rest || hasContent(i);
      if (header.kind === 'chorus' && hadChorus && !content) body.push(`{chorus: ${header.label}}`);
      else if (header.kind && content) {
        body.push(SECTION_TAGS[header.kind][0] + header.label + '}');
        open = header.kind;
        if (header.kind === 'chorus') hadChorus = true;
      } else body.push(`{c: ${header.label}}`);
      if (!header.rest) continue;
      const r = chordLine(header.rest);
      if (isChordLine(r)) {
        use(r);
        body.push(chordOnly(header.rest, r.chords));
      } else body.push(header.rest);
      continue;
    }
    const r = chordLine(line);
    if (isChordLine(r)) {
      use(r);
      const next = lines[i + 1];
      // A line with bar lines is an interlude, never chords over lyrics.
      const nextIsLyric =
        !line.includes('|') && next?.trim() && !isChordLine(chordLine(next)) && !sectionHeader(next) && !metaLine(next);
      if (nextIsLyric) {
        body.push(mergeChords(line, r.chords, next, mono));
        i++;
      } else body.push(chordOnly(line, r.chords));
      continue;
    }
    if (r.chords.length && r.ratio >= 0.5) warnings.add(`suspicious_chord_line: ${line.trim()}`);
    body.push(line.trim());
  }

  close();
  const chordList = [...chords];
  const head = [`{title: ${title || 'Без назви'}}`];
  if (number !== null) head.push(`{number: ${number}}`);
  else warnings.add('no_number');
  const seen = new Set<string>();
  for (const [k, v] of meta) if (!seen.has(k)) seen.add(k), head.push(`{${k}: ${v}}`);
  const keyIsH = meta.some(([k, v]) => k === 'key' && v.startsWith('H'));
  if (keyIsH || chordList.some((c) => /(^|\/)H/.test(c))) head.push('{notation: german}');
  if (!chordList.length) warnings.add('no_chords');
  // A song names B natural either H or B, never both; a mix is a typo.
  const letters = (re: RegExp) => chordList.some((c) => re.test(c));
  if (letters(/(^|\/)H/) && letters(/(^|\/)B(?![b♭])/)) warnings.add('mixed_h_b');

  const collapsed = body.filter((l, k) => l || body[k - 1]).join('\n').trim();
  return {
    chordpro: head.join('\n') + '\n\n' + collapsed + '\n',
    number,
    title: title || 'Без назви',
    warnings: [...warnings],
    chords: chordList,
  };
}

// ---------- report ----------

export interface ReportEntry { file: string; number: number | null; title: string; warnings: string[] }

export function buildReport(entries: ReportEntry[]) {
  const byNumber = new Map<number, string[]>();
  for (const e of entries) if (e.number !== null) byNumber.set(e.number, [...(byNumber.get(e.number) ?? []), e.file]);
  const duplicates = Object.fromEntries([...byNumber].filter(([, files]) => files.length > 1));
  for (const e of entries) if (e.number !== null && duplicates[e.number]) e.warnings.push('duplicate_number');
  return {
    total: entries.length,
    duplicateNumbers: duplicates,
    withoutNumber: entries.filter((e) => e.number === null).map((e) => e.file),
    withoutChords: entries.filter((e) => e.warnings.includes('no_chords')).map((e) => e.file),
    songs: entries,
  };
}

function main(argv: string[]) {
  const mono = argv.includes('--mono');
  const [inDir, outDir] = argv.filter((a) => !a.startsWith('--'));
  if (!inDir || !outDir) {
    console.error('Usage: convert <inputDir> <outDir> [--mono]');
    process.exit(1);
  }
  const entries: ReportEntry[] = [];
  for (const file of walk(inDir, ['.html', '.htm', '.txt'])) {
    const raw = readFileSync(file, 'utf8');
    const rel = relative(inDir, file);
    const isHtml = extname(file) !== '.txt';
    const parsed = isHtml ? htmlToText(raw) : { text: raw, mono: false, title: null };
    const r = convertNote(parsed.text, { mono: mono || parsed.mono, fallbackTitle: parsed.title ?? basename(file, extname(file)) });
    const out = join(outDir, rel.replace(/\.[^.]+$/, '.cho'));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, r.chordpro);
    entries.push({ file: rel, number: r.number, title: r.title, warnings: r.warnings });
  }
  const report = buildReport(entries);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Converted ${report.total} notes → ${outDir}`);
  console.log(`  duplicate numbers: ${Object.keys(report.duplicateNumbers).join(', ') || 'none'}`);
  console.log(`  without number: ${report.withoutNumber.length}, without chords: ${report.withoutChords.length}`);
  const warned = entries.filter((e) => e.warnings.length).length;
  if (warned) console.log(`  ${warned} songs with warnings, see report.json`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
