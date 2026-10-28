import { parseChordPro, type SongMeta } from './chordpro';
import { parseChord } from './chords';
import { ftsMatch, parseSearch } from './search';

export interface SongFilters {
  tag?: string;
  key?: string;
  tempoMin?: number;
  tempoMax?: number;
  time?: string;
}

export function matchesSongFilters(meta: SongMeta, filters: SongFilters): boolean {
  if (filters.tag && !meta.tags.some((tag) => tag.toLocaleLowerCase('uk') === filters.tag!.toLocaleLowerCase('uk'))) return false;
  if (filters.key) {
    const actual = parseChord(meta.key ?? '');
    const wanted = parseChord(filters.key);
    if (actual && wanted) {
      if (actual.root !== wanted.root || actual.quality !== wanted.quality) return false;
    } else if (meta.key !== filters.key) return false;
  }
  if (filters.time && meta.time?.replace(/\s/g, '') !== filters.time.replace(/\s/g, '')) return false;
  if (filters.tempoMin !== undefined && (meta.tempo === null || !Number.isFinite(filters.tempoMin) || meta.tempo < filters.tempoMin)) return false;
  if (filters.tempoMax !== undefined && (meta.tempo === null || !Number.isFinite(filters.tempoMax) || meta.tempo > filters.tempoMax)) return false;
  return true;
}

/** Keep database search ordering, but leave the limit until after metadata filtering. */
export function songFilterQuery(query: string, fts: boolean): { sql: string; params: (string | number)[]; limit?: number } {
  const q = parseSearch(query);
  const cols = 's.id, s.number, s.title, s.key, COALESCE(o.chordpro, s.chordpro) AS chordpro';
  const overrides = 'LEFT JOIN overrides o ON o.song_id = s.id';
  if (q.kind === 'all') return {
    sql: `SELECT ${cols} FROM songs s ${overrides} ORDER BY s.number IS NULL, s.number, s.title`, params: [],
  };
  if (q.kind === 'number') return {
    sql: `SELECT ${cols} FROM songs s ${overrides} WHERE CAST(s.number AS TEXT) LIKE ? ORDER BY s.number != ?, s.number`,
    params: [q.number + '%', Number(q.number)], limit: 100,
  };
  if (fts) return {
    sql: `SELECT ${cols} FROM songs_fts f JOIN songs s ON s.id = f.id ${overrides}
          WHERE songs_fts MATCH ? ORDER BY bm25(songs_fts, 0, 10.0, 1.0)`,
    params: [ftsMatch(q.tokens)], limit: 100,
  };
  const where = q.tokens.map(() => `(' ' || s.title_norm || ' ' || s.lyrics_norm) LIKE ?`).join(' AND ');
  const titleScore = q.tokens.map(() => `(' ' || s.title_norm LIKE ?)`).join(' + ');
  const pats = q.tokens.map((token) => `% ${token}%`);
  return {
    sql: `SELECT ${cols} FROM songs s ${overrides} WHERE ${where} ORDER BY ${titleScore} DESC, s.number`,
    params: [...pats, ...pats], limit: 100,
  };
}

export function filterSongResults<T extends { chordpro: string }>(rows: T[], filters: SongFilters, limit?: number): T[] {
  return rows.filter((row) => matchesSongFilters(parseChordPro(row.chordpro).meta, filters)).slice(0, limit);
}
