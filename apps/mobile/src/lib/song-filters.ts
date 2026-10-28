import { filterSongResults, parseChordPro, songFilterQuery, type SongFilters } from '@songbook/shared';
import type { SQLiteDatabase } from 'expo-sqlite';
import { searchEngine, type SongListItem } from './db';

export async function searchFilteredSongs(db: SQLiteDatabase, query: string, filters: SongFilters): Promise<SongListItem[]> {
  const run = async (fts: boolean) => {
    const { sql, params, limit } = songFilterQuery(query, fts);
    const rows = await db.getAllAsync<SongListItem & { chordpro: string }>(sql, ...params);
    return filterSongResults(rows, filters, limit);
  };
  if (searchEngine() === 'FTS5') {
    try {
      return await run(true);
    } catch (error) {
      console.warn('Filtered FTS query failed, falling back to LIKE', error);
    }
  }
  return run(false);
}

export async function songFilterChoices(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ chordpro: string }>(
    'SELECT COALESCE(o.chordpro, s.chordpro) AS chordpro FROM songs s LEFT JOIN overrides o ON o.song_id = s.id',
  );
  const tags = new Set<string>();
  const keys = new Set<string>();
  const times = new Set<string>();
  for (const row of rows) {
    const meta = parseChordPro(row.chordpro).meta;
    meta.tags.forEach((tag) => tags.add(tag));
    if (meta.key) keys.add(meta.key);
    if (meta.time) times.add(meta.time);
  }
  const sorted = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b, 'uk'));
  return { tags: sorted(tags), keys: sorted(keys), times: sorted(times) };
}
