import type { SharedAlbum } from '@songbook/shared';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Alert } from 'react-native';
import { api, ApiError, errorMessage } from './api';
import * as local from './db';
import { t } from './i18n';
import { syncNow } from './sync';

/**
 * Album writes. Albums that live only on this device change locally. A shared album
 * changes locally first, then the whole album is sent to the server; if that fails,
 * the user sees why and the next sync restores the server version.
 */

const failed = (db: SQLiteDatabase, e: unknown) => {
  Alert.alert(t('Спільний альбом не збережено'), errorMessage(e));
  syncNow(db);
};

async function push(db: SQLiteDatabase, albumId: number) {
  const album = await local.getAlbum(db, albumId);
  if (!album?.remote_id) return;
  try {
    await api(`/albums/${album.remote_id}`, {
      method: 'PUT',
      body: { name: album.name, songIds: await local.albumSongIds(db, albumId) },
    });
  } catch (e) {
    failed(db, e);
  }
}

/** Returns the local id of the new album, or null if the server refused a shared one. */
export async function createAlbum(db: SQLiteDatabase, name: string, shared = false) {
  if (!shared) return local.createAlbum(db, name);
  try {
    const album = await api<SharedAlbum>('/albums', { body: { name } });
    return (await local.applySharedAlbums(db, [album], { prune: false })).get(album.id)!;
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
  const album = await local.getAlbum(db, id);
  if (album?.remote_id) {
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
