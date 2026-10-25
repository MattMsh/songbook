import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import { Button, Field, Icon, ListItem, Row, Screen, T } from '@/components/ui';
import { createAlbum, toggleAlbumSong } from '@/lib/albums';
import { albumIdsWithSong, listAlbums, useRevision, type Album } from '@/lib/db';
import { SONGS } from '@/lib/i18n';
import { useT, useTheme } from '@/lib/settings';

export default function AddToAlbumScreen() {
  const { songId } = useLocalSearchParams<{ songId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const revision = useRevision();
  const { colors } = useTheme();
  const t = useT();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [member, setMember] = useState<number[]>([]);
  const [name, setName] = useState('');

  useEffect(() => {
    (async () => {
      setAlbums(await listAlbums(db));
      setMember(await albumIdsWithSong(db, songId));
    })();
  }, [db, songId, revision]);

  const toggle = (albumId: number) => {
    Haptics.selectionAsync().catch(() => {});
    toggleAlbumSong(db, albumId, songId);
  };

  const create = async () => {
    if (!name.trim()) return;
    await toggleAlbumSong(db, (await createAlbum(db, name))!, songId);
    setName('');
  };

  return (
    <Screen padded={false}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable accessibilityRole="button" hitSlop={8} style={{ paddingHorizontal: 8 }} onPress={() => router.back()}>
              <T style={{ color: colors.accent, fontSize: 17, fontWeight: '600' }}>{t('Готово')}</T>
            </Pressable>
          ),
        }}
      />
      <Row style={{ padding: 12 }}>
        <Field
          value={name}
          onChangeText={setName}
          placeholder={t('Новий альбом')}
          onSubmitEditing={create}
          style={{ flex: 1 }}
        />
        <Button icon="add" label={t('Створити альбом')} disabled={!name.trim()} onPress={create} />
      </Row>
      <T muted style={{ fontSize: 13, paddingHorizontal: 16 }}>
        {member.length
          ? t(member.length === 1 ? 'Пісня в альбомі: {names}' : 'Пісня в альбомах: {names}', {
              names: albums.filter((a) => member.includes(a.id)).map((a) => a.name).join(', '),
            })
          : albums.length
            ? t('Позначте альбоми для цієї пісні.')
            : t('Створіть перший альбом — пісню буде додано в нього одразу.')}
      </T>
      {albums.map((a) => (
        <ListItem
          key={a.id}
          title={a.name}
          subtitle={(a.remote_id ? t('Спільний') + ' · ' : '') + t(SONGS, { count: a.count })}
          onPress={() => toggle(a.id)}
          right={
            <Icon
              name={member.includes(a.id) ? 'checked' : 'unchecked'}
              size={24}
              color={member.includes(a.id) ? colors.accent : colors.muted}
            />
          }
        />
      ))}
    </Screen>
  );
}
