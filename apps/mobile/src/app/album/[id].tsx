import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { confirmDeleteAlbum, promptRenameAlbum } from '@/components/album-actions';
import { AlbumSongs } from '@/components/album-songs';
import { T } from '@/components/ui';
import { setAlbumOrder, toggleAlbumSong } from '@/lib/albums';
import {
  albumSongs,
  getAlbum,
  useRevision,
  type SongListItem,
} from '@/lib/db';
import { useT, useTheme } from '@/lib/settings';

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const albumId = Number(id);
  const db = useSQLiteContext();
  const router = useRouter();
  const revision = useRevision();
  const { colors } = useTheme();
  const t = useT();
  const [name, setName] = useState('');
  const [songs, setSongs] = useState<SongListItem[]>([]);

  useEffect(() => {
    (async () => {
      const album = await getAlbum(db, albumId);
      if (!album) return;
      setName(album.name);
      setSongs(await albumSongs(db, albumId));
    })();
  }, [db, albumId, revision]);

  const album = { id: albumId, name };

  // Update the list first so a dropped row does not jump back while the write runs.
  const reorder = (next: SongListItem[]) => {
    setSongs(next);
    setAlbumOrder(db, albumId, next.map((s) => s.id));
  };
  const removeSong = (songId: string) => {
    setSongs((list) => list.filter((s) => s.id !== songId));
    toggleAlbumSong(db, albumId, songId);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: name }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={t('Дії з альбомом')}>
          <Stack.Toolbar.MenuAction icon="pencil" onPress={() => promptRenameAlbum(db, album)}>
            {t('Перейменувати')}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => confirmDeleteAlbum(db, album, () => router.back())}>
            {t('Видалити альбом')}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      {songs.length > 0 && (
        <AlbumSongs
          songs={songs}
          onOpen={(songId) => router.push({ pathname: '/song/[id]', params: { id: songId, album: id } })}
          onReorder={reorder}
          onRemove={removeSong}
        />
      )}
      {!songs.length && (
        <T muted style={{ textAlign: 'center', padding: 32 }}>
          {t('Додайте пісні кнопкою «+» на екрані пісні.')}
        </T>
      )}
    </View>
  );
}
