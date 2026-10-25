import SegmentedControl from '@expo/ui/community/segmented-control';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { confirmDeleteAlbum, promptRenameAlbum } from '@/components/album-actions';
import { AlbumList } from '@/components/album-list';
import { Button, Field, Row, T } from '@/components/ui';
import { createAlbum, deleteAlbum } from '@/lib/albums';
import { useAuth } from '@/lib/auth';
import { listAlbums, useRevision, type Album } from '@/lib/db';
import { useT, useTheme } from '@/lib/settings';

export default function AlbumsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const revision = useRevision();
  const { colors } = useTheme();
  const t = useT();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [name, setName] = useState('');
  const role = useAuth().user?.role;
  const canShare = role === 'musician' || role === 'admin';
  const [tab, setTab] = useState<'mine' | 'shared'>('mine');
  const kind = canShare ? tab : 'mine';

  useEffect(() => {
    listAlbums(db, kind).then(setAlbums);
  }, [db, revision, kind]);

  const create = async () => {
    if (!name.trim()) return;
    // A failed shared create keeps the typed name, so the user can retry.
    if ((await createAlbum(db, name, kind === 'shared')) !== null) setName('');
  };
  // Remove the row first so the native list does not show it again while the write runs.
  const remove = (albumId: number) => {
    setAlbums((list) => list.filter((a) => a.id !== albumId));
    deleteAlbum(db, albumId);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {canShare && (
        <SegmentedControl
          style={{ marginHorizontal: 12, marginTop: 12 }}
          values={[t('Мої'), t('Спільні')]}
          selectedIndex={kind === 'shared' ? 1 : 0}
          onChange={(e) => setTab(e.nativeEvent.selectedSegmentIndex ? 'shared' : 'mine')}
        />
      )}
      <Row style={{ padding: 12 }}>
        <Field
          value={name}
          onChangeText={setName}
          placeholder={t(kind === 'shared' ? 'Новий спільний альбом' : 'Новий альбом, напр. «Неділя 10:00»')}
          onSubmitEditing={create}
          returnKeyType="done"
          style={{ flex: 1 }}
        />
        <Button icon="add" label={t('Створити альбом')} disabled={!name.trim()} onPress={create} />
      </Row>
      {albums.length > 0 && (
        <AlbumList
          albums={albums}
          onOpen={(id) => router.push(`/album/${id}`)}
          onDelete={remove}
          onRename={(a) => promptRenameAlbum(db, a)}
          onAskDelete={(a) => confirmDeleteAlbum(db, a)}
        />
      )}
      {!albums.length && (
        <T muted style={{ textAlign: 'center', padding: 32 }}>
          {t(
            kind === 'shared'
              ? 'Спільних альбомів ще немає. Створіть сет-лист — його побачать усі музиканти.'
              : 'Альбоми зберігаються на цьому пристрої. Створіть сет-лист на служіння і додавайте пісні кнопкою «+» на екрані пісні.',
          )}
        </T>
      )}
    </View>
  );
}
