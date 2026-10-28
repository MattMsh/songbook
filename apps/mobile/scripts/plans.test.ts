/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SQLiteDatabase } from 'expo-sqlite';
import { applySharedAlbums, applySyncPage, albumSongIds, createAlbum, getAlbumPlan, getAlbumSongSettings, getOverride,
  migrate, resetSync, getPendingSharedAlbumCount, initializeSharedAlbumOwner, restoreSharedAlbumDrafts, discardQuarantinedAlbumDrafts, getCursor, saveAlbumPlan, saveAlbumSongSettings, saveOverride, setAlbumOrder, toggleAlbumSong } from '../src/lib/db';

vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));
vi.mock('expo-linking', () => ({ createURL: (path: string) => path }));
vi.mock('../src/lib/parts', () => ({ setPartTypes: vi.fn() }));
vi.mock('../src/lib/i18n', () => ({ t: (s: string) => s }));
vi.mock('../src/lib/api', () => ({
  api: vi.fn(), errorMessage: String,
  ApiError: class extends Error { constructor(public status: number, public code: string) { super(code); } },
}));
import { api, ApiError } from '../src/lib/api';
import { getSyncStatus, resyncNow, syncNow } from '../src/lib/sync';
import { importPlanShare } from '../src/lib/sharing';
import { albumSessionVersion, clearAlbumSession, enableAlbumSession, flushPendingAlbums } from '../src/lib/albums';

const connections: DatabaseSync[] = [];
function database() {
  const sql = new DatabaseSync(':memory:');
  connections.push(sql);
  const db = {
    execAsync: async (query: string) => { sql.exec(query); },
    runAsync: async (query: string, ...args: (string | number | null)[]) => {
      const result = sql.prepare(query).run(...args);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    getFirstAsync: async (query: string, ...args: (string | number | null)[]) => sql.prepare(query).get(...args) ?? null,
    getAllAsync: async (query: string, ...args: (string | number | null)[]) => sql.prepare(query).all(...args),
    withExclusiveTransactionAsync: async (fn: (tx: SQLiteDatabase) => Promise<void>) => {
      sql.exec('BEGIN');
      try { await fn(db as unknown as SQLiteDatabase); sql.exec('COMMIT'); }
      catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  } as unknown as SQLiteDatabase;
  return { db, sql };
}
async function seeded() {
  const result = database();
  await migrate(result.db);
  for (const id of ['a', 'b', 'share:import:a'])
    result.sql.prepare(`INSERT INTO songs(id,title,chordpro,version,updated_at,title_norm,lyrics_norm)
      VALUES (?,?,'{capo: 3}',1,1,?,'')`).run(id, id, id);
  return result;
}
afterEach(() => { for (const sql of connections.splice(0)) sql.close(); vi.clearAllMocks(); });

describe('local plan persistence', () => {
  it('patches song fields without losing independently saved settings', async () => {
    const { db } = await seeded();
    const id = await createAlbum(db, 'Plan');
    await toggleAlbumSong(db, id, 'a');
    await saveAlbumSongSettings(db, id, 'a', { bpm: 80, notes: 'Keep', capo: -1 });
    await saveAlbumSongSettings(db, id, 'a', { transpose: 2 });
    await saveAlbumSongSettings(db, id, 'a', { bpm: undefined });
    expect(await getAlbumSongSettings(db, id, 'a')).toEqual({ transpose: 2, capo: -1, notes: 'Keep' });
  });

  it('rejects imported snapshot IDs in shared albums without changing membership', async () => {
    const { db } = await seeded();
    const id = (await applySharedAlbums(db, [{ id: 'r', name: 'Plan', songIds: ['a'], createdAt: 1, updatedAt: 1 }])).get('r')!;
    await expect(toggleAlbumSong(db, id, 'share:import:a')).rejects.toThrow('snapshot_in_shared_album');
    expect(await albumSongIds(db, id)).toEqual(['a']);
  });

  it('rolls back shared sync writes and membership on invalid later album data', async () => {
    const { db } = await seeded();
    const remote = { id: 'r', name: 'Plan', songIds: ['a'], createdAt: 1, updatedAt: 1, leader: 'Original' };
    const id = (await applySharedAlbums(db, [remote])).get('r')!;
    await expect(applySharedAlbums(db, [
      { ...remote, leader: 'Changed', songIds: ['b'] },
      { ...remote, id: 'invalid', songIds: ['a', 'a'] },
    ])).rejects.toThrow();
    expect((await getAlbumPlan(db, id)).leader).toBe('Original');
    expect(await albumSongIds(db, id)).toEqual(['a']);
  });

  it('preserves actual imported songs, FTS entries and settings across canonical deletion and reset', async () => {
    const { db, sql } = await seeded();
    const id = await importPlanShare(db, {
      version: 1, name: 'Snapshot', songs: [{ id: 'a', chordpro: '{title: Snapshot}\\n[C]Sing' }],
      songSettings: { a: { bpm: 90 } },
    });
    const importedId = 'share:' + id + ':a';
    await applySyncPage(db, [{ id: 'a', number: null, title: 'a', key: null, bpm: null, timeSig: null,
      rhythm: null, chordpro: '', version: 2, updatedAt: 2, deletedAt: 2 }], '2:a');
    await resetSync(db);
    expect(await albumSongIds(db, id)).toEqual([importedId]);
    expect(await getAlbumSongSettings(db, id, importedId)).toEqual({ bpm: 90 });
    expect(sql.prepare('SELECT id FROM songs WHERE id = ?').get(importedId)).toMatchObject({ id: importedId });
    expect(sql.prepare('SELECT id FROM songs_fts WHERE id = ?').get(importedId)).toMatchObject({ id: importedId });
  });

  it('upgrades v2 atomically and retains albums, ordering and overrides', async () => {
    const { db, sql } = database();
    sql.exec(`CREATE TABLE songs(id TEXT PRIMARY KEY, title_norm TEXT, lyrics_norm TEXT);
      CREATE TABLE albums(id INTEGER PRIMARY KEY, name TEXT, created_at INTEGER, remote_id TEXT UNIQUE);
      CREATE TABLE album_songs(album_id INTEGER, song_id TEXT, position INTEGER);
      CREATE TABLE overrides(song_id TEXT, transpose INTEGER, capo INTEGER);
      INSERT INTO albums VALUES(1,'Existing',1,NULL);
      INSERT INTO album_songs VALUES(1,'a',2);
      INSERT INTO overrides VALUES('a',3,-1);
      PRAGMA user_version=2;`);
    await migrate(db);
    await migrate(db);
    expect(sql.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 4 });
    expect(await getAlbumPlan(db, 1)).toEqual({});
    expect(await albumSongIds(db, 1)).toEqual(['a']);
    expect(sql.prepare('SELECT * FROM overrides').get()).toMatchObject({ transpose: 3, capo: -1 });
  });

  it('rolls back all migration statements when one fails', async () => {
    const { db, sql } = database();
    sql.exec('CREATE TABLE albums(id INTEGER PRIMARY KEY, plan_pending INTEGER); PRAGMA user_version=2;');
    await expect(migrate(db)).rejects.toThrow();
    expect(sql.prepare('PRAGMA table_info(albums)').all().map((r) => r.name)).not.toContain('plan');
    expect(sql.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 2 });
  });

  it('retains settings on reorder and keeps personal overrides independent', async () => {
    const { db } = await seeded();
    const id = await createAlbum(db, 'Sunday');
    await toggleAlbumSong(db, id, 'a');
    await toggleAlbumSong(db, id, 'b');
    await saveOverride(db, 'a', 1, { transpose: 5, capo: 2 });
    await saveAlbumPlan(db, id, { serviceDate: '2028-02-29', leader: 'Олена' });
    await saveAlbumSongSettings(db, id, 'a', { transpose: -1, capo: -2, bpm: 92, notes: 'Без паузи' });
    await setAlbumOrder(db, id, ['b', 'a']);
    expect(await albumSongIds(db, id)).toEqual(['b', 'a']);
    expect(await getAlbumSongSettings(db, id, 'a')).toEqual({ transpose: -1, capo: -2, bpm: 92, notes: 'Без паузи' });
    expect(await getOverride(db, 'a')).toMatchObject({ transpose: 5, capo: 2 });
    await expect(saveAlbumSongSettings(db, id, 'missing', {})).rejects.toThrow();
    await expect(saveAlbumPlan(db, id, { serviceDate: '2026-02-30' })).rejects.toThrow();
    expect((await getAlbumPlan(db, id)).serviceDate).toBe('2028-02-29');
    await toggleAlbumSong(db, id, 'a');
    expect(await getAlbumSongSettings(db, id, 'a')).toEqual({});
  });

  it('preserves imported snapshot songs during reset', async () => {
    const { db, sql } = await seeded();
    await resetSync(db);
    expect(sql.prepare('SELECT id FROM songs').all().map((r) => r.id)).toEqual(['share:import:a']);
  });

  it('preserves pending plans on pull and applies clean remote plans', async () => {
    const { db } = await seeded();
    const remote = { id: 'remote', name: 'Sunday', songIds: ['a', 'b'], createdAt: 1, updatedAt: 1,
      serviceDate: '2026-12-01', songSettings: { a: { capo: -1, bpm: 80 } } };
    const id = (await applySharedAlbums(db, [remote])).get('remote')!;
    await saveAlbumPlan(db, id, { leader: 'Local' });
    await applySharedAlbums(db, [{ ...remote, leader: 'Server' }]);
    expect((await getAlbumPlan(db, id)).leader).toBe('Local');
    await applySharedAlbums(db, []);
    expect((await getAlbumPlan(db, id)).leader).toBe('Local');
    await applySharedAlbums(db, [remote], { discardPending: true });
    expect(await getAlbumSongSettings(db, id, 'a')).toEqual({ capo: -1, bpm: 80 });
  });
});

describe('quarantined offline shared edits', () => {
  it('ignores late authentication failure cleanup from an older account session', async () => {
    const { db } = await seeded();
    enableAlbumSession();
    const staleSession = albumSessionVersion();
    enableAlbumSession();
    await initializeSharedAlbumOwner(db, 'bob');
    const id = (await applySharedAlbums(db, [{ id: 'r', name: 'Bob', songIds: ['a'], createdAt: 1, updatedAt: 1 }])).get('r')!;
    await saveAlbumPlan(db, id, { notes: 'Bob draft' });
    expect(await clearAlbumSession(db, { expectedSession: staleSession })).toBe(false);
    expect((await getAlbumPlan(db, id)).notes).toBe('Bob draft');
  });

  it('hides drafts from other accounts and restores only their owner with order and settings intact', async () => {
    const { db, sql } = await seeded();
    await initializeSharedAlbumOwner(db, 'alice');
    const id = (await applySharedAlbums(db, [{ id: 'r', name: 'Plan', songIds: ['a', 'b'], createdAt: 1, updatedAt: 1 }])).get('r')!;
    await saveAlbumSongSettings(db, id, 'a', { bpm: 92, notes: 'Private draft' });
    await setAlbumOrder(db, id, ['b', 'a']);
    expect(await getPendingSharedAlbumCount(db)).toBe(1);
    await clearAlbumSession(db);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM albums').get()!.n).toBe(0);
    await restoreSharedAlbumDrafts(db, 'bob');
    expect(await getPendingSharedAlbumCount(db)).toBe(0);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM albums').get()!.n).toBe(0);
    await clearAlbumSession(db);
    await restoreSharedAlbumDrafts(db, 'alice');
    const restored = sql.prepare('SELECT id FROM albums WHERE remote_id = ?').get('r')!.id as number;
    expect(await albumSongIds(db, restored)).toEqual(['b', 'a']);
    expect(await getAlbumSongSettings(db, restored, 'a')).toEqual({ bpm: 92, notes: 'Private draft' });
    expect(await getPendingSharedAlbumCount(db)).toBe(1);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM pending_album_drafts').get()!.n).toBe(0);
  });

  it('retains downgraded-account quarantine and discards it only with explicit consent', async () => {
    const { db, sql } = await seeded();
    await initializeSharedAlbumOwner(db, 'alice');
    const id = (await applySharedAlbums(db, [{ id: 'r', name: 'Plan', songIds: ['a'], createdAt: 1, updatedAt: 1 }])).get('r')!;
    await saveAlbumPlan(db, id, { notes: 'Keep' });
    await clearAlbumSession(db);
    await restoreSharedAlbumDrafts(db, 'alice', false);
    expect(await getPendingSharedAlbumCount(db)).toBe(1);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM albums').get()!.n).toBe(0);
    await clearAlbumSession(db, { discardPending: true });
    await restoreSharedAlbumDrafts(db, 'alice');
    expect(await getPendingSharedAlbumCount(db)).toBe(0);
  });

  it('removes only deleted-user quarantine even after the active owner is cleared', async () => {
    const { db, sql } = await seeded();
    await sql.prepare('INSERT INTO pending_album_drafts(user_id,remote_id,snapshot) VALUES (?,?,?)').run('alice', 'a', '{}');
    await sql.prepare('INSERT INTO pending_album_drafts(user_id,remote_id,snapshot) VALUES (?,?,?)').run('bob', 'b', '{}');
    await discardQuarantinedAlbumDrafts(db, 'alice');
    expect(sql.prepare('SELECT user_id FROM pending_album_drafts').all().map((r) => r.user_id)).toEqual(['bob']);
  });

  it('does not delete visible drafts when quarantine cannot be persisted', async () => {
    const { db, sql } = await seeded();
    await initializeSharedAlbumOwner(db, 'alice');
    const id = (await applySharedAlbums(db, [{ id: 'r', name: 'Plan', songIds: ['a'], createdAt: 1, updatedAt: 1 }])).get('r')!;
    await saveAlbumPlan(db, id, { notes: 'Keep' });
    sql.exec("CREATE TRIGGER fail_draft BEFORE INSERT ON pending_album_drafts BEGIN SELECT RAISE(ABORT, 'disk failure'); END;");
    await expect(clearAlbumSession(db)).rejects.toThrow('disk failure');
    expect((await getAlbumPlan(db, id)).notes).toBe('Keep');
    expect(await albumSongIds(db, id)).toEqual(['a']);
  });
});

const serverSong = (id: string, title = id) => ({
  id, title, number: null, key: null, bpm: null, timeSig: null, rhythm: null,
  chordpro: '{title: ' + title + '}\\n[C]Words', version: 1, updatedAt: 1, deletedAt: null,
});

describe('safe full refresh', () => {
  it.each([1, 2])('keeps catalog, FTS and cursor when page %s fails', async (failedPage) => {
    const { db, sql } = await seeded();
    await clearAlbumSession(db);
    await applySyncPage(db, [serverSong('a', 'Original')], 'old');
    await db.runAsync("INSERT INTO meta(key,value) VALUES ('last_sync_at','123')");
    const before = sql.prepare('SELECT * FROM songs ORDER BY id').all();
    const ftsBefore = sql.prepare('SELECT * FROM songs_fts ORDER BY id').all();
    let page = 0;
    vi.mocked(api).mockImplementation(async () => {
      if (++page === failedPage) throw new ApiError(0, 'network');
      return { songs: [serverSong('new')], cursor: 'next', hasMore: true } as never;
    });
    await resyncNow(db);
    expect(sql.prepare('SELECT * FROM songs ORDER BY id').all()).toEqual(before);
    expect(sql.prepare('SELECT * FROM songs_fts ORDER BY id').all()).toEqual(ftsBefore);
    expect(await getCursor(db)).toBe('old');
    expect(getSyncStatus()).toMatchObject({ syncing: false, errorKind: 'offline', lastSyncAt: 123 });
  });

  it.each(['/parts', '/albums'])('keeps old catalog if the final %s request fails', async (failurePath) => {
    const { db, sql } = await seeded();
    await clearAlbumSession(db);
    enableAlbumSession();
    await applySyncPage(db, [serverSong('a')], 'old');
    const before = sql.prepare('SELECT * FROM songs ORDER BY id').all();
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === failurePath) throw new ApiError(0, 'network');
      if (path.startsWith('/sync')) return { songs: [serverSong('new')], cursor: 'new', hasMore: false } as never;
      return [] as never;
    });
    await resyncNow(db);
    expect(sql.prepare('SELECT * FROM songs ORDER BY id').all()).toEqual(before);
    expect(await getCursor(db)).toBe('old');
    expect(getSyncStatus().errorKind).toBe('offline');
  });

  it('atomically replaces stale canonical rows while retaining user edits and imported songs', async () => {
    const { db, sql } = await seeded();
    await clearAlbumSession(db);
    await applySyncPage(db, [serverSong('a'), serverSong('b')], 'old');
    const albumId = await importPlanShare(db, { version: 1, name: 'Imported', songs: [{ id: 'a', chordpro: '{title: Copy}' }] });
    const importedId = 'share:' + albumId + ':a';
    let release!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/parts') return [] as never;
      if (path.endsWith('cursor=')) return { songs: [serverSong('a', 'Updated')], cursor: 'page1', hasMore: true } as never;
      return new Promise((resolve) => { release = resolve; });
    });
    const refresh = resyncNow(db);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(syncNow(db)).toBe(refresh);
    await saveOverride(db, 'a', 1, { transpose: 3, chordpro: '{title: My edit}' });
    await saveAlbumPlan(db, albumId, { notes: 'My plan edit' });
    release({ songs: [serverSong('c')], cursor: 'complete', hasMore: false });
    await refresh;
    expect(sql.prepare('SELECT id FROM songs ORDER BY id').all().map((r) => r.id)).toEqual(['a', 'c', importedId, 'share:import:a'].sort());
    expect(sql.prepare('SELECT title FROM songs WHERE id = ?').get('a')!.title).toBe('Updated');
    expect(sql.prepare('SELECT id FROM songs_fts WHERE id = ?').get('b')).toBeUndefined();
    expect(sql.prepare('SELECT id FROM songs_fts WHERE id = ?').get(importedId)).toMatchObject({ id: importedId });
    expect(await getOverride(db, 'a')).toMatchObject({ transpose: 3, chordpro: '{title: My edit}' });
    expect((await getAlbumPlan(db, albumId)).notes).toBe('My plan edit');
    expect(await getCursor(db)).toBe('complete');
    expect(getSyncStatus()).toMatchObject({ syncing: false, error: null, errorKind: null });
    expect(Number(sql.prepare("SELECT value FROM meta WHERE key='last_sync_at'").get()!.value)).toBeGreaterThan(0);
  });

  it('rolls back replacement and FTS changes if the final SQL write fails', async () => {
    const { db, sql } = await seeded();
    await clearAlbumSession(db);
    await applySyncPage(db, [serverSong('a')], 'old');
    const before = sql.prepare('SELECT * FROM songs ORDER BY id').all();
    const ftsBefore = sql.prepare('SELECT * FROM songs_fts ORDER BY id').all();
    vi.mocked(api).mockImplementation(async (path) => path === '/parts' ? [] as never
      : { songs: [serverSong('c'), serverSong('share:forbidden')], cursor: 'new', hasMore: false } as never);
    await resyncNow(db);
    expect(sql.prepare('SELECT * FROM songs ORDER BY id').all()).toEqual(before);
    expect(sql.prepare('SELECT * FROM songs_fts ORDER BY id').all()).toEqual(ftsBefore);
    expect(await getCursor(db)).toBe('old');
    expect(getSyncStatus().errorKind).toBe('other');
  });

  it('queues a full refresh after an in-flight incremental sync', async () => {
    const { db } = await seeded();
    await clearAlbumSession(db);
    await applySyncPage(db, [serverSong('a')], 'old');
    let release!: (value: unknown) => void;
    const cursors: string[] = [];
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/parts') return [] as never;
      const cursor = new URL('https://test' + path).searchParams.get('cursor')!;
      cursors.push(cursor);
      if (cursor === 'old') return new Promise((resolve) => { release = resolve; });
      return { songs: [serverSong('final')], cursor: 'final', hasMore: false } as never;
    });
    const incremental = syncNow(db);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const refresh = resyncNow(db);
    release({ songs: [serverSong('intermediate')], cursor: 'intermediate', hasMore: false });
    await Promise.all([incremental, refresh]);
    expect(cursors).toEqual(['old', '']);
    expect(await getCursor(db)).toBe('final');
  });
});

describe('shared plan queue and account isolation', () => {
  it('does not replace a newer acknowledged write with an older in-flight pull', async () => {
    const { db } = await seeded();
    const remote = { id: 'r', name: 'Plan', songIds: ['a'], createdAt: 1, updatedAt: 1, leader: 'Old' };
    const id = (await applySharedAlbums(db, [remote])).get('r')!;
    enableAlbumSession();
    let release!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.startsWith('/sync')) return { songs: [], cursor: '', hasMore: false } as never;
      if (path === '/parts') return [] as never;
      if (path === '/albums' && !init) return new Promise((resolve) => { release = resolve; });
      return {} as never;
    });
    const sync = syncNow(db);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await saveAlbumPlan(db, id, { leader: 'New' });
    await flushPendingAlbums(db);
    release([remote]);
    await sync;
    expect((await getAlbumPlan(db, id)).leader).toBe('New');
  });

  it('retains pending edits as a personal album when the server album was deleted', async () => {
    const { db, sql } = await seeded();
    const id = (await applySharedAlbums(db, [{ id: 'r', name: 'Plan', songIds: ['a'], createdAt: 1, updatedAt: 1 }])).get('r')!;
    enableAlbumSession();
    await saveAlbumPlan(db, id, { notes: 'Keep this draft' });
    vi.mocked(api).mockRejectedValueOnce(new ApiError(404, 'not_found'));
    await flushPendingAlbums(db);
    expect(sql.prepare('SELECT remote_id, plan_pending FROM albums').get()).toMatchObject({ remote_id: null, plan_pending: 0 });
    expect((await getAlbumPlan(db, id)).notes).toBe('Keep this draft');
  });

  it('retries failed writes and does not acknowledge a newer edit', async () => {
    const { db, sql } = await seeded();
    const id = (await applySharedAlbums(db, [{ id: 'r', name: 'Plan', songIds: ['a'], createdAt: 1, updatedAt: 1 }])).get('r')!;
    enableAlbumSession();
    await saveAlbumSongSettings(db, id, 'a', { bpm: 90 });
    vi.mocked(api).mockRejectedValueOnce(new Error('offline'));
    await expect(flushPendingAlbums(db)).rejects.toThrow('offline');
    expect(sql.prepare('SELECT plan_pending FROM albums').get()!.plan_pending).toBe(1);
    vi.mocked(api).mockImplementationOnce(async () => {
      await saveAlbumPlan(db, id, { leader: 'New edit' });
      return {} as never;
    });
    await flushPendingAlbums(db);
    expect(sql.prepare('SELECT plan_pending FROM albums').get()!.plan_pending).toBe(2);
    vi.mocked(api).mockResolvedValue({});
    await flushPendingAlbums(db);
    expect(sql.prepare('SELECT plan_pending FROM albums').get()!.plan_pending).toBe(0);
    expect(vi.mocked(api).mock.calls.at(-1)![1]!.body).toMatchObject({ leader: 'New edit', songSettings: { a: { bpm: 90 } } });
  });

  it('stops old account requests, clears pending copies, and rejects late pulls', async () => {
    const { db, sql } = await seeded();
    const remote = { id: 'r', name: 'Plan', songIds: ['a'], createdAt: 1, updatedAt: 1 };
    const id = (await applySharedAlbums(db, [remote])).get('r')!;
    await saveAlbumPlan(db, id, { leader: 'Private draft' });
    enableAlbumSession();
    const generation = albumSessionVersion();
    let release!: (value: unknown) => void;
    vi.mocked(api).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const flush = flushPendingAlbums(db);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const clear = clearAlbumSession(db);
    release({});
    await Promise.all([flush, clear]);
    enableAlbumSession();
    await applySharedAlbums(db, [remote], { isCurrent: () => albumSessionVersion() === generation });
    await flushPendingAlbums(db);
    expect(sql.prepare('SELECT COUNT(*) AS n FROM albums').get()!.n).toBe(0);
    expect(api).toHaveBeenCalledTimes(1);
  });
});
