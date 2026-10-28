import { isChord } from './chords';

export interface GridCell {
  tokens: string[];
  /** UTF-16 offsets in the unchanged grid body, for lossless cell edits. */
  start: number;
  end: number;
}
export interface GridBar { opening: string; closing: string; cells: GridCell[] }
export interface GridRow {
  source: string;
  left: string;
  right: string;
  strum: boolean;
  showBars: boolean;
  bars: GridBar[];
  valid: boolean;
}
export interface GridShape { cells: number; left: number; right: number }
export interface ChordGrid {
  label: string;
  shape: GridShape;
  rows: GridRow[];
  source: string;
  issues: string[];
}
export const DEFAULT_GRID_SHAPE: GridShape = { cells: 16, left: 1, right: 1 };
const BAR = /^(?:\|\||\|\.|\|:|:\|:|:?\|\d+>?|:\||\|)$/;

export function parseGridShape(value: string): GridShape | null {
  const m = /^(?:(\d+)\+)?(\d+)(?:x(\d+))?(?:\+(\d+))?$/.exec(value);
  if (!m) return null;
  const cells = Number(m[2]) * Number(m[3] ?? 1);
  const left = Number(m[1] ?? 0), right = Number(m[4] ?? 0);
  // Bound layout sizes from imported files; never allocate according to untrusted dimensions.
  return cells >= 1 && cells <= 256 && left <= 32 && right <= 32 ? { cells, left, right } : null;
}

export function strumMark(token: string): { direction: 'up' | 'down' | 'mute'; technique: string; accent: boolean; symbol: string } | null {
  if (token === 'x') return { direction: 'mute', technique: '', accent: false, symbol: '×' };
  const m = /^(up|dn|u|d)([axs]?)(\+?)$/.exec(token);
  if (!m) return null;
  const direction = m[1].startsWith('u') ? 'up' : 'down';
  const technique = m[2];
  const accent = !!m[3];
  return { direction, technique, accent,
    symbol: (direction === 'up' ? '↑' : '↓') + ({ a: '≈', x: '×', s: '·' }[technique] ?? '') + (accent ? '!' : '') };
}

export function gridCellText(cell: GridCell, strum: boolean, mapChord: (chord: string) => string): string {
  return cell.tokens.map(token => {
    if (!token || token === '.') return '·';
    if (strum) { const mark = strumMark(token); if (mark) return mark.symbol; }
    return isChord(token) ? mapChord(token) : token;
  }).join(' ');
}

/** Parse static ChordPro grids. Repeats remain notation; this does not expand a performance timeline. */
export function parseGrid(source: string, options: { shape?: string; label?: string } = {}, previous = DEFAULT_GRID_SHAPE): ChordGrid {
  const shape = options.shape ? parseGridShape(options.shape) : previous;
  const issues: string[] = shape ? [] : ['shape'];
  let offset = 0;
  const rows: GridRow[] = [];
  for (const raw of source.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const line = raw.replace(/[\r\n]+$/, '');
    if (line.trimStart().startsWith('#')) { offset += raw.length; continue; }
    const tokens = [...line.matchAll(/\S+/g)];
    const boundaries: { index: number; symbol: string }[] = [];
    let strum = false, showBars = true;
    for (const [index, match] of tokens.entries()) {
      let symbol = match[0];
      if (!boundaries.length && /[sS]$/.test(symbol) && BAR.test(symbol.slice(0, -1))) {
        strum = true;
        showBars = symbol.endsWith('S');
        symbol = symbol.slice(0, -1);
      }
      if (BAR.test(symbol)) boundaries.push({ index, symbol });
    }
    const bars: GridBar[] = [];
    let valid = true;
    for (let b = 0; b < boundaries.length - 1; b++) {
      const a = boundaries[b], z = boundaries[b + 1];
      const cells = tokens.slice(a.index + 1, z.index).map(match => {
        const parts = match[0].split('~');
        if (parts.some(token => token && !['.', '/', '%', '%%'].includes(token) && !isChord(token) && !(strum && strumMark(token)))) valid = false;
        return { tokens: parts, start: offset + match.index!, end: offset + match.index! + match[0].length };
      });
      const repeats = cells.flatMap(cell => cell.tokens).filter(token => token === '%' || token === '%%');
      if (repeats.length && (repeats.length > 1 || cells.some(cell => cell.tokens.length > 1 || cell.tokens.some(token => !['', '.', '%', '%%'].includes(token))))) valid = false;
      bars.push({ opening: a.symbol, closing: z.symbol, cells });
    }
    if (boundaries.length === 1) valid = false;
    const first = boundaries[0], last = boundaries.at(-1);
    const left = first ? line.slice(0, tokens[first.index].index).trim() : line;
    const right = last ? line.slice(tokens[last.index].index! + tokens[last.index][0].length).trim() : '';
    if (!valid) issues.push('row');
    if (line.trim()) rows.push({ source: line, left, right, strum, showBars, bars, valid });
    offset += raw.length;
  }
  for (const strum of [false, true]) {
    const measures = rows.filter(row => row.strum === strum).flatMap(row => row.bars.map(bar => ({ row, bar })));
    measures.forEach(({ row, bar }, index) => {
      if (bar.cells.some(cell => cell.tokens.includes('%%'))) {
        const next = measures[index + 1]?.bar;
        if (!next || next.cells.some(cell => cell.tokens.some(token => token && token !== '.'))) {
          row.valid = false;
          issues.push('row');
        }
      }
    });
  }
  return { label: options.label ?? '', shape: shape ?? previous, rows, source, issues: [...new Set(issues)] };
}

export function parseGridDirective(source: string, directive: { value: string; attributes?: Record<string, string> }, previous = DEFAULT_GRID_SHAPE): ChordGrid {
  const legacy = directive.value.trim().split(/\s+/);
  const grid = parseGrid(source, {
    shape: directive.attributes?.shape ?? (directive.value.trim() ? legacy[0] : undefined),
    label: directive.attributes?.label ?? legacy.slice(1).join(' '),
  }, previous);
  if (directive.attributes && Object.keys(directive.attributes).some(key => !['shape', 'label'].includes(key))) grid.issues.push('attributes');
  return grid;
}

export function gridChords(grid: ChordGrid): string[] {
  return grid.rows.flatMap(row => row.bars.flatMap(bar => bar.cells.flatMap(cell => cell.tokens.filter(isChord))));
}

export function repeatGridBar(source: string, bar: GridBar): string {
  if (bar.cells.some(cell => source.slice(cell.start, cell.end) !== cell.tokens.join('~'))) return source;
  return bar.cells.reduceRight((body, cell, index) => replaceGridCell(body, cell, index === 0 ? '%' : '.'), source);
}

export function replaceGridCell(source: string, cell: GridCell, token: string): string {
  if (cell.start < 0 || cell.end > source.length || source.slice(cell.start, cell.end) !== cell.tokens.join('~')) return source;
  if (!token || /[\s{}|]/.test(token)) return source;
  return source.slice(0, cell.start) + token + source.slice(cell.end);
}
