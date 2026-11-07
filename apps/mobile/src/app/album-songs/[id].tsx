import * as Haptics from 'expo-haptics';
import { FlashList } from '@shopify/flash-list';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSongSearch } from '@/components/song-search';
import { BottomBar, Button, H, Icon, ListItem, T } from '@/components/ui';
import { editAlbumSongs } from '@/lib/albums';
import { errorMessage } from '@/lib/api';
import { albumSongs, getAlbum, getAlbumPlan, useRevision, type SongListItem } from '@/lib/db';
import { useSettings, useT, useTheme } from '@/lib/settings';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';

type Row = { type: 'header'; title: string } | { type: 'song'; song: SongListItem };

/** Picks many songs at once. Changes stay on this page until the user saves them. */
export default function AlbumSongsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const albumId = Number(id);
  const db = useSQLiteContext();
  const router = useRouter();
  const revision = useRevision();
  const { colors } = useTheme();
  const t = useT();
  const { mode } = useSettings().settings;
  const search = useSongSearch();
  const headerHeight = useHeaderHeight();
  const [current, setCurrent] = useState<SongListItem[]>([]);
  const [shared, setShared] = useState(false);
  // Only the user's own changes, so songs others add meanwhile stay in the album.
  const [added, setAdded] = useState<SongListItem[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getAlbum(db, albumId), albumSongs(db, albumId)]).then(([album, songs]) => {
      if (active) { setShared(!!album?.remote_id); setCurrent(songs); }
    }).catch((error) => { if (active) Alert.alert(t('Помилка'), errorMessage(error)); });
    return () => { active = false; };
  }, [db, albumId, revision, t]);

  const inAlbum = (songId: string) => current.some((s) => s.id === songId);
  const adds = added.filter((s) => !inAlbum(s.id));
  const removes = removed.filter(inAlbum);
  const selected = [...current.filter((s) => !removed.includes(s.id)), ...adds];
  const isSelected = (songId: string) => selected.some((s) => s.id === songId);
  const dirty = adds.length > 0 || removes.length > 0;
  // Back is the cancel action; it asks before dropping changes.
  useUnsavedChanges(dirty && !done, saving);
  useEffect(() => { if (done && !saving) router.back(); }, [done, saving, router]);

  const toggle = (song: SongListItem) => {
    Haptics.selectionAsync().catch(() => {});
    if (isSelected(song.id)) {
      if (added.some((s) => s.id === song.id)) setAdded(added.filter((s) => s.id !== song.id));
      else setRemoved([...removed, song.id]);
    } else if (removed.includes(song.id)) setRemoved(removed.filter((x) => x !== song.id));
    else setAdded([...added, song]);
  };

  const commit = async () => {
    setSaving(true);
    try {
      await editAlbumSongs(db, albumId, adds.map((s) => s.id), removes);
      setDone(true);
    } catch (error) { Alert.alert(t('Помилка'), errorMessage(error)); }
    finally { setSaving(false); }
  };
  const save = async () => {
    if (!dirty || saving) return;
    try {
      const settings = (await getAlbumPlan(db, albumId)).songSettings ?? {};
      const count = removes.filter((songId) => Object.keys(settings[songId] ?? {}).length).length;
      if (!count) return commit();
      Alert.alert(
        t('Видалити налаштування пісень?'),
        t('Пісень із налаштуваннями для цього альбому: {count}. Ці налаштування буде видалено.', { count }),
        [{ text: t('Скасувати'), style: 'cancel' }, { text: t('Зберегти'), style: 'destructive', onPress: commit }],
      );
    } catch (error) { Alert.alert(t('Помилка'), errorMessage(error)); }
  };

  // Snapshot songs cannot be part of a shared album.
  const allowed = (s: SongListItem) => !(shared && s.id.startsWith('share:'));
  const results = search.songs.filter(allowed);
  const rows: Row[] = search.searching
    ? results.map((song) => ({ type: 'song', song }))
    : [
        ...(selected.length ? [{ type: 'header', title: t('Вибрані ({count})', { count: selected.length }) } as Row] : []),
        ...selected.map((song): Row => ({ type: 'song', song })),
        { type: 'header', title: t('Усі пісні') },
        ...results.filter((s) => !isSelected(s.id)).map((song): Row => ({ type: 'song', song })),
      ];
  const changes = [adds.length && `+${adds.length}`, removes.length && `−${removes.length}`].filter(Boolean).join(' ');

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={headerHeight}>
      <Stack.Screen options={{ title: t('Пісні альбому') }} />
      <FlashList
        data={rows}
        keyExtractor={(row) => row.type === 'header' ? 'header:' + row.title : row.song.id}
        getItemType={(row) => row.type}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={<View style={styles.search}>{search.controls}</View>}
        renderItem={({ item }) => {
          if (item.type === 'header') return <View style={styles.header}><H>{item.title}</H></View>;
          const checked = isSelected(item.song.id);
          return (
            <ListItem
              title={`${item.song.number ?? '—'}. ${item.song.title}`}
              left={<Icon name={checked ? 'checked' : 'unchecked'} size={24} color={checked ? colors.accent : colors.muted} />}
              right={mode === 'musician' && item.song.key ? <T muted>{item.song.key}</T> : undefined}
              accessibilityState={{ checked }}
              onPress={() => toggle(item.song)}
            />
          );
        }}
        ListEmptyComponent={search.searching && !search.error
          ? <T muted style={styles.empty}>{t(search.loading ? 'Завантаження…' : 'Нічого не знайдено')}</T>
          : null}
      />
      <BottomBar>
        <Button title={changes ? t('Зберегти · {changes}', { changes }) : t('Зберегти')} busy={saving} disabled={!dirty} onPress={save} />
      </BottomBar>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  search: { padding: 12, gap: 8 },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  empty: { textAlign: 'center', padding: 32 },
});
