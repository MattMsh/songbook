import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { getDirective, parseChordPro, parseTags, setDirective, splitHeader } from '../src/chordpro';
import { filterSongResults, matchesSongFilters, songFilterQuery } from '../src/song-filters';

const source = (tags = 'Різдво, worship', key = 'C', tempo = 90, time = '4/4') =>
  `{title: Test}\n{tags: ${tags}}\n{key: ${key}}\n{tempo: ${tempo}}\n{time: ${time}}\n\n[C]Lyrics`;

describe('tags and song filters', () => {
  it('parses, deduplicates and round-trips tags without exposing them as lyrics', () => {
    const src = source(' Різдво, worship, різдво, , Сімейні пісні ');
    expect(parseChordPro(src).meta.tags).toEqual(['Різдво', 'worship', 'Сімейні пісні']);
    const { head, body } = splitHeader(src);
    expect(head + body).toBe(src);
    expect(body).toBe('[C]Lyrics');
    const changed = setDirective(head, 'tags', 'Молитва, Вечір') + body;
    expect(parseChordPro(changed).meta.tags).toEqual(['Молитва', 'Вечір']);
    expect(getDirective(changed, 'tags')).toBe('Молитва, Вечір');
    expect(parseChordPro(setDirective(changed, 'tags', null)).meta.tags).toEqual([]);
    expect(parseChordPro('{tags: A}\n{tags: a, B}\nText').meta.tags).toEqual(['A', 'B']);
    expect(parseTags(' , , ')).toEqual([]);
    expect(parseChordPro('[C]old song').meta.tags).toEqual([]);
  });

  it('combines exact case-insensitive tags, key, meter and inclusive tempo bounds', () => {
    const meta = parseChordPro(source()).meta;
    expect(matchesSongFilters(meta, { tag: 'різдво', key: 'C', time: '4 / 4', tempoMin: 90, tempoMax: 90 })).toBe(true);
    for (const filter of [{ tag: 'Різ' }, { key: 'Cm' }, { time: '3/4' }, { tempoMin: 91 }, { tempoMax: 89 }, { tempoMin: 100, tempoMax: 80 }])
      expect(matchesSongFilters(meta, filter)).toBe(false);
    expect(matchesSongFilters(parseChordPro(source('', 'H')).meta, { key: 'B' })).toBe(true);
    expect(matchesSongFilters(parseChordPro('[C]No metadata').meta, { tempoMax: 100 })).toBe(false);
    expect(matchesSongFilters(meta, { tempoMin: NaN })).toBe(false);
    expect(matchesSongFilters(meta, {})).toBe(true);
  });

  it('filters the entire candidate set before limiting, including candidates after row 100', () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ id: i, chordpro: source(i < 120 ? 'Other' : 'Target') }));
    expect(filterSongResults(rows, { tag: 'Target' }, 100).map((r) => r.id)).toEqual(Array.from({ length: 30 }, (_, i) => i + 120));
    expect(filterSongResults(rows, {}, 100)).toHaveLength(100);
    expect(filterSongResults(rows, {})).toHaveLength(150);
  });

  it('executes parameterized SQLite queries with number and word-prefix ordering intact', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE songs(id TEXT, number INTEGER, title TEXT, key TEXT, chordpro TEXT, title_norm TEXT, lyrics_norm TEXT);
               CREATE TABLE overrides(song_id TEXT, chordpro TEXT);
               CREATE VIRTUAL TABLE songs_fts USING fts5(id UNINDEXED, title_norm, lyrics_norm);`);
      const insert = db.prepare('INSERT INTO songs VALUES (?, ?, ?, ?, ?, ?, ?)');
      insert.run('a', 12, 'Alpha', 'C', source(), 'alpha', 'beta');
      insert.run('b', 120, 'Beta', 'C', source('Other'), 'beta', 'alpha');
      insert.run('c', 121, 'Alphabet', 'C', source(), 'alphabet', '');
      insert.run('d', null, 'Calpha', 'C', source(), 'calpha', '');
      db.exec('INSERT INTO songs_fts SELECT id, title_norm, lyrics_norm FROM songs');
      const run = (query: string, fts = false) => {
        const { sql, params } = songFilterQuery(query, fts);
        expect(sql).not.toContain('LIMIT');
        return db.prepare(sql).all(...params) as { id: string; chordpro: string }[];
      };
      expect(run('№12').map((r) => r.id)).toEqual(['a', 'b', 'c']);
      expect(run('alp').map((r) => r.id)).toEqual(['a', 'c', 'b']);
      expect(run('alp', true).map((r) => r.id)).toEqual(['c', 'a', 'b']);
      expect(run('alp beta').map((r) => r.id)).toEqual(['a', 'b']);
      expect(run('alpha" OR 1=1 --')).toEqual([]);
      db.prepare('INSERT INTO overrides VALUES (?, ?)').run('b', source('Local'));
      expect(filterSongResults(run('12'), { tag: 'Local' }).map((r) => r.id)).toEqual(['b']);
      expect(run('').map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    } finally { db.close(); }
  });
});
