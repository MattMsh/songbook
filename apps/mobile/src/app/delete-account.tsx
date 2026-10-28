import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking } from 'react-native';
import { Banner, Button, Card, Field, Screen, T } from '@/components/ui';
import {
  APPLE_REVOCATION_HELP_URL, deleteAccountOnServer, finishAccountDeletion, pendingAccountDeletion,
  type AccountDeletionResult,
} from '@/lib/account-deletion';
import { ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/settings';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const t = useT();
  const { user, ready, completeAccountDeletion } = useAuth();
  const [userId, setUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState<string>();
  const [reauthenticate, setReauthenticate] = useState(false);
  const [serverDeleted, setServerDeleted] = useState(false);
  const [result, setResult] = useState<AccountDeletionResult>();
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    pendingAccountDeletion().then((saved) => {
      if (!active) return;
      setUserId(saved?.userId ?? user?.id ?? null);
      setPending(Boolean(saved));
      setServerDeleted(Boolean(saved?.result));
      setResult(saved?.result);
    }).catch((e) => { if (active) setError(errorMessage(e)); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [ready]);

  const login = () => router.push({ pathname: '/login', params: { returnTo: '/delete-account' } });
  const remove = async () => {
    if (!userId || locked.current || user && user.id !== userId) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    setReauthenticate(false);
    try {
      const deleted = await deleteAccountOnServer(userId);
      setResult(deleted);
      setServerDeleted(true);
      await completeAccountDeletion(userId);
      await finishAccountDeletion();
      setComplete(true);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 401) {
        setPending(false);
        setReauthenticate(true);
        setError(t('Для видалення підтвердьте вхід у цей акаунт ще раз.'));
      } else setPending(true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const confirm = () => Alert.alert(t('Назавжди видалити акаунт?'),
    t('Цю дію неможливо скасувати. Усі сеанси завершаться, пропозиції та створені вами посилання буде видалено.'),
    [{ text: t('Скасувати'), style: 'cancel' }, { text: t('Видалити акаунт'), style: 'destructive', onPress: () => void remove() }]);
  const appleHelp = async () => {
    try { await Linking.openURL(APPLE_REVOCATION_HELP_URL); }
    catch (e) { setError(errorMessage(e)); }
  };

  return <Screen>
    <Stack.Screen options={{ title: t('Видалення акаунта'), gestureEnabled: !busy, headerBackVisible: !busy }} />
    {(!ready || !loaded || busy) && <ActivityIndicator accessibilityLabel={t('Завантаження…')} />}
    {error && <Banner text={error} kind="warn" />}
    {complete ? <>
      <T selectable>{t('Акаунт і його особисті дані видалено. Спільні пісні та церковні плани збережено.')}</T>
      {result?.appleRevocation === 'manual_required' && <Card>
        <T selectable>{t('Якщо ви входили через Apple, окремо скасуйте доступ Songbook у налаштуваннях Apple Account. Видалення акаунта вже завершено.')}</T>
        <Button title={t('Як скасувати доступ Apple')} onPress={() => void appleHelp()} />
      </Card>}
      <Button title={t('Готово')} onPress={() => router.replace('/profile')} />
    </> : loaded && <>
      {serverDeleted ? <Banner kind="warn" text={t('Акаунт на сервері вже видалено. Завершіть очищення особистих даних на цьому пристрої.')} /> : <>
        <T selectable>{t('Буде видалено акаунт, усі його сеанси, пропозиції змін і створені ним посилання на плани.')}</T>
        <T selectable>{t('На цьому пристрої буде видалено лише особисті нотатки, аудіо та незбережені спільні зміни цього акаунта. Дані інших акаунтів і гостя залишаться.')}</T>
        <T selectable>{t('Спільні пісні та церковні плани залишаться без прив’язки до вашого акаунта. Окремі локальні альбоми та зміни тексту на пристрої залишаться.')}</T>
      </>}
      {user && user.id !== userId ? <>
        <Banner kind="warn" text={t('Зараз відкрито інший акаунт. Вийдіть із нього в профілі, щоб завершити видалення попереднього акаунта.')} />
        <Button title={t('Профіль')} onPress={() => router.replace('/profile')} />
      </> : userId ? <>
        {user && <T selectable>{user.email}</T>}
        {!pending && !reauthenticate && <>
          <T>{t('Щоб підтвердити, введіть DELETE.')}</T>
          <Field value={confirmation} onChangeText={setConfirmation} editable={!busy} autoCapitalize="characters" autoCorrect={false} accessibilityLabel={t('Підтвердження видалення')} />
          <Button title={t('Видалити акаунт')} kind="danger" disabled={busy || confirmation.trim() !== 'DELETE'} onPress={confirm} />
        </>}
        {pending && !reauthenticate && <Button title={serverDeleted ? t('Завершити очищення') : t('Повторити запит видалення')} kind="danger" disabled={busy} onPress={() => void remove()} />}
        {reauthenticate && <Button title={t('Підтвердити вхід')} disabled={busy} onPress={login} />}
      </> : <Button title={t('Увійти')} onPress={login} />}
      <Button title={t('Скасувати')} kind="secondary" disabled={busy} onPress={() => router.canGoBack() ? router.back() : router.replace('/profile')} />
    </>}
  </Screen>;
}
