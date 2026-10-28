import type { AlbumPlan, SongSettings, SharedAlbum } from '@songbook/shared';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Alert } from 'react-native';
import { api, ApiError, errorMessage } from './api';
import * as local from './db';
import { t } from './i18n';

/** Failed shared writes remain on disk and retry before the next pull. */
let pushing: Promise<void> | null = null;
let session = 0;
let enabled = false;
export const albumSessionVersion = () => session;
export const albumSessionActive = () => enabled;
export const enableAlbumSession = () => { session++; enabled = true; };

/** Stop requests before changing credentials, then remove the old account's shared cache. */
export async function clearAlbumSession(db: SQLiteDatabase, { discardPending = false, expectedSession }: { discardPending?: boolean; expectedSession?: number } = {}) {
  if (expectedSession !== undefined && expectedSession !== session) return false;
  enabled = false;
  const clearingSession = ++session;
  await pushing?.catch(() => {});
  return local.quarantineSharedAlbums(db, discardPending, () => clearingSession === session);
}

async function flush(db: SQLiteDatabase) {
  const generation = session;
  if (!enabled) return;
  const pending = await db.getAllAsync<{ id: number }>('SELECT id FROM albums WHERE remote_id IS NOT NULL AND plan_pending > 0');
  for (const { id } of pending) {
    if (!enabled || generation !== session) return;
    const snapshot = await db.getFirstAsync<{ name: string; remote_id: string; plan: string; plan_pending: number }>(
      'SELECT name, remote_id, plan, plan_pending FROM albums WHERE id = ?', id,
    );
    if (!snapshot?.remote_id) continue;
    const plan: AlbumPlan = JSON.parse(snapshot.plan);
    const songIds = await local.albumSongIds(db, id);
    if (!enabled || generation !== session) return;
    try {
      await api(`/albums/${snapshot.remote_id}`, {
        method: 'PUT',
        body: {
          name: snapshot.name, songIds,
          serviceDate: '', leader: '', notes: '', songSettings: {}, ...plan,
        },
      });
    } catch (e) {
      if (!enabled || generation !== session) return;
      if (!(e instanceof ApiError && e.status === 404)) throw e;
      await db.runAsync('UPDATE albums SET remote_id = NULL, plan_pending = 0 WHERE id = ?', id);
      local.bumpRevision();
      Alert.alert(t('Спільний альбом видалено'), t('Ваші зміни залишилися в особистому альбомі.'));
      continue;
    }
    if (!enabled || generation !== session) return;
    // A write made during the request must remain pending.
    await db.runAsync('UPDATE albums SET plan_pending = 0 WHERE id = ? AND plan_pending = ?', id, snapshot.plan_pending);
    local.bumpRevision();
  }
}

export async function flushPendingAlbums(db: SQLiteDatabase): Promise<void> {
  while (pushing) await pushing;
  pushing = flush(db).finally(() => { pushing = null; });
  return pushing;
}

async function push(db: SQLiteDatabase, albumId: number) {
  if (!(await local.getAlbum(db, albumId))?.remote_id) return;
  try {
    await flushPendingAlbums(db);
  } catch (e) {
    Alert.alert(t('Зміни збережено на пристрої'), t('Спільний план буде надіслано під час наступної синхронізації.') + '\n' + errorMessage(e));
  }
}

export async function saveAlbumPlan(db: SQLiteDatabase, id: number, plan: AlbumPlan) {
  await local.saveAlbumPlan(db, id, plan);
  await push(db, id);
}

export async function saveAlbumSongSettings(db: SQLiteDatabase, albumId: number, songId: string, settings: SongSettings) {
  await local.saveAlbumSongSettings(db, albumId, songId, settings);
  await push(db, albumId);
}

/** Returns the local id of the new album, or null if the server refused a shared one. */
export async function createAlbum(db: SQLiteDatabase, name: string, shared = false) {
  if (!shared) return local.createAlbum(db, name);
  const generation = session;
  if (!enabled) return null;
  try {
    const album = await api<SharedAlbum>('/albums', { body: { name } });
    return (await local.applySharedAlbums(db, [album], {
      prune: false, isCurrent: () => enabled && generation === session,
    })).get(album.id) ?? null;
  } catch (e) {
    Alert.alert(t('Спільний альбом не створено'), errorMessage(e));
    return null;
  }
}

export async function renameAlbum(db: SQLiteDatabase, id: number, name: string) {
  await local.renameAlbum(db, id, name);
  await push(db, id);
}

export async function toggleAlbumSong(db: SQLiteDatabase, albumId: number, songId: string) {
  await local.toggleAlbumSong(db, albumId, songId);
  await push(db, albumId);
}

export async function setAlbumOrder(db: SQLiteDatabase, albumId: number, ids: string[]) {
  await local.setAlbumOrder(db, albumId, ids);
  await push(db, albumId);
}

/** A shared album is deleted on the server first, so a failure leaves it in place. */
export async function deleteAlbum(db: SQLiteDatabase, id: number) {
  const generation = session;
  const album = await local.getAlbum(db, id);
  if (album?.remote_id) {
    if (!enabled || generation !== session) return false;
    try {
      await api(`/albums/${album.remote_id}`, { method: 'DELETE' });
    } catch (e) {
      // Another musician may have deleted it already.
      if (!(e instanceof ApiError && e.status === 404)) {
        Alert.alert(t('Спільний альбом не видалено'), errorMessage(e));
        local.bumpRevision();
        return false;
      }
    }
  }
  await local.deleteAlbum(db, id);
  return true;
}
