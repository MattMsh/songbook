import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-linking', () => ({ createURL: (path: string) => `songbook://${path}` }));
vi.mock('../src/lib/api', () => ({ api: vi.fn(), ApiError: class extends Error {} }));
vi.mock('../src/lib/db', () => ({
  searchEngine: () => 'FTS5', bumpRevision: vi.fn(),
  getSong: (db: SQLiteDatabase, id: string) => db.getFirstAsync('SELECT * FROM songs WHERE id = ?', id),
  getAlbum: vi.fn(), getAlbumPlan: vi.fn(), albumSongIds: vi.fn(),
}));
import { api } from '../src/lib/api';
import { albumSongIds, getAlbum, getAlbumPlan } from '../src/lib/db';
import { createPlanShare, ensureSharedSong, importPlanShare, publicSongId } from '../src/lib/sharing';

const databases: DatabaseSync[] = [];
function database(failOnSong?: string) {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec(`CREATE TABLE songs (id TEXT PRIMARY KEY, number INTEGER, title TEXT, key TEXT, bpm INTEGER,
    time_sig TEXT, rhythm TEXT, chordpro TEXT, version INTEGER, updated_at INTEGER, title_norm TEXT, lyrics_norm TEXT);
    CREATE VIRTUAL TABLE songs_fts USING fts5(id UNINDEXED, title_norm, lyrics_norm);
    CREATE TABLE albums (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at INTEGER,
      plan TEXT NOT NULL DEFAULT '{}', plan_pending INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE album_songs (album_id INTEGER, song_id TEXT, position INTEGER, PRIMARY KEY(album_id,song_id));`);
  const adapter = {
    async runAsync(sql: string, ...params: (string | number | null)[]) {
      if (sql.includes('INSERT OR IGNORE INTO songs') && params[0] === failOnSong) throw new Error('disk full');
      const result = sqlite.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async getFirstAsync(sql: string, ...params: (string | number | null)[]) { return sqlite.prepare(sql).get(...params) ?? null; },
    async withExclusiveTransactionAsync(work: (tx: unknown) => Promise<void>) {
      sqlite.exec('BEGIN');
      try { await work(adapter); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { db: adapter as unknown as SQLiteDatabase, sqlite };
}
afterEach(() => { for (const database of databases.splice(0)) database.close(); vi.clearAllMocks(); });
const snapshot = { version: 1, name: 'План', serviceDate: '2026-10-25', leader: 'Олена', notes: 'Вступ',
  songs: [{ id: 'a', chordpro: '{title: Перша}\n{key: C}\n[C]Святий' }, { id: 'b', chordpro: '{title: Друга}\n[D]Бог' }],
  songSettings: { a: { transpose: 2, capo: 1, notes: 'двічі' } } };

describe('offline snapshot import', () => {
  it('reports oversized local plan payloads before making a network request', async () => {
    vi.stubGlobal('__DEV__', false);
    const { db } = database();
    const ids = Array.from({ length: 20 }, (_, index) => `s${index}`);
    vi.mocked(getAlbum).mockResolvedValue({ id: 1, name: 'План', remote_id: null });
    vi.mocked(albumSongIds).mockResolvedValue(ids);
    vi.mocked(getAlbumPlan).mockResolvedValue({ songSettings: Object.fromEntries(ids.map((id) => [id, { notes: 'я'.repeat(5000) }])) });
    await expect(createPlanShare(db, 1)).rejects.toThrow('План завеликий');
    expect(api).not.toHaveBeenCalled();
  });
  it('atomically saves ordered songs, searchable lyrics and remapped settings without overwriting canonical data', async () => {
    const { db, sqlite } = database();
    await db.runAsync("INSERT INTO songs(id,chordpro,title) VALUES ('a','canonical','Canonical')");
    const id = await importPlanShare(db, snapshot);
    expect(id).toBe(1);
    expect(sqlite.prepare('SELECT chordpro FROM songs WHERE id=?').get('a')?.chordpro).toBe('canonical');
    expect(sqlite.prepare('SELECT song_id FROM album_songs ORDER BY position').all().map((row) => row.song_id)).toEqual(['share:1:a', 'share:1:b']);
    const album = sqlite.prepare('SELECT plan,plan_pending FROM albums WHERE id=?').get(id)!;
    expect(JSON.parse(String(album.plan))).toEqual({ serviceDate: snapshot.serviceDate, leader: 'Олена', notes: 'Вступ',
      songSettings: { 'share:1:a': snapshot.songSettings.a } });
    expect(album.plan_pending).toBe(0);
    expect(sqlite.prepare("SELECT id FROM songs_fts WHERE songs_fts MATCH 'святии'").get()?.id).toBe('share:1:a');
    expect(publicSongId('share:1:a')).toBe('a');
    expect(await importPlanShare(db, snapshot)).toBe(2);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM songs').get()?.count).toBe(5);
  });
  it('rolls back the whole album, settings, songs and FTS rows on a storage failure', async () => {
    const { db, sqlite } = database('share:1:b');
    await expect(importPlanShare(db, snapshot)).rejects.toThrow('disk full');
    for (const table of ['songs', 'albums', 'album_songs', 'songs_fts'])
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count).toBe(0);
  });
  it('rejects invalid snapshots before writing anything', async () => {
    const { db, sqlite } = database();
    await expect(importPlanShare(db, { ...snapshot, songs: [] })).rejects.toThrow();
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM albums').get()?.count).toBe(0);
  });
  it('opens a cached public song offline and fetches only a missing song without changing the sync cursor', async () => {
    const { db, sqlite } = database();
    await db.runAsync("INSERT INTO songs(id,chordpro,title) VALUES ('a','canonical','Canonical')");
    await ensureSharedSong(db, 'a');
    expect(api).not.toHaveBeenCalled();
    vi.mocked(api).mockResolvedValue({ id: 'b', chordpro: '{title: Друга}\n[D]Бог', version: 3, updatedAt: 100, deletedAt: null });
    await ensureSharedSong(db, 'b');
    expect(api).toHaveBeenCalledWith('/songs/b');
    expect(sqlite.prepare('SELECT title,version FROM songs WHERE id=?').get('b')).toMatchObject({ title: 'Друга', version: 3 });
  });
});
