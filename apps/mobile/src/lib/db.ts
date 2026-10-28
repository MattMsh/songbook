import type { SQLiteDatabase } from 'expo-sqlite';
import { ftsMatch, lyricsText, normalizeSearch, parseAlbumPlan, parseChordPro, parseSearch, parseSongSettings, type AlbumPlan, type SongSettings, type SharedAlbum, type SyncSong } from '@songbook/shared';
import { useSyncExternalStore } from 'react';

export const DB_NAME = 'songbook.db';

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await db.withExclusiveTransactionAsync(async (db) => {
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
    if ((row?.user_version ?? 0) < 3) {
      await db.execAsync(`
        ALTER TABLE albums ADD COLUMN plan TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE albums ADD COLUMN plan_pending INTEGER NOT NULL DEFAULT 0;
        PRAGMA user_version = 3;
      `);
    }
    if ((row?.user_version ?? 0) < 4) {
      await db.execAsync(`
        CREATE TABLE pending_album_drafts (
          user_id TEXT NOT NULL, remote_id TEXT NOT NULL, snapshot TEXT NOT NULL,
          PRIMARY KEY (user_id, remote_id)
        );
        PRAGMA user_version = 4;
      `);
    }
  });
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
export const getRevision = () => revision;
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

async function writeSyncSongs(tx: SQLiteDatabase, songs: SyncSong[], cursor: string) {
  for (const s of songs) {
    if (s.id.startsWith('share:')) throw new Error('Reserved song ID');
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
}

/** Applies one sync page in a single exclusive transaction. */
export async function applySyncPage(db: SQLiteDatabase, songs: SyncSong[], cursor: string) {
  await db.withExclusiveTransactionAsync((tx) => writeSyncSongs(tx, songs, cursor));
}

/** Replace only canonical catalog rows after the complete download succeeds. */
export async function replaceCatalog(db: SQLiteDatabase, songs: SyncSong[], cursor: string, lastSyncAt: number) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.execAsync("DELETE FROM songs WHERE id NOT LIKE 'share:%';");
    if (ftsEnabled) await tx.execAsync("DELETE FROM songs_fts WHERE id NOT LIKE 'share:%';");
    await writeSyncSongs(tx, songs, cursor);
    await tx.runAsync("INSERT OR REPLACE INTO meta(key, value) VALUES ('last_sync_at', ?)", String(lastSyncAt));
  });
  bumpRevision();
}

export async function getCursor(db: SQLiteDatabase) {
  return (await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'cursor'"))?.value ?? '';
}

/** Forgets the sync cursor and server songs; local overrides and albums stay. */
export async function resetSync(db: SQLiteDatabase) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.execAsync("DELETE FROM songs WHERE id NOT LIKE 'share:%'; DELETE FROM meta WHERE key = 'cursor';");
    if (ftsEnabled) await tx.execAsync("DELETE FROM songs_fts WHERE id NOT LIKE 'share:%';");
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
  await db.runAsync('UPDATE albums SET name = ?, plan_pending = plan_pending + 1 WHERE id = ?', name.trim(), id);
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

export const getSharedAlbumOwner = async (db: SQLiteDatabase) =>
  (await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'shared_owner'"))?.value ?? null;

/** Bind caches from earlier app versions before validating the cached account. */
export async function initializeSharedAlbumOwner(db: SQLiteDatabase, userId: string | null) {
  await db.runAsync("INSERT OR IGNORE INTO meta(key, value) VALUES ('shared_owner', ?)", userId ?? '');
}

export async function getPendingSharedAlbumCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(`
    SELECT (SELECT COUNT(*) FROM albums WHERE remote_id IS NOT NULL AND plan_pending > 0) +
      (SELECT COUNT(*) FROM pending_album_drafts WHERE user_id = (SELECT value FROM meta WHERE key = 'shared_owner')) AS count
  `);
  return row?.count ?? 0;
}

/** Keep unsent drafts outside the visible album tables until their owner signs in again. */
export async function quarantineSharedAlbums(db: SQLiteDatabase, discardPending = false, isCurrent = (): boolean => true) {
  let cleared = false;
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (!isCurrent()) return;
    const owner = await getSharedAlbumOwner(tx) ?? '';
    if (discardPending) {
      await tx.runAsync('DELETE FROM pending_album_drafts WHERE user_id = ?', owner);
    } else {
      const pending = await tx.getAllAsync<{ id: number; remote_id: string; name: string; plan: string; created_at: number }>(
        'SELECT id, remote_id, name, plan, created_at FROM albums WHERE remote_id IS NOT NULL AND plan_pending > 0',
      );
      for (const album of pending) {
        const snapshot = { ...album, songIds: await albumSongIds(tx, album.id) };
        await tx.runAsync('INSERT OR REPLACE INTO pending_album_drafts(user_id, remote_id, snapshot) VALUES (?, ?, ?)',
          owner, album.remote_id, JSON.stringify(snapshot));
      }
    }
    await tx.runAsync('DELETE FROM albums WHERE remote_id IS NOT NULL');
    await tx.runAsync("DELETE FROM meta WHERE key = 'shared_owner'");
    cleared = true;
  });
  if (cleared) bumpRevision();
  return cleared;
}

export async function discardQuarantinedAlbumDrafts(db: SQLiteDatabase, userId: string) {
  await db.runAsync('DELETE FROM pending_album_drafts WHERE user_id = ?', userId);
  bumpRevision();
}

/** Restore only the authenticated account's drafts; a member retains quarantine without seeing shared albums. */
export async function restoreSharedAlbumDrafts(db: SQLiteDatabase, userId: string, restore = true) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync("INSERT OR REPLACE INTO meta(key, value) VALUES ('shared_owner', ?)", userId);
    if (!restore) return;
    const drafts = await tx.getAllAsync<{ remote_id: string; snapshot: string }>(
      'SELECT remote_id, snapshot FROM pending_album_drafts WHERE user_id = ?', userId,
    );
    for (const draft of drafts) {
      const album = JSON.parse(draft.snapshot) as { name: string; plan: string; created_at: number; songIds: string[] };
      await tx.runAsync(`INSERT INTO albums(name, created_at, remote_id, plan, plan_pending) VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(remote_id) DO UPDATE SET name=excluded.name, plan=excluded.plan, plan_pending=albums.plan_pending+1`,
      album.name, album.created_at, draft.remote_id, album.plan);
      const local = (await tx.getFirstAsync<{ id: number }>('SELECT id FROM albums WHERE remote_id = ?', draft.remote_id))!;
      await tx.runAsync('DELETE FROM album_songs WHERE album_id = ?', local.id);
      for (const [position, songId] of album.songIds.entries())
        await tx.runAsync('INSERT INTO album_songs(album_id, song_id, position) VALUES (?, ?, ?)', local.id, songId, position);
    }
    await tx.runAsync('DELETE FROM pending_album_drafts WHERE user_id = ?', userId);
  });
  bumpRevision();
}

/**
 * Makes the local shared albums match the server list: upserts each one, replaces its songs,
 * and (with `prune`) deletes shared albums the list no longer has. Albums that live only on this device stay.
 * Returns the local id of every album, by server id.
 */
export async function applySharedAlbums(db: SQLiteDatabase, albums: SharedAlbum[], { prune = true, discardPending = false, isCurrent = (): boolean => true } = {}) {
  const ids = new Map<string, number>();
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (!isCurrent()) return;
    for (const a of albums) {
      const pending = await tx.getFirstAsync<{ id: number; plan_pending: number }>(
        'SELECT id, plan_pending FROM albums WHERE remote_id = ?', a.id,
      );
      if (pending?.plan_pending && !discardPending) {
        ids.set(a.id, pending.id);
        continue;
      }
      const plan = parseAlbumPlan(a, a.songIds);
      await tx.runAsync(
        `INSERT INTO albums (name, created_at, remote_id, plan) VALUES (?, ?, ?, ?)
         ON CONFLICT (remote_id) DO UPDATE SET name = excluded.name, created_at = excluded.created_at,
           plan = excluded.plan, plan_pending = 0`,
        a.name, a.createdAt, a.id, JSON.stringify(plan),
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
      `DELETE FROM albums WHERE remote_id IS NOT NULL ${discardPending ? '' : 'AND plan_pending = 0'}
       AND remote_id NOT IN (${keep.map(() => '?').join(',') || "''"})`,
      ...keep,
    );
  });
  bumpRevision();
  return ids;
}

export async function getAlbumPlan(db: SQLiteDatabase, albumId: number): Promise<AlbumPlan> {
  const row = await db.getFirstAsync<{ plan: string }>('SELECT plan FROM albums WHERE id = ?', albumId);
  if (!row) throw new Error('Album not found');
  return JSON.parse(row.plan);
}

export async function getAlbumSongSettings(db: SQLiteDatabase, albumId: number, songId: string): Promise<SongSettings> {
  return (await getAlbumPlan(db, albumId)).songSettings?.[songId] ?? {};
}

/** Replaces supplied fields; omitted fields keep their stored values. */
export async function saveAlbumPlan(db: SQLiteDatabase, albumId: number, patch: AlbumPlan) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await getAlbumPlan(tx, albumId);
    const next = parseAlbumPlan({ ...current, ...patch }, await albumSongIds(tx, albumId));
    await tx.runAsync('UPDATE albums SET plan = ?, plan_pending = plan_pending + 1 WHERE id = ?', JSON.stringify(next), albumId);
  });
  bumpRevision();
}

/** Patches this song's settings atomically; explicit undefined clears an optional field. */
export async function saveAlbumSongSettings(db: SQLiteDatabase, albumId: number, songId: string, settings: SongSettings) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await getAlbumPlan(tx, albumId);
    const ids = await albumSongIds(tx, albumId);
    if (!ids.includes(songId)) throw new Error('Song is not in album');
    const next = parseAlbumPlan({
      ...current, songSettings: { ...current.songSettings, [songId]: parseSongSettings({ ...current.songSettings?.[songId], ...settings }) },
    }, ids);
    await tx.runAsync('UPDATE albums SET plan = ?, plan_pending = plan_pending + 1 WHERE id = ?', JSON.stringify(next), albumId);
  });
  bumpRevision();
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
  await db.withExclusiveTransactionAsync(async (tx) => {
    const res = await tx.runAsync('DELETE FROM album_songs WHERE album_id = ? AND song_id = ?', albumId, songId);
    if (!res.changes) {
      if (!(await getSong(tx, songId))) throw new Error('Song not found');
      const album = await getAlbum(tx, albumId);
      if (album?.remote_id && songId.startsWith('share:')) throw new Error('snapshot_in_shared_album');
      await tx.runAsync(
        `INSERT INTO album_songs (album_id, song_id, position)
         VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM album_songs WHERE album_id = ?))`,
        albumId, songId, albumId,
      );
    }
    const plan = await getAlbumPlan(tx, albumId);
    if (res.changes && plan.songSettings) delete plan.songSettings[songId];
    await tx.runAsync('UPDATE albums SET plan = ?, plan_pending = plan_pending + 1 WHERE id = ?', JSON.stringify(plan), albumId);
  });
  bumpRevision();
}

/** Saves the album order: `ids` lists the album's songs from first to last. */
export async function setAlbumOrder(db: SQLiteDatabase, albumId: number, ids: string[]) {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await albumSongIds(tx, albumId);
    if (new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id)))
      throw new Error('Invalid album order');
    await tx.runAsync('UPDATE albums SET plan_pending = plan_pending + 1 WHERE id = ?', albumId);
    const ordered = [...ids, ...current.filter((id) => !ids.includes(id))];
    for (const [pos, id] of ordered.entries())
      await tx.runAsync('UPDATE album_songs SET position = ? WHERE album_id = ? AND song_id = ?', pos, albumId, id);
  });
  bumpRevision();
}
