import { FlashList } from '@shopify/flash-list';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSongSearch } from '@/components/song-search';
import { Banner, Icon, ListItem, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useSettings, useT, useTheme } from '@/lib/settings';
import { syncNow, useSyncStatus } from '@/lib/sync';

export default function SongsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const t = useT();
  const { mode } = useSettings().settings;
  const admin = useAuth().user?.role === 'admin';
  const sync = useSyncStatus();
  const { songs, loading, error, searching, controls } = useSongSearch();

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
      <FlashList
        data={songs}
        keyExtractor={(s) => s.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshing={sync.syncing}
        onRefresh={() => syncNow(db)}
        ListHeaderComponent={
          <View style={styles.search}>
            {controls}
            {sync.error && !songs.length && <Banner text={t('Офлайн: {error}. Потягніть вниз, щоб оновити.', { error: sync.error })} />}
          </View>
        }
        renderItem={({ item }) => (
          <ListItem
            title={`${item.number ?? '—'}. ${item.title}`}
            right={mode === 'musician' && item.key ? <T muted>{item.key}</T> : undefined}
            onPress={() => router.push(`/song/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          <T muted style={styles.empty}>
            {error ? null : t(loading || sync.syncing ? 'Завантаження…' : searching ? 'Нічого не знайдено' : 'Пісень поки немає')}
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
