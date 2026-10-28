import { FieldGroup, Host, ListItem, RNHostView } from '@expo/ui';
import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Banner, T } from '@/components/ui';
import { API_URL, errorMessage } from '@/lib/api';
import { searchEngine } from '@/lib/db';
import { useT } from '@/lib/settings';
import { resyncNow, useSyncStatus } from '@/lib/sync';

export default function DiagnosticsScreen() {
  const db = useSQLiteContext();
  const t = useT();
  const sync = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reload = async () => {
    setBusy(true);
    setError('');
    try {
      await resyncNow(db);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const confirmReload = () => Alert.alert(
    t('Пересинхронізувати все?'),
    t('Пісні завантажаться заново із сервера. Альбоми та ваші правки залишаться. Якщо запит не вдасться, доступні пісні залишаться на пристрої.'),
    [
      { text: t('Скасувати'), style: 'cancel' },
      { text: t('Завантажити пісні заново'), onPress: () => { void reload(); } },
    ],
  );
  return (
    <Host style={{ flex: 1 }}>
      <Stack.Screen options={{ title: t('Діагностика') }} />
      <FieldGroup>
        <FieldGroup.Section title={t('Технічні відомості')}>
          <RNHostView matchContents={{ vertical: true }}>
            <View style={{ gap: 12 }}>
              <T selectable>{t('Сервер: {url}', { url: API_URL })}</T>
              <T>{t('Пошук: {engine}', { engine: searchEngine() })}</T>
            </View>
          </RNHostView>
        </FieldGroup.Section>
        <FieldGroup.Section title={t('Синхронізація')} disabled={busy || sync.syncing}>
          <RNHostView matchContents={{ vertical: true }}>
            <View style={{ gap: 8 }}>
              {(busy || sync.syncing) && <T accessibilityLiveRegion="polite">{t('Синхронізація…')}</T>}
              {(error || sync.error) && <Banner kind="warn" text={t('Не вдалося синхронізувати: {error}', { error: error || sync.error || '' })} />}
              <T muted>{t('Повне завантаження потрібне лише для усунення проблем із каталогом пісень.')}</T>
            </View>
          </RNHostView>
          <ListItem onPress={confirmReload}>{t('Завантажити пісні заново')}</ListItem>
        </FieldGroup.Section>
      </FieldGroup>
    </Host>
  );
}
