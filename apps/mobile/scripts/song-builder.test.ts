import { describe, expect, it } from 'vitest';
import { metaInput, setMetaInput } from '../src/lib/song-meta';
import { parseChordPro } from '@songbook/shared';
import { insertChord, newBlock, readBlocks, splitBlock, writeBlocks } from '../src/lib/song-builder';

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
