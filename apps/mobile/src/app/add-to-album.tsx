import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Pressable } from 'react-native';
import { Button, Field, Icon, ListItem, Row, Screen, T } from '@/components/ui';
import { createAlbum, toggleAlbumSong } from '@/lib/albums';
import { errorMessage } from '@/lib/api';
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([listAlbums(db), albumIdsWithSong(db, songId)]).then(([albums, member]) => {
      if (active) { setAlbums(albums); setMember(member); }
    }).catch((error) => { if (active) Alert.alert(t('Помилка'), errorMessage(error)); });
    return () => { active = false; };
  }, [db, songId, revision, t]);

  const toggle = async (albumId: number) => {
    if (saving) return;
    setSaving(true);
    Haptics.selectionAsync().catch(() => {});
    try { await toggleAlbumSong(db, albumId, songId); }
    catch (error) { Alert.alert(t('Помилка'), errorMessage(error)); }
    finally { setSaving(false); }
  };

  const create = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const albumId = await createAlbum(db, name);
      if (albumId === null) return;
      await toggleAlbumSong(db, albumId, songId);
      setName('');
    } catch (error) { Alert.alert(t('Помилка'), errorMessage(error)); }
    finally { setSaving(false); }
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
        <Button icon="add" label={t('Створити альбом')} disabled={saving || !name.trim()} onPress={create} />
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
