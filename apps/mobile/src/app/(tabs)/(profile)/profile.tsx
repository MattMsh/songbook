import SegmentedControl from '@expo/ui/community/segmented-control';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert } from 'react-native';
import { Button, Card, H, Row, Screen, T } from '@/components/ui';
import { API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { resetSync, searchEngine } from '@/lib/db';
import { type Settings, useSettings, useT } from '@/lib/settings';
import { syncNow, useSyncStatus } from '@/lib/sync';

const ROLE = { admin: 'адміністратор', musician: 'музикант', member: 'учасник' };

function Choice<K extends keyof Settings>({ name, options }: { name: K; options: [Settings[K], string][] }) {
  const { settings, update } = useSettings();
  return (
    <SegmentedControl
      values={options.map(([, label]) => label)}
      selectedIndex={options.findIndex(([value]) => value === settings[name])}
      onChange={(e) => update({ [name]: options[e.nativeEvent.selectedSegmentIndex][0] })}
    />
  );
}

export default function ProfileScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { user, logout } = useAuth();
  const sync = useSyncStatus();
  const t = useT();

  const resync = () =>
    Alert.alert(t('Пересинхронізувати все?'), t('Пісні завантажаться заново. Альбоми та ваші правки залишаться.'), [
      { text: t('Скасувати'), style: 'cancel' },
      { text: t('Так'), onPress: async () => (await resetSync(db), syncNow(db)) },
    ]);

  return (
    <Screen>
      <H>{t('Режим')}</H>
      <Choice name="mode" options={[['reader', t('Співаю / читаю')], ['musician', t('Музикант')]]} />
      <T muted style={{ fontSize: 13 }}>{t('«Музикант» одразу показує акорди, тональність, метроном і бій.')}</T>

      <H>{t('Нотація акордів')}</H>
      <Choice name="notation" options={[['auto', t('Як у пісні')], ['english', 'C D E … B'], ['german', 'C D E … H']]} />

      <H>{t('Мова')}</H>
      {/* Language names stay in their own language, so anyone can find theirs. */}
      <Choice name="language" options={[['uk', 'Українська'], ['ru', 'Русский']]} />

      <H>{t('Тема')}</H>
      <Choice name="theme" options={[['system', t('Системна')], ['light', t('Світла')], ['dark', t('Темна')]]} />
      <Button kind="secondary" icon="palette" title={t('Кольори блоків')} onPress={() => router.push('/part-colors')} />

      <H>{t('Акаунт')}</H>
      {user ? (
        <Card>
          <T>{user.name ?? user.email}</T>
          <T muted>{user.name ? `${user.email} · ${t(ROLE[user.role])}` : t(ROLE[user.role])}</T>
          <Row wrap>
            <Button small kind="secondary" title={t('Мої пропозиції')} onPress={() => router.push('/proposals/mine')} />
            <Button small kind="secondary" title={t('Запропонувати пісню')} onPress={() => router.push('/edit/new')} />
          </Row>
          {user.role === 'admin' && (
            <Row wrap>
              <Button small kind="secondary" icon="queue" title={t('Черга пропозицій')} onPress={() => router.push('/admin/queue')} />
              <Button small kind="secondary" icon="people" title={t('Користувачі')} onPress={() => router.push('/admin/users')} />
              <Button small kind="secondary" icon="blocks" title={t('Блоки пісень')} onPress={() => router.push('/admin/parts')} />
            </Row>
          )}
          <Button small kind="ghost" title={t('Вийти')} onPress={logout} />
        </Card>
      ) : (
        <Button title={t('Увійти')} onPress={() => router.push('/login')} />
      )}

      <H>{t('Синхронізація')}</H>
      <T muted style={{ fontSize: 13 }}>
        {sync.syncing
          ? t('Синхронізація…')
          : sync.error
            ? t('Офлайн: {error}', { error: sync.error })
            : sync.lastSyncAt
              ? t('Оновлено о {time}', { time: new Date(sync.lastSyncAt).toLocaleTimeString() })
              : t('Ще не синхронізовано')}
        {'\n'}
        {t('Сервер: {url} · пошук: {engine}', { url: API_URL, engine: searchEngine() })}
      </T>
      <Row wrap>
        <Button kind="secondary" icon="refresh" title={t('Оновити')} onPress={() => syncNow(db)} />
        <Button kind="ghost" title={t('Пересинхронізувати все')} onPress={resync} />
      </Row>
    </Screen>
  );
}
