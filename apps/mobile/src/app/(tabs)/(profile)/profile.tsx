import { FieldGroup, Host, ListItem, RNHostView } from '@expo/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import { Banner, Button, H, Icon, T } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { pendingAccountDeletion } from '@/lib/account-deletion';
import { useAuth } from '@/lib/auth';
import { getPendingSharedAlbumCount, useRevision } from '@/lib/db';
import { type Settings, useSettings, useT, useTheme } from '@/lib/settings';
import { syncNow, useSyncStatus } from '@/lib/sync';

const ROLE = { admin: 'адміністратор', musician: 'музикант', member: 'учасник' };

function Choice<K extends keyof Settings>({ name, label, options }: {
  name: K;
  label: string;
  options: [Settings[K], string][];
}) {
  const { settings, update } = useSettings();
  const { colors } = useTheme();
  return (
    <RNHostView matchContents={{ vertical: true }}>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: 4 }}>
        <H>{label}</H>
        {options.map(([value, title]) => (
          <Pressable
            key={String(value)}
            accessibilityRole="radio"
            accessibilityLabel={title}
            accessibilityState={{ checked: settings[name] === value }}
            onPress={() => update({ [name]: value })}
            style={({ pressed }) => ({ minHeight: Platform.OS === 'android' ? 48 : 44, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.7 : 1 })}>
            <Icon name={settings[name] === value ? 'checked' : 'unchecked'} color={colors.accent} />
            <T style={{ flex: 1, flexShrink: 1 }}>{title}</T>
          </Pressable>
        ))}
      </View>
    </RNHostView>
  );
}

export default function ProfileScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { user, logout, ready } = useAuth();
  const { settings } = useSettings();
  const sync = useSyncStatus();
  const revision = useRevision();
  const t = useT();
  const [pending, setPending] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');
  const [hasPendingDeletion, setHasPendingDeletion] = useState(false);

  useFocusEffect(useCallback(() => {
    let stale = false;
    pendingAccountDeletion().then((marker) => !stale && setHasPendingDeletion(marker !== null)).catch(() => !stale && setError(t('Не вдалося перевірити незавершене видалення акаунта. Спробуйте відкрити профіль ще раз.')));
    return () => { stale = true; };
  }, [ready, user?.id, t]));

  useEffect(() => {
    let stale = false;
    setPending(null);
    getPendingSharedAlbumCount(db).then((count) => !stale && setPending(count)).catch((e) => !stale && setError(errorMessage(e)));
    return () => { stale = true; };
  }, [db, revision, user?.id]);

  const confirmDiscard = () => Alert.alert(
    t('Є ненадіслані зміни'),
    t('Спочатку синхронізуйте зміни спільних альбомів. Якщо вийдете зараз, ці зміни буде відкинуто.'),
    [
      { text: t('Скасувати'), style: 'cancel' },
      { text: t('Вийти й відкинути зміни'), style: 'destructive', onPress: () => { void leave(true); } },
    ],
  );
  const leave = async (discardPending = false) => {
    setLoggingOut(true);
    setError('');
    try {
      if (!discardPending && await getPendingSharedAlbumCount(db) > 0) {
        confirmDiscard();
        return;
      }
      await logout({ discardPending, expectedUserId: user?.id });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'pending_shared_changes') confirmDiscard();
      else setError(errorMessage(e));
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <Host style={{ flex: 1 }}>
      <FieldGroup>
        <FieldGroup.Section title={t('Акаунт')} disabled={!ready || loggingOut}>
          <RNHostView matchContents={{ vertical: true }}>
            <View style={{ gap: 8 }}>
              {!ready && <T>{t('Завантаження…')}</T>}
              {user ? (
                <>
                  <T selectable>{user.name ?? user.email}</T>
                  {user.name && <T selectable muted>{user.email}</T>}
                  <T muted>{t('Права акаунта: {role}', { role: t(ROLE[user.role]) })}</T>
                </>
              ) : <T>{t('Увійдіть, щоб ділитися піснями, працювати зі спільними альбомами та надсилати пропозиції.')}</T>}
              {error ? <Banner kind="warn" text={error} /> : null}
              {loggingOut && <T accessibilityLiveRegion="polite">{t('Вихід…')}</T>}
            </View>
          </RNHostView>
          {user ? (
            <>
              <ListItem onPress={() => router.push('/proposals/mine')}>{t('Мої пропозиції')}</ListItem>
              <ListItem onPress={() => router.push('/edit/new')}>{t('Запропонувати пісню')}</ListItem>
              <RNHostView matchContents={{ vertical: true }}>
                <Button kind="ghost" title={t(loggingOut ? 'Вихід…' : 'Вийти')} busy={loggingOut} onPress={() => { void leave(); }} />
              </RNHostView>
            </>
          ) : <ListItem onPress={() => router.push('/login')}>{t('Увійти')}</ListItem>}
          {(user || hasPendingDeletion) && <ListItem onPress={() => router.push('/delete-account')}>{t(hasPendingDeletion ? 'Завершити видалення акаунта' : 'Видалити акаунт')}</ListItem>}
        </FieldGroup.Section>

        <FieldGroup.Section title={t('Вигляд пісень')}>
          <Choice name="mode" label={t('Режим перегляду')} options={[['reader', t('Співаю / читаю')], ['musician', t('Музикант')]]} />
          <RNHostView matchContents={{ vertical: true }}>
            <T muted>{t('Режим «Музикант» показує акорди й інструменти лише на цьому пристрої. Він не змінює права акаунта.')}</T>
          </RNHostView>
          <Choice name="notation" label={t('Нотація акордів')} options={[['auto', t('Як у пісні')], ['english', 'C D E … B'], ['german', 'C D E … H']]} />
          <ListItem onPress={() => router.push('/part-colors')}>{t('Кольори блоків')}</ListItem>
        </FieldGroup.Section>

        <FieldGroup.Section title={t('Мова й тема')}>
          <Choice name="language" label={t('Мова')} options={[['uk', 'Українська'], ['ru', 'Русский']]} />
          <Choice name="theme" label={t('Тема')} options={[['system', t('Системна')], ['light', t('Світла')], ['dark', t('Темна')]]} />
        </FieldGroup.Section>

        <FieldGroup.Section title={t('Синхронізація')} disabled={sync.syncing}>
          <RNHostView matchContents={{ vertical: true }}>
            <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
              {sync.syncing && <T>{t('Синхронізація…')}</T>}
              <T>{sync.lastSyncAt
                ? t('Остання успішна синхронізація: {time}', { time: new Date(sync.lastSyncAt).toLocaleString(settings.language === 'uk' ? 'uk-UA' : 'ru-RU') })
                : t('Ще не синхронізовано')}</T>
              <T muted>{pending === null ? t('Перевірка змін…') : t('Ненадіслані зміни спільних альбомів: {count}', { count: pending })}</T>
              {sync.error && <Banner kind="warn" text={t('Не вдалося синхронізувати: {error}', { error: sync.error })} />}
            </View>
          </RNHostView>
          <ListItem onPress={() => { void syncNow(db); }}>{t('Оновити')}</ListItem>
          <ListItem onPress={() => router.push('/diagnostics')}>{t('Діагностика')}</ListItem>
        </FieldGroup.Section>

        {user?.role === 'admin' && (
          <FieldGroup.Section title={t('Адміністрування')}>
            <ListItem onPress={() => router.push('/admin/queue')}>{t('Черга пропозицій')}</ListItem>
            <ListItem onPress={() => router.push('/admin/users')}>{t('Користувачі')}</ListItem>
            <ListItem onPress={() => router.push('/admin/parts')}>{t('Блоки пісень')}</ListItem>
          </FieldGroup.Section>
        )}
      </FieldGroup>
    </Host>
  );
}
