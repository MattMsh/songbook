import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseChordPro } from '@songbook/shared';
import { buildReport, chordLine, convertNote, htmlToText, metaLine, sectionHeader } from '../src/convert';
import { songId, toSql } from '../src/to-sql';

const nb = (n: number) => '&nbsp;'.repeat(n);
/** Apple Notes body: one `<div>` per line, `<div><br></div>` for blank lines. */
const note = (lines: string[], title = '') =>
  `<!-- title: ${title} -->\n<div><b><span style="font-size: 24px">${lines[0]}</span></b></div>\n` +
  lines.slice(1).map((l) => (l ? `<div>${l}</div>` : '<div><br></div>')).join('\n');

describe('htmlToText', () => {
  it('turns Notes divs into lines with single blank lines', () => {
    const html = '<div>12. Слава</div>\n<div><br></div>\n<div>Рядок&nbsp;один</div><div><div>вкладений</div></div><div>a<br></div><div>b &amp; &lt;c&gt; &#39;d&#39; &#x263A;</div>';
    const r = htmlToText(html);
    expect(r.text).toBe("12. Слава\n\nРядок один\nвкладений\na\nb & <c> 'd' ☺");
    expect(r.mono).toBe(false);
  });

  it('keeps leading spaces and detects monospace', () => {
    expect(htmlToText(`<div><tt>${nb(3)}Am</tt></div>`)).toMatchObject({ text: '   Am', mono: true });
    expect(htmlToText('<div><span style="font-family: Menlo">x</span></div>').mono).toBe(true);
    expect(htmlToText('<!-- title: Моя пісня -->\n<div>x</div>').title).toBe('Моя пісня');
  });
});

describe('line classification', () => {
  it('detects chord lines', () => {
    expect(chordLine('Am   F  C G').ratio).toBe(1);
    expect(chordLine('| Am | F | x2').chords.map((c) => c.chord)).toEqual(['Am', 'F']);
    expect(chordLine('Am-F-C (2x)').chords.map((c) => c.chord)).toEqual(['Am', 'F', 'C']);
    expect(chordLine('Слава Тобі').chords).toHaveLength(0);
    const cyr = chordLine('Ам  С  Е');
    expect(cyr.chords.map((c) => c.chord)).toEqual(['Am', 'C', 'E']);
    expect(cyr.cyrillic).toBe(true);
  });

  it('parses meta lines', () => {
    expect(metaLine('Тональність: Am')).toEqual([['key', 'Am']]);
    expect(metaLine('Темп - 72 bpm, Размер: 6/8')).toEqual([['tempo', '72'], ['time', '6/8']]);
    expect(metaLine('BPM 120')).toEqual([['tempo', '120']]);
    expect(metaLine('Капо: 2; Бій: ↓ ↓↑ ↑↓↑')).toEqual([['capo', '2'], ['rhythm', '↓ ↓↑ ↑↓↑']]);
    expect(metaLine('Темний ліс навколо')).toBeNull();
  });

  it('recognises section headers with Cyrillic word boundaries', () => {
    expect(sectionHeader('Приспів:')).toEqual({ label: 'Приспів', rest: '', kind: 'chorus' });
    expect(sectionHeader('Пр.')).toEqual({ label: 'Пр.', rest: '', kind: 'chorus' });
    expect(sectionHeader('Куплет 2')).toEqual({ label: 'Куплет 2', rest: '', kind: 'verse' });
    expect(sectionHeader('Припев: Слава Тебе')).toEqual({ label: 'Припев', rest: 'Слава Тебе', kind: 'chorus' });
    expect(sectionHeader('ПРИСПІВ: x2')).toEqual({ label: 'Приспів x2', rest: '', kind: 'chorus' });
    expect(sectionHeader('OUTRO:')).toEqual({ label: 'Outro', rest: '', kind: null });
    expect(sectionHeader('Прийди, Господи')).toBeNull();
    expect(sectionHeader('Мост через реку')).toBeNull();
    expect(sectionHeader('Chorus')).toEqual({ label: 'Chorus', rest: '', kind: 'chorus' });
  });
});

describe('convertNote', () => {
  it('builds ChordPro from a monospace note', () => {
    const r = convertNote(
      ['12. Слава Тобі', 'Тональність: Am', 'Темп: 72', '', 'Куплет 1:', 'Am     F', 'Слава Тобі', '', 'Програш: Am | F | C | G x2'].join('\n'),
      { mono: true },
    );
    expect(r.number).toBe(12);
    expect(r.title).toBe('Слава Тобі');
    expect(r.chordpro).toBe(
      '{title: Слава Тобі}\n{number: 12}\n{key: Am}\n{tempo: 72}\n\n{sov: Куплет 1}\n[Am]Слава [F]Тобі\n{eov}\n\n{c: Програш}\n[Am] | [F] | [C] | [G] x2\n',
    );
    expect(r.warnings).toEqual([]);
  });

  it('keeps the bar notation of chord-only lines', () => {
    expect(convertNote('1. X\nВступ: | Am - F | C - G |').chordpro).toContain('{c: Вступ}\n| [Am] - [F] | [C] - [G] |');
    expect(convertNote('1. X\n| Am - F | C - G |\nСлава Тобі').chordpro).toContain('| [Am] - [F] | [C] - [G] |\nСлава Тобі');
  });

  it('snaps a chord that lands one letter inside a word', () => {
    expect(convertNote('1. X\n G\nСвітло', { mono: true }).chordpro).toContain('[G]Світло');
    expect(convertNote('1. X\nC         G\nАлілуя', { mono: true }).chordpro).toContain('[C]Алілуя [G]');
  });

  it('maps chord positions by visual width for proportional Notes text', () => {
    // In Notes the author aligned F over «Тобі» with spaces; by char index it would land in «Тобі» → «То|бі».
    const html = note(['7. Слава', `Am${nb(6)}F${nb(6)}C`, 'Слава Тобі, Господи']);
    const { text, mono } = htmlToText(html);
    expect(mono).toBe(false);
    expect(convertNote(text).chordpro).toContain('[Am]Слава [F]Тобі, [C]Господи');
    expect(convertNote(text, { mono: true }).chordpro).not.toContain('[F]Тобі');
  });

  it('marks German notation, Cyrillic chords and missing data', () => {
    expect(convertNote('5. Пісня\nHm   G\nСлава Тобі').chordpro).toContain('{notation: german}');
    const cyr = convertNote('6. Пісня\nАм\nСлава');
    expect(cyr.chordpro).toContain('[Am]Слава');
    expect(cyr.warnings).toContain('cyrillic_in_chords');
    const plain = convertNote('Без номера\nПросто текст', { fallbackTitle: 'file' });
    expect(plain.title).toBe('Без номера');
    expect(plain.warnings).toEqual(expect.arrayContaining(['no_number', 'no_chords']));
    expect(convertNote('8. Пісня\nAm і F').warnings.some((w) => w.startsWith('suspicious_chord_line'))).toBe(true);
    expect(convertNote('9. Пісня\nHm   Bm\nСлава Тобі').warnings).toContain('mixed_h_b');
    expect(convertNote('10. Пісня\nHm   Bb\nСлава Тобі').warnings).not.toContain('mixed_h_b');
  });

  it('handles a full Apple Notes HTML note', () => {
    const html = note(
      ['№3 Дорога', 'Розмір: 6/8', 'Бій: ↓ ↓↑ ↓', '', 'Пр.', `Em${nb(9)}C`, 'Будь зі мною, будь', '', 'Прийди до нас'],
      'Дорога',
    );
    const { text } = htmlToText(html);
    const r = convertNote(text);
    expect(r.number).toBe(3);
    const song = parseChordPro(r.chordpro);
    expect(song.meta).toMatchObject({ title: 'Дорога', number: 3, time: '6/8', rhythm: '↓ ↓↑ ↓' });
    expect(song.chords).toEqual(['Em', 'C']);
    expect(r.chordpro).toContain('{soc: Пр.}\n[Em]Будь зі [C]мною, будь\n{eoc}\n\nПрийди до нас');
  });

  it('converts a chords-only arrangement note (real format)', () => {
    const tt = (l: string) => `<tt>${l}</tt>`;
    const html = note(
      [
        '2 СПІВАЮ АЛІЛУЯ (H) (82)',
        '4 cap',
        'КУПЛЕТ:',
        tt('G | G | G | G – x4'),
        'ПРИСПІВ: x2',
        tt('C | G | Em | D – x2'),
        'КУПЛЕТ:',
        tt('G | G | C | C | Em | Em | D | D – x2'),
        'ПРИСПІВ: x2',
        'БРИДЖ: x3',
        tt('G | G | D | D | Em | Em | C | C'),
        'ПРИСПІВ: x2',
        'OUTRO:',
        'ПРИСПІВ: x2',
        '',
        'https://holychords.pro/41076',
      ],
      '2 СПІВАЮ АЛІЛУЯ (H) (82)',
    );
    const { text, mono } = htmlToText(html);
    expect(mono).toBe(true);
    const r = convertNote(text);
    expect(r.chordpro).toBe(
      [
        '{title: Співаю алілуя}',
        '{number: 2}',
        '{key: H}',
        '{tempo: 82}',
        '{capo: 4}',
        '{link: https://holychords.pro/41076}',
        '{notation: german}',
        '',
        '{sov: Куплет}',
        '[G] | [G] | [G] | [G] – x4',
        '{eov}',
        '{soc: Приспів x2}',
        '[C] | [G] | [Em] | [D] – x2',
        '{eoc}',
        '{sov: Куплет}',
        '[G] | [G] | [C] | [C] | [Em] | [Em] | [D] | [D] – x2',
        '{eov}',
        '{chorus: Приспів x2}',
        '{sob: Бридж x3}',
        '[G] | [G] | [D] | [D] | [Em] | [Em] | [C] | [C]',
        '{eob}',
        '{chorus: Приспів x2}',
        '{c: Outro}',
        '{chorus: Приспів x2}',
        '',
      ].join('\n'),
    );
    expect(r.warnings).toEqual([]);
    const song = parseChordPro(r.chordpro);
    expect(song.meta).toMatchObject({ key: 'H', capo: 4, tempo: 82, notation: 'german', link: 'https://holychords.pro/41076' });
    expect(song.sections.filter((x) => x.kind === 'chorus')).toHaveLength(4);
  });

  it('reports duplicate numbers', () => {
    const report = buildReport([
      { file: 'a.html', number: 1, title: 'A', warnings: [] },
      { file: 'b.html', number: 1, title: 'B', warnings: ['no_chords'] },
      { file: 'c.html', number: null, title: 'C', warnings: ['no_number'] },
    ]);
    expect(report.duplicateNumbers).toEqual({ 1: ['a.html', 'b.html'] });
    expect(report.withoutNumber).toEqual(['c.html']);
    expect(report.withoutChords).toEqual(['b.html']);
    expect(report.songs[0].warnings).toContain('duplicate_number');
  });
});

describe('to-sql', () => {
  it('uses stable ids and escapes text', () => {
    expect(songId('sub/song.cho')).toBe(songId('sub/song'));
    expect(songId('a')).not.toBe(songId('b'));
    const sql = toSql([{ rel: 'a.cho', chordpro: "{title: П'ять}\n{number: 5}\n[C]Текст" }], 42);
    expect(sql).toContain("'П''ять'");
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE');
    expect(sql).toContain(', 1, 42, NULL)');
    expect(sql.indexOf('SET number = NULL')).toBeLessThan(sql.indexOf('INSERT INTO songs'));
  });

  it('fails on duplicate numbers', () => {
    expect(() =>
      toSql([
        { rel: 'a.cho', chordpro: '{title: A}\n{number: 1}' },
        { rel: 'b.cho', chordpro: '{title: B}\n{number: 1}' },
      ]),
    ).toThrow(/Duplicate number 1/);
  });
});

describe('demo songs', () => {
  const dir = join(import.meta.dirname, '../../../songs');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.cho'))) {
    it(`${file} parses`, () => {
      const song = parseChordPro(readFileSync(join(dir, file), 'utf8'));
      expect(song.meta.title).toBeTruthy();
      expect(song.meta.number).toBeGreaterThan(0);
      expect(song.meta.key).toBeTruthy();
      expect(song.chords.length).toBeGreaterThan(3);
    });
  }
});
