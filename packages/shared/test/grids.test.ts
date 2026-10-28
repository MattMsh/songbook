import { describe, expect, it } from 'vitest';
import { chordContext } from '../src/chords';
import { lyricsText, parseChordPro, parseDirective } from '../src/chordpro';
import { gridCellText, parseGrid, parseGridShape, repeatGridBar, replaceGridCell, strumMark } from '../src/grids';
import { buildPdfHtml } from '../src/pdf';

const source = '{title: Схема}\n{key: C}\n{start_of_grid shape="1+2x4+1" label="Вступ"}\nA |: C . G/B . | Am~G . / . :| x2\n|S d+~up dn~up dx ua | . . . x |\n{end_of_grid}\n[C]Слова';
const grids = (src: string) => parseChordPro(src).sections.flatMap(s => s.lines).filter(l => l.type === 'grid').map(l => l.grid);

describe('ChordPro grids', () => {
  it('parses quoted attributes and leaves legacy directive values intact', () => {
    expect(parseDirective('{start_of_grid shape="2x4" label="Вступ до пісні"}')?.attributes).toEqual({ shape: '2x4', label: 'Вступ до пісні' });
    expect(parseDirective('{sog: 2x4 Вступ}')).toEqual({ name: 'start_of_grid', value: '2x4 Вступ' });
    expect(parseDirective('{title: A = B}')).toEqual({ name: 'title', value: 'A = B' });
    expect(parseDirective('{sog shape="unterminated}')).toBeNull();
    expect(parseDirective('{sog shape="4"label="bad"}')).toBeNull();
    expect(parseDirective('{sog label="a\\"b"}')?.attributes?.label).toBe('a"b');
  });
  it('keeps margins, subdivisions, repeat barlines and source', () => {
    const grid = grids(source)[0];
    expect(grid.label).toBe('Вступ');
    expect(grid.shape).toEqual({ left: 1, cells: 8, right: 1 });
    expect(grid.rows[0].left).toBe('A');
    expect(grid.rows[0].right).toBe('x2');
    expect(grid.rows[0].bars.map(b => [b.opening, b.closing])).toEqual([['|:', '|'], ['|', ':|']]);
    expect(grid.rows[0].bars[1].cells[0].tokens).toEqual(['Am', 'G']);
    expect(grid.source).toContain('Am~G');
    expect(lyricsText(parseChordPro(source))).toBe('Слова');
  });
  it('includes grid chords in notation detection and transposition', () => {
    const song = parseChordPro('{sog}\n| Hm . F#/A# . |\n{eog}');
    expect(song.chords).toEqual(['Hm', 'F#/A#']);
    expect(song.meta.notation).toBe('german');
    const ctx = chordContext({ key: 'Bm', chords: song.chords, notation: 'german', display: 'english', transpose: 2, capo: 0 });
    const grid = grids('{sog}\n| Hm . F#/A# . |\n{eog}')[0];
    expect(gridCellText(grid.rows[0].bars[0].cells[0], false, ctx.map)).toBe('C#m');
    expect(gridCellText(grid.rows[0].bars[0].cells[2], false, ctx.map)).toBe('G#/C');
  });
  it('inherits shapes, supports legacy labels, and bounds imported dimensions', () => {
    const result = grids('{sog: 1+2x3+2 Intro}\n| C . . | G . . |\n{eog}\n{sog}\n| F . . | C . . |\n{eog}');
    expect(result[0].shape).toEqual({ left: 1, cells: 6, right: 2 });
    expect(result[1].shape).toEqual(result[0].shape);
    expect(parseGridShape('999999x999999')).toBeNull();
    expect(parseGridShape('0')).toBeNull();
    expect(parseGridShape('4x4garbage')).toBeNull();
    expect(grids('{sog shape="999999x999999"}\n| C |\n{eog}')[0].issues).toContain('shape');
  });
  it('preserves unsupported, malformed and unclosed grids with diagnostics', () => {
    const grid = grids('{sog cc="verse"}\n| C unsupported |\n{eog}')[0];
    expect(grid.rows[0].valid).toBe(false);
    expect(grid.rows[0].source).toBe('| C unsupported |');
    expect(grid.issues).toEqual(['row', 'attributes']);
    expect(grids('{sog}\n| C . |')[0].issues).toContain('unclosed');
    expect(grids('{sog}\n| C .')[0].rows[0].valid).toBe(false);
  });
  it('does not transpose strum marks, repeats or empty subdivisions', () => {
    const grid = parseGrid('|s ~up d+ ua+ dx ds x |');
    expect(grid.rows[0].strum).toBe(true);
    expect(grid.rows[0].showBars).toBe(false);
    const texts = grid.rows[0].bars[0].cells.map(c => gridCellText(c, true, () => 'WRONG'));
    expect(texts).toEqual(['· ↑', '↓!', '↑≈!', '↓×', '↓·', '×']);
    expect(parseGrid('|S dn up |').rows[0].showBars).toBe(true);
    expect(strumMark('unsafe')).toBeNull();
  });
  it.each(['|1', ':|2', ':|2>', '||', '|.', '|:', ':|', ':|:'])('retains barline %s', barline => {
    const grid = parseGrid(`| C . ${barline}`);
    expect(grid.rows[0].bars[0].closing).toBe(barline);
  });
  it('preserves valid repeat signs and diagnoses conflicting repeat content', () => {
    expect(parseGrid('| % . . . | %% . . . | . . . . |').issues).toEqual([]);
    expect(parseGrid('| % C |').issues).toContain('row');
    expect(parseGrid('| %% . | C . |').issues).toContain('row');
    expect(parseGrid('| %% . |\n|S . . |').issues).toContain('row');
    expect(parseGrid('| %% . |\n|S d up |\n| . . |').issues).toEqual([]);
    const body = '| C  . G . |';
    expect(repeatGridBar(body, parseGrid(body).rows[0].bars[0])).toBe('| %  . . . |');
    expect(parseGrid('# hidden comment\n| C . |').rows).toHaveLength(1);
  });
  it('edits one cell without normalizing whitespace, CRLF or other content', () => {
    const body = 'Intro | C   . | End\r\n|S dn~up . |\r\n';
    const grid = parseGrid(body);
    const cell = grid.rows[1].bars[0].cells[0];
    expect(replaceGridCell(body, cell, 'd+~up')).toBe(body.replace('dn~up', 'd+~up'));
    expect(replaceGridCell('changed', cell, 'G')).toBe('changed');
    expect(replaceGridCell(body, cell, '{title: bad}')).toBe(body);
  });
  it('renders escaped, transposed grids and strums in musician PDF only', () => {
    const doc = { title: 'План', variant: 'musician' as const, labels: { verse: 'Куплет', chorus: 'Приспів', bridge: 'Бридж', key: 'Key', capo: 'Capo', leader: 'Leader', notes: 'Notes' },
      songs: [{ chordpro: '{key: C}\n{sog label="<script>bad</script>"}\n| C . G/B . |\n|S d+ up dx x |\n{eog}\n[C]Слова', settings: { transpose: 2 } }] };
    const html = buildPdfHtml(doc);
    expect(html).toContain('class="chord-grid"');
    expect(html).toContain('>D</span>');
    expect(html).toContain('>A/C#</span>');
    expect(html).toContain('--grid-cell-width:2.8em');
    expect(html).toContain('↓!');
    expect(html).toContain('↓×');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    const lyrics = buildPdfHtml({ ...doc, variant: 'lyrics' });
    expect(lyrics).not.toContain('class="chord-grid"');
    expect(lyrics).not.toContain('↓');
    expect(lyrics).toContain('Слова');
    const fallback = buildPdfHtml({ ...doc, songs: [{ chordpro: '{sog unsupported="x"}\n| C . |\n{eog}', settings: { transpose: 2 } }] });
    expect(fallback).toContain('Original grid (not transposed)');
    expect(fallback).toContain('| C . |');
    const hiddenBars = buildPdfHtml({ ...doc, songs: [{ chordpro: '{sog}\n| C . |\n|s d up |\n{eog}' }] });
    expect(hiddenBars).toContain('class="grid-barline"></span>');
  });
});
