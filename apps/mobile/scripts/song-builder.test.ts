import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { metaInput, setMetaInput } from '../src/lib/song-meta';
import { parseChordPro, splitHeader } from '@songbook/shared';
import { insertChord, newBlock, newGridBlock, readBlocks, splitBlock, writeBlocks } from '../src/lib/song-builder';

describe('lossless song blocks', () => {
  it.each([
    '', '{c: Куплет 1}\n', '{c: Приспів}',
    'Unlabelled intro\n\n{c: Куплет 1}\n[Am]Слова  \n\n{comment: Приспів x2}\n[C]Інші слова\n',
    '{c: Verse 1}\r\n[G]First\r\n{c: Chorus}\r\nLast',
  ])('preserves untouched source %s', source => {
    expect(writeBlocks(readBlocks(source)!)).toBe(source);
  });
  it.each(['{soc}\n[Am]Words\n{eoc}', '{custom: value}\nWords', '{c: softly}\nWords', '{chorus}'])('keeps unsupported source out of the visual builder', source => {
    expect(readBlocks(source)).toBeNull();
  });
  it('adds a separator when a title or lyrics lack a trailing newline', () => {
    const blocks = readBlocks('{c: Куплет 1}')!;
    blocks[0].text = '[C]First';
    blocks.push(newBlock('Приспів', '[G]Second'));
    const result = writeBlocks(blocks);
    expect(result).toBe('{c: Куплет 1}\n[C]First\n{c: Приспів}\n[G]Second');
    expect(parseChordPro(result).chords).toEqual(['C', 'G']);
  });
  it('preserves unlabelled lyrics as a separate block after reorder', () => {
    const blocks = readBlocks('Intro\n{c: Приспів}\nChorus')!;
    const moved = readBlocks(writeBlocks([blocks[1], blocks[0]]))!;
    expect(moved).toHaveLength(2);
    expect(moved.map(b => b.text.trim())).toEqual(['Chorus', 'Intro']);
  });
  it('splits before the selected line without losing lyrics or chord tags', () => {
    const block = newBlock('Куплет 1', '[Am]First line\n[G]Second line\nThird');
    const parts = splitBlock(block, block.text.indexOf('Second') + 2, 'Приспів');
    expect(parts).toHaveLength(2);
    expect(parts.map(b => b.text).join('')).toBe(block.text);
    expect(parts[1].text).toBe('[G]Second line\nThird');
    expect(readBlocks(writeBlocks(parts))).toEqual(parts);
  });
  it('does not create empty blocks at the start or after the last line', () => {
    const block = newBlock('Куплет 1', '\nWords\n');
    expect(splitBlock(block, 0, 'Приспів')).toEqual([block]);
    expect(splitBlock(block, block.text.length, 'Приспів')).toEqual([block]);
  });
});

describe('grid blocks', () => {
  it('keeps the published example valid and editable without source changes', () => {
    const source = readFileSync(new URL('../../../songs/005-razom-u-svitli.cho', import.meta.url), 'utf8');
    const parsed = parseChordPro(source);
    expect(parsed.meta).toMatchObject({ number: 905, key: 'C', tempo: 84, time: '4/4' });
    const grids = parsed.sections.flatMap(section => section.lines.flatMap(line => line.type === 'grid' ? [line.grid] : []));
    expect(grids).toHaveLength(5);
    for (const grid of grids) {
      expect(grid.issues).toEqual([]);
      for (const row of grid.rows) {
        expect(row.valid).toBe(true);
        expect(row.bars.reduce((count, bar) => count + bar.cells.length, 0)).toBe(grid.shape.cells);
      }
    }
    const { body } = splitHeader(source);
    const blocks = readBlocks(body);
    expect(blocks).not.toBeNull();
    expect(writeBlocks(blocks!)).toBe(body);
  });
  it.each([
    '{sog: 4 Intro}\r\n| C  . G/B . |\r\n{eog}\r\n\r\n',
    '{c: Куплет 1}\n[A]Words\n{start_of_grid shape="1x4" label="Вступ"}\n|S dn~up . dx x |\n{end_of_grid}\nUnlabelled words\n{c: Приспів}\nMore',
    '{sog}\n| C . |\n{eog}',
  ])('round-trips grid source without normalization', source => {
    expect(writeBlocks(readBlocks(source)!)).toBe(source);
  });
  it('creates standard grids and strums and can reorder them', () => {
    const grid = newGridBlock('Сітка');
    const strum = newGridBlock('Бій', true);
    const blocks = readBlocks(writeBlocks([grid, newBlock('Куплет 1', '[C]Words'), strum]))!;
    expect(blocks.map(b => b.kind)).toEqual(['grid', undefined, 'grid']);
    const reordered = writeBlocks([blocks[2], blocks[0], blocks[1]]);
    expect(reordered.indexOf('|S')).toBeLessThan(reordered.indexOf('| . . . . |'));
    expect(parseChordPro(reordered).sections.flatMap(s => s.lines).filter(l => l.type === 'grid')).toHaveLength(2);
  });
  it('falls back to source for unclosed or nested grid environments', () => {
    expect(readBlocks('{sog}\n| C |')).toBeNull();
    expect(readBlocks('{sog}\n{custom: keep}\n{eog}')).toBeNull();
  });
  it('keeps endings intact when a grid body is edited without a trailing newline', () => {
    const block = newGridBlock('Бій', true);
    block.text = '|S d+ . up x |';
    expect(writeBlocks([block])).toContain('|S d+ . up x |\n{end_of_grid}');
    expect(newGridBlock('Bad"\n{title: x}').marker).not.toContain('\n{title:');
  });
});

describe('metadata typing', () => {
  it('keeps spaces between words while typing title and tags', () => {
    let head = setMetaInput('', 'title', 'First ');
    expect(metaInput(head, 'title')).toBe('First ');
    head = setMetaInput(head, 'title', metaInput(head, 'title') + 'word');
    expect(parseChordPro(head).meta.title).toBe('First word');
    head = setMetaInput(head, 'tags', 'worship, ');
    expect(metaInput(head, 'tags')).toBe('worship, ');
  });
  it('retains a rhythm separator for the next stroke', () => {
    let head = setMetaInput('', 'rhythm', '↓ ');
    head = setMetaInput(head, 'rhythm', metaInput(head, 'rhythm') + '↑');
    expect(parseChordPro(head).meta.rhythm).toBe('↓ ↑');
  });
  it('keeps unknown directives and sanitizes field input', () => {
    const head = '{custom: keep}\n{time: 11/16}\n{t: Old}\n\n';
    const next = setMetaInput(head, 'title', 'New\n{title: bad}');
    expect(next).toContain('{custom: keep}');
    expect(next).toContain('{time: 11/16}');
    expect(parseChordPro(next).meta.title).toBe('New title: bad');
    expect(metaInput(setMetaInput(next, 'title', ''), 'title')).toBe('');
  });
});

describe('chord insertion', () => {
  it('inserts at the cursor and replaces a selection', () => {
    expect(insertChord('First second', { start: 6, end: 6 }, 'Am')).toEqual({ text: 'First [Am]second', cursor: 10 });
    expect(insertChord('Old', { start: 0, end: 3 }, 'C').text).toBe('[C]');
  });
  it('does not corrupt a chord when the cursor is inside its tag', () => {
    expect(insertChord('[Am]Words', { start: 2, end: 2 }, 'G').text).toBe('[Am][G]Words');
  });
  it('can insert before or replace the first chord', () => {
    expect(insertChord('[Am]Words', { start: 0, end: 0 }, 'G').text).toBe('[G][Am]Words');
    expect(insertChord('[Am]Words', { start: 0, end: 4 }, 'G').text).toBe('[G]Words');
  });
  it('bounds a stale selection and keeps bar spacing', () => {
    expect(insertChord('|', { start: 100, end: 200 }, 'Am')).toEqual({ text: '| [Am]', cursor: 6 });
  });
});
