import type { SQLiteDatabase } from 'expo-sqlite';
import type { PartType, SharedAlbum, SyncPage } from '@songbook/shared';
import { useSyncExternalStore } from 'react';
import { api, ApiError, errorMessage } from './api';
import { applySharedAlbums, applySyncPage, bumpRevision, getCursor } from './db';
import { setPartTypes } from './parts';

export interface SyncStatus {
  syncing: boolean;
  error: string | null;
  lastSyncAt: number | null;
}

let status: SyncStatus = { syncing: false, error: null, lastSyncAt: null };
const listeners = new Set<() => void>();
const setStatus = (patch: Partial<SyncStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
};

export const useSyncStatus = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => status,
  );

let running: Promise<void> | null = null;

/** Pulls server deltas into SQLite. Never throws: errors only land in the sync status. */
export function syncNow(db: SQLiteDatabase): Promise<void> {
  running ??= run(db).finally(() => (running = null));
  return running;
}

/** Shared albums are for musicians; for anyone else the server answers 401/403 and the local copies go. */
async function syncSharedAlbums(db: SQLiteDatabase) {
  try {
    await applySharedAlbums(db, await api<SharedAlbum[]>('/albums'));
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) await applySharedAlbums(db, []);
    else throw e;
  }
}

async function run(db: SQLiteDatabase) {
  setStatus({ syncing: true });
  try {
    let cursor = await getCursor(db);
    for (let page = 0; page < 1000; page++) {
      const res = await api<SyncPage>(`/sync?limit=500&cursor=${encodeURIComponent(cursor)}`);
      await applySyncPage(db, res.songs, res.cursor);
      cursor = res.cursor;
      if (res.songs.length) bumpRevision();
      if (!res.hasMore) break;
    }
    setPartTypes(await api<PartType[]>('/parts'));
    await syncSharedAlbums(db);
    setStatus({ syncing: false, error: null, lastSyncAt: Date.now() });
  } catch (e) {
    setStatus({ syncing: false, error: errorMessage(e) });
  }
}
