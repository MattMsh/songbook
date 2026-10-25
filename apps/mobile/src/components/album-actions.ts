import type { SQLiteDatabase } from 'expo-sqlite';
import { Alert } from 'react-native';
import { deleteAlbum, renameAlbum } from '@/lib/albums';
import type { Album } from '@/lib/db';
import { t } from '@/lib/i18n';

type AlbumRef = Pick<Album, 'id' | 'name'>;

// shortcut: Alert.prompt is iOS-only, so Android cannot rename albums; add a text field there if needed.
export const promptRenameAlbum = (db: SQLiteDatabase, album: AlbumRef) =>
  Alert.prompt(
    t('Перейменувати альбом'),
    undefined,
    [
      { text: t('Скасувати'), style: 'cancel' },
      { text: t('Зберегти'), onPress: (value = '') => value.trim() && renameAlbum(db, album.id, value) },
    ],
    'plain-text',
    album.name,
  );

export const confirmDeleteAlbum = (db: SQLiteDatabase, album: AlbumRef, onDeleted?: () => void) =>
  Alert.alert(t('Видалити альбом?'), album.name, [
    { text: t('Скасувати'), style: 'cancel' },
    { text: t('Видалити'), style: 'destructive', onPress: async () => (await deleteAlbum(db, album.id)) && onDeleted?.() },
  ]);
