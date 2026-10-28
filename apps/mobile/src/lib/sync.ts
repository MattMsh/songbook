import type { SQLiteDatabase } from 'expo-sqlite';
import type { PartType, SharedAlbum, SyncPage, SyncSong } from '@songbook/shared';
import { useSyncExternalStore } from 'react';
import { api, ApiError, errorMessage } from './api';
import { applySharedAlbums, applySyncPage, bumpRevision, getCursor, getRevision, getSharedAlbumOwner,
  initializeSharedAlbumOwner, replaceCatalog } from './db';
import { setPartTypes } from './parts';
import { albumSessionActive, albumSessionVersion, clearAlbumSession, flushPendingAlbums } from './albums';

export interface SyncStatus {
  syncing: boolean;
  error: string | null;
  errorKind: 'offline' | 'other' | null;
  lastSyncAt: number | null;
}

let status: SyncStatus = { syncing: false, error: null, errorKind: null, lastSyncAt: null };
const listeners = new Set<() => void>();
const setStatus = (patch: Partial<SyncStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
};
export const getSyncStatus = () => status;
export const useSyncStatus = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    getSyncStatus,
  );

let running: Promise<void> | null = null;
let runningSession = 0;
let runningFull = false;

/** Never throws: failures remain available through useSyncStatus. */
export const syncNow = (db: SQLiteDatabase): Promise<void> => schedule(db, false);

/** Download before replacing the catalog; normal sync and full refresh cannot interleave. */
export const resyncNow = (db: SQLiteDatabase): Promise<void> => schedule(db, true);

function schedule(db: SQLiteDatabase, full: boolean): Promise<void> {
  const session = albumSessionVersion();
  if (running) {
    if (runningSession !== session || (full && !runningFull)) return running.then(() => schedule(db, full));
    return running;
  }
  runningSession = session;
  runningFull = full;
  running = run(db, full).finally(() => (running = null));
  return running;
}

async function syncSharedAlbums(db: SQLiteDatabase, session: number) {
  const isCurrent = () => albumSessionActive() && session === albumSessionVersion();
  try {
    if (!isCurrent()) return;
    await flushPendingAlbums(db);
    if (!isCurrent()) return;
    const revision = getRevision();
    const albums = await api<SharedAlbum[]>('/albums');
    // A newer local write can already be acknowledged while this older response is in flight.
    await applySharedAlbums(db, albums, { isCurrent: () => isCurrent() && revision === getRevision() });
  } catch (e) {
    if (!isCurrent()) return;
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      const owner = await getSharedAlbumOwner(db);
      const cleared = await clearAlbumSession(db, { expectedSession: session });
      if (cleared && albumSessionVersion() === session + 1) await initializeSharedAlbumOwner(db, owner);
    }
    throw e;
  }
}

async function run(db: SQLiteDatabase, full: boolean) {
  const session = albumSessionVersion();
  setStatus({ syncing: true, error: null, errorKind: null });
  try {
    const saved = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'last_sync_at'");
    const lastSyncAt = Number(saved?.value);
    setStatus({ lastSyncAt: Number.isFinite(lastSyncAt) && lastSyncAt > 0 ? lastSyncAt : null });
    let cursor = full ? '' : await getCursor(db);
    const downloaded: SyncSong[] = [];
    let complete = false;
    for (let page = 0; page < 1000; page++) {
      const res = await api<SyncPage>(`/sync?limit=500&cursor=${encodeURIComponent(cursor)}`);
      if (res.hasMore && res.cursor === cursor) throw new Error('Sync cursor did not advance');
      if (full) downloaded.push(...res.songs);
      else {
        await applySyncPage(db, res.songs, res.cursor);
        if (res.songs.length) bumpRevision();
      }
      cursor = res.cursor;
      if (!res.hasMore) { complete = true; break; }
    }
    if (!complete) throw new Error('Sync page limit exceeded');
    const parts = await api<PartType[]>('/parts');
    await syncSharedAlbums(db, session);
    const now = Date.now();
    if (full) await replaceCatalog(db, downloaded, cursor, now);
    else await db.runAsync("INSERT OR REPLACE INTO meta(key, value) VALUES ('last_sync_at', ?)", String(now));
    setPartTypes(parts);
    setStatus({ syncing: false, error: null, errorKind: null, lastSyncAt: now });
  } catch (e) {
    setStatus({ syncing: false, error: errorMessage(e), errorKind: e instanceof ApiError && e.status === 0 ? 'offline' : 'other' });
  }
}
