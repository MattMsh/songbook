import { describe, expect, it } from 'vitest';
import { buildPdfHtml, escapeHtml, type PdfDocument } from '../src/pdf';

const labels = { verse: 'Куплет', chorus: 'Приспів', bridge: 'Бридж', key: 'Тональність', capo: 'Капо', leader: 'Ведучий', notes: 'Нотатки' };
const document: PdfDocument = { title: 'Неділя', variant: 'musician', labels, songs: [{ chordpro:
  '{title: Святий}\n{key: A}\n{capo: 2}\n{tempo: 90}\n{soc: Приспів}\n[G]Бог [D/F#]мій\n{eoc}\n{chorus}\n[G] | [D] x2',
  settings: { transpose: 2, capo: 0, bpm: 120 } }] };

describe('PDF HTML', () => {
  it('escapes every HTML-sensitive character and retains Cyrillic', () => {
    expect(escapeHtml(`<>&"' Святий`)).toBe('&lt;&gt;&amp;&quot;&#39; Святий');
    const html = buildPdfHtml({ ...document, title: '<script>alert(1)</script>', leader: '<img src=x>', notes: 'A & B',
      songs: [{ chordpro: '{title: <b>Святий</b>}\n{c: <svg onload=evil>}\n[C]<iframe>текст</iframe>' }] });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<iframe>');
    expect(html).toContain('&lt;b&gt;Святий&lt;/b&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).toContain('default-src \'none\'');
  });
  it('matches sounding key, capo shapes, slash bass and plan BPM', () => {
    const html = buildPdfHtml(document);
    expect(html).toContain('Тональність: B');
    expect(html).toContain('Капо: 2');
    expect(html).toContain('120 BPM');
    expect(html).toContain('>A</b>');
    expect(html).toContain('>E/G#</b>');
    expect(html).toContain('>A</span>');
    expect(html).not.toContain('90 BPM');
    expect(buildPdfHtml({ ...document, songs: [{ ...document.songs[0], settings: { capo: 12 } }] })).toContain('Капо: 11');
    expect(buildPdfHtml({ ...document, songs: [{ ...document.songs[0], settings: { capo: -12 } }] })).toContain('Капо: 0');
  });
  it('expands repeated choruses and preserves labeled bar grids', () => {
    const html = buildPdfHtml(document);
    expect(html.match(/<h3>Приспів<\/h3>/g)).toHaveLength(2);
    expect(html).toContain('class="grid"');
    expect(html).toContain('x2');
  });
  it('omits chords, bar grids and song-specific musician notes from lyrics export', () => {
    const html = buildPdfHtml({ ...document, variant: 'lyrics', songs: [{ ...document.songs[0], settings: { notes: 'count-in' } }] });
    expect(html).toContain('Бог мій');
    expect(html).not.toContain('<b class="chord">');
    expect(html).not.toContain('<div class="grid">');
    expect(html).not.toContain('count-in');
    expect(html).not.toContain('Тональність:');
  });
  it('preserves song order and plan metadata', () => {
    const html = buildPdfHtml({ ...document, serviceDate: '2026-10-25', leader: 'Олена', notes: 'Тихий вступ',
      songs: [{ chordpro: '{title: Перша}\n[A]А' }, { chordpro: '{title: Друга}\n[B]Б' }] });
    expect(html.indexOf('1. Перша')).toBeLessThan(html.indexOf('2. Друга'));
    expect(html).toContain('Ведучий: Олена');
    expect(html).toContain('2026-10-25');
    expect(html).toContain('Тихий вступ');
  });
});
