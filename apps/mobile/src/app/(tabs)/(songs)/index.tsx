import { FlashList } from '@shopify/flash-list';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Banner, Field, Icon, ListItem, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { searchSongs, useRevision, type SongListItem } from '@/lib/db';
import { useSettings, useT, useTheme } from '@/lib/settings';
import { syncNow, useSyncStatus } from '@/lib/sync';

export default function SongsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const t = useT();
  const { mode } = useSettings().settings;
  const admin = useAuth().user?.role === 'admin';
  const revision = useRevision();
  const sync = useSyncStatus();
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<SongListItem[]>([]);

  useEffect(() => {
    let stale = false;
    searchSongs(db, query).then((r) => !stale && setSongs(r));
    return () => {
      stale = true;
    };
  }, [db, query, revision]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Admins publish a new song; musicians suggest one for review. Readers only read. */}
      <Stack.Screen
        options={{
          headerRight:
            admin || mode === 'musician'
              ? () => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(admin ? 'Нова пісня' : 'Запропонувати пісню')}
                    hitSlop={8}
                    style={{ paddingHorizontal: 6 }}
                    onPress={() => router.push('/edit/new')}>
                    <Icon name="add" size={22} color={colors.accent} />
                  </Pressable>
                )
              : undefined,
        }}
      />
      <View style={styles.search}>
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder={t('Номер, назва або слова')}
          clearButtonMode="while-editing"
          autoCorrect={false}
          returnKeyType="search"
        />
        {sync.error && !songs.length && <Banner text={t('Офлайн: {error}. Потягніть вниз, щоб оновити.', { error: sync.error })} />}
      </View>
      <FlashList
        data={songs}
        keyExtractor={(s) => s.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshing={sync.syncing}
        onRefresh={() => syncNow(db)}
        renderItem={({ item }) => (
          <ListItem
            title={`${item.number ?? '—'}. ${item.title}`}
            right={mode === 'musician' && item.key ? <T muted>{item.key}</T> : undefined}
            onPress={() => router.push(`/song/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          <T muted style={styles.empty}>
            {t(query ? 'Нічого не знайдено' : sync.syncing ? 'Завантаження…' : 'Пісень поки немає')}
          </T>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { padding: 12, gap: 8 },
  empty: { textAlign: 'center', padding: 32 },
});
