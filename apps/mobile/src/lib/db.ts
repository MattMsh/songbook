import type { SQLiteDatabase } from 'expo-sqlite';
import { ftsMatch, lyricsText, normalizeSearch, parseChordPro, parseSearch, type SharedAlbum, type SyncSong } from '@songbook/shared';
import { useSyncExternalStore } from 'react';

export const DB_NAME = 'songbook.db';

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if ((row?.user_version ?? 0) < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY NOT NULL,
        number INTEGER,
        title TEXT NOT NULL,
        key TEXT, bpm INTEGER, time_sig TEXT, rhythm TEXT,
        chordpro TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        title_norm TEXT NOT NULL,
        lyrics_norm TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS songs_number ON songs(number);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);
      CREATE TABLE IF NOT EXISTS overrides (
        song_id TEXT PRIMARY KEY NOT NULL,
        base_version INTEGER NOT NULL,
        chordpro TEXT,
        transpose INTEGER NOT NULL DEFAULT 0,
        capo INTEGER NOT NULL DEFAULT 0 -- offset from the song's {capo}, so 0 means "as written"
      );
      CREATE TABLE IF NOT EXISTS albums (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS album_songs (
        album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        song_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (album_id, song_id)
      );
      PRAGMA user_version = 1;
    `);
  }
  if ((row?.user_version ?? 0) < 2) {
    // A shared album is a local cache of a server album; `remote_id` is the server id.
    await db.execAsync(`
      ALTER TABLE albums ADD COLUMN remote_id TEXT;
      CREATE UNIQUE INDEX albums_remote ON albums(remote_id);
      PRAGMA user_version = 2;
    `);
  }
  await ensureFts(db);
}

let ftsEnabled = false;

/** FTS5 is not guaranteed in every build (e.g. Expo Go); search falls back to LIKE on the *_norm columns. */
async function ensureFts(db: SQLiteDatabase) {
  try {
    const exists = await db.getFirstAsync("SELECT 1 FROM sqlite_master WHERE name = 'songs_fts'");
    if (!exists) {
      await db.execAsync(`
        CREATE VIRTUAL TABLE songs_fts USING fts5(id UNINDEXED, title_norm, lyrics_norm, prefix='2 3');
        INSERT INTO songs_fts (id, title_norm, lyrics_norm) SELECT id, title_norm, lyrics_norm FROM songs;
      `);
    }
    ftsEnabled = true;
  } catch (e) {
    console.warn('FTS5 unavailable, using LIKE search', e);
    ftsEnabled = false;
  }
}

export const searchEngine = () => (ftsEnabled ? 'FTS5' : 'LIKE');

// ---------- change notifications ----------

let revision = 0;
const listeners = new Set<() => void>();
export function bumpRevision() {
  revision++;
  listeners.forEach((l) => l());
}
/** Changes whenever local data changes, so screens can re-query. */
export const useRevision = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => revision,
  );

// ---------- songs ----------

export interface SongRow {
  id: string;
  number: number | null;
  title: string;
  key: string | null;
  bpm: number | null;
  time_sig: string | null;
  rhythm: string | null;
  chordpro: string;
  version: number;
}

export type SongListItem = Pick<SongRow, 'id' | 'number' | 'title' | 'key'>;

/** Applies one sync page in a single exclusive transaction. */
export async function applySyncPage(db: SQLiteDatabase, songs: SyncSong[], cursor: string) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const s of songs) {
      if (ftsEnabled) await tx.runAsync('DELETE FROM songs_fts WHERE id = ?', s.id);
      if (s.deletedAt) {
        await tx.runAsync('DELETE FROM songs WHERE id = ?', s.id);
        continue;
      }
      const titleNorm = normalizeSearch(s.title);
      const lyricsNorm = normalizeSearch(lyricsText(parseChordPro(s.chordpro)));
      await tx.runAsync(
        `INSERT OR REPLACE INTO songs (id, number, title, key, bpm, time_sig, rhythm, chordpro, version, updated_at, title_norm, lyrics_norm)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        s.id, s.number, s.title, s.key, s.bpm, s.timeSig, s.rhythm, s.chordpro, s.version, s.updatedAt, titleNorm, lyricsNorm,
      );
      if (ftsEnabled)
        await tx.runAsync('INSERT INTO songs_fts (id, title_norm, lyrics_norm) VALUES (?, ?, ?)', s.id, titleNorm, lyricsNorm);
    }
    await tx.runAsync("INSERT OR REPLACE INTO meta (key, value) VALUES ('cursor', ?)", cursor);
  });
}

export async function getCursor(db: SQLiteDatabase) {
  return (await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'cursor'"))?.value ?? '';
}

/** Forgets the sync cursor and server songs; local overrides and albums stay. */
export async function resetSync(db: SQLiteDatabase) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.execAsync("DELETE FROM songs; DELETE FROM meta WHERE key = 'cursor';");
    if (ftsEnabled) await tx.execAsync('DELETE FROM songs_fts;');
  });
}

const LIST_COLS = 's.id, s.number, s.title, s.key';

export async function searchSongs(db: SQLiteDatabase, query: string): Promise<SongListItem[]> {
  const q = parseSearch(query);
  if (q.kind === 'all')
    return db.getAllAsync(`SELECT ${LIST_COLS} FROM songs s ORDER BY s.number IS NULL, s.number, s.title`);
  if (q.kind === 'number')
    return db.getAllAsync(
      `SELECT ${LIST_COLS} FROM songs s WHERE CAST(s.number AS TEXT) LIKE ? ORDER BY s.number != ?, s.number LIMIT 100`,
      q.number + '%', Number(q.number),
    );
  if (ftsEnabled) {
    try {
      return await db.getAllAsync(
        `SELECT ${LIST_COLS} FROM songs_fts f JOIN songs s ON s.id = f.id
         WHERE songs_fts MATCH ? ORDER BY bm25(songs_fts, 0, 10.0, 1.0) LIMIT 100`,
        ftsMatch(q.tokens),
      );
    } catch (e) {
      console.warn('FTS query failed, falling back to LIKE', e);
    }
  }
  // Word-prefix match like FTS: tokens contain only letters and digits, so no LIKE escaping is needed.
  const where = q.tokens.map(() => `(' ' || s.title_norm || ' ' || s.lyrics_norm) LIKE ?`).join(' AND ');
  const titleScore = q.tokens.map(() => `(' ' || s.title_norm LIKE ?)`).join(' + ');
  const pats = q.tokens.map((t) => `% ${t}%`);
  return db.getAllAsync(
    `SELECT ${LIST_COLS} FROM songs s WHERE ${where} ORDER BY ${titleScore} DESC, s.number LIMIT 100`,
    ...pats, ...pats,
  );
}

export const getSong = (db: SQLiteDatabase, id: string) =>
  db.getFirstAsync<SongRow>('SELECT * FROM songs WHERE id = ?', id);

// ---------- overrides ----------

export interface Override {
  song_id: string;
  base_version: number;
  chordpro: string | null;
  transpose: number;
  /** Offset from the song's `{capo}`; 0 means as written. */
  capo: number;
}

export const getOverride = (db: SQLiteDatabase, songId: string) =>
  db.getFirstAsync<Override>('SELECT * FROM overrides WHERE song_id = ?', songId);

export async function saveOverride(
  db: SQLiteDatabase,
  songId: string,
  baseVersion: number,
  patch: Partial<Pick<Override, 'chordpro' | 'transpose' | 'capo'>>,
) {
  const cur = await getOverride(db, songId);
  const next = { chordpro: null, transpose: 0, capo: 0, ...cur, ...patch };
  // A new text edit is based on the current server version; transpose/capo keep the old base.
  const base = patch.chordpro !== undefined || !cur ? baseVersion : cur.base_version;
  if (next.chordpro === null && !next.transpose && !next.capo)
    await db.runAsync('DELETE FROM overrides WHERE song_id = ?', songId);
  else
    await db.runAsync(
      'INSERT OR REPLACE INTO overrides (song_id, base_version, chordpro, transpose, capo) VALUES (?, ?, ?, ?, ?)',
      songId, base, next.chordpro, next.transpose, next.capo,
    );
  bumpRevision();
}

// ---------- albums ----------

export const songSubtitle = (s: SongListItem) => (s.number ? `№${s.number}${s.key ? ' · ' + s.key : ''}` : s.key);

export interface Album {
  id: number;
  name: string;
  count: number;
  /** Server id of a shared album; null for an album that lives only on this device. */
  remote_id: string | null;
}

/** `mine` and `shared` filter by kind; without a filter all albums are listed. */
export const listAlbums = (db: SQLiteDatabase, kind?: 'mine' | 'shared') =>
  db.getAllAsync<Album>(
    `SELECT a.id, a.name, a.remote_id, COUNT(s.id) AS count FROM albums a
     LEFT JOIN album_songs x ON x.album_id = a.id LEFT JOIN songs s ON s.id = x.song_id
     ${kind ? `WHERE a.remote_id IS ${kind === 'shared' ? 'NOT ' : ''}NULL` : ''}
     GROUP BY a.id ORDER BY a.created_at DESC`,
  );

export async function createAlbum(db: SQLiteDatabase, name: string) {
  const r = await db.runAsync('INSERT INTO albums (name, created_at) VALUES (?, ?)', name.trim(), Date.now());
  bumpRevision();
  return r.lastInsertRowId;
}

export async function renameAlbum(db: SQLiteDatabase, id: number, name: string) {
  await db.runAsync('UPDATE albums SET name = ? WHERE id = ?', name.trim(), id);
  bumpRevision();
}

export async function deleteAlbum(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM albums WHERE id = ?', id);
  bumpRevision();
}

export const getAlbum = (db: SQLiteDatabase, id: number) =>
  db.getFirstAsync<Pick<Album, 'id' | 'name' | 'remote_id'>>('SELECT id, name, remote_id FROM albums WHERE id = ?', id);

/** Song ids in album order, including songs not synced to this device yet. */
export const albumSongIds = async (db: SQLiteDatabase, id: number) =>
  (await db.getAllAsync<{ song_id: string }>('SELECT song_id FROM album_songs WHERE album_id = ? ORDER BY position', id)).map(
    (r) => r.song_id,
  );

/**
 * Makes the local shared albums match the server list: upserts each one, replaces its songs,
 * and (with `prune`) deletes shared albums the list no longer has. Albums that live only on this device stay.
 * Returns the local id of every album, by server id.
 */
export async function applySharedAlbums(db: SQLiteDatabase, albums: SharedAlbum[], { prune = true } = {}) {
  const ids = new Map<string, number>();
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const a of albums) {
      await tx.runAsync(
        `INSERT INTO albums (name, created_at, remote_id) VALUES (?, ?, ?)
         ON CONFLICT (remote_id) DO UPDATE SET name = excluded.name, created_at = excluded.created_at`,
        a.name, a.createdAt, a.id,
      );
      const local = (await tx.getFirstAsync<{ id: number }>('SELECT id FROM albums WHERE remote_id = ?', a.id))!.id;
      ids.set(a.id, local);
      await tx.runAsync('DELETE FROM album_songs WHERE album_id = ?', local);
      for (const [pos, songId] of a.songIds.entries())
        await tx.runAsync('INSERT INTO album_songs (album_id, song_id, position) VALUES (?, ?, ?)', local, songId, pos);
    }
    if (!prune) return;
    const keep = albums.map((a) => a.id);
    await tx.runAsync(
      `DELETE FROM albums WHERE remote_id IS NOT NULL AND remote_id NOT IN (${keep.map(() => '?').join(',') || "''"})`,
      ...keep,
    );
  });
  bumpRevision();
  return ids;
}

/** Songs of an album in set-list order; songs deleted on the server drop out. */
export const albumSongs = (db: SQLiteDatabase, id: number) =>
  db.getAllAsync<SongListItem>(
    `SELECT ${LIST_COLS} FROM album_songs x JOIN songs s ON s.id = x.song_id WHERE x.album_id = ? ORDER BY x.position`,
    id,
  );

export const albumIdsWithSong = async (db: SQLiteDatabase, songId: string) =>
  (await db.getAllAsync<{ album_id: number }>('SELECT album_id FROM album_songs WHERE song_id = ?', songId)).map(
    (r) => r.album_id,
  );

export async function toggleAlbumSong(db: SQLiteDatabase, albumId: number, songId: string) {
  const res = await db.runAsync('DELETE FROM album_songs WHERE album_id = ? AND song_id = ?', albumId, songId);
  if (!res.changes)
    await db.runAsync(
      `INSERT INTO album_songs (album_id, song_id, position)
       VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM album_songs WHERE album_id = ?))`,
      albumId, songId, albumId,
    );
  bumpRevision();
}

/** Saves the album order: `ids` lists the album's songs from first to last. */
export async function setAlbumOrder(db: SQLiteDatabase, albumId: number, ids: string[]) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const [pos, id] of ids.entries())
      await tx.runAsync('UPDATE album_songs SET position = ? WHERE album_id = ? AND song_id = ?', pos, albumId, id);
  });
  bumpRevision();
}
