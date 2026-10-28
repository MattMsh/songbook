import * as AppleAuthentication from 'expo-apple-authentication';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Banner, Button, Field, H, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT, useTheme } from '@/lib/settings';

interface AuthMethods { email: boolean; apple: boolean; google: boolean }

export default function LoginScreen() {
  // Deep link: songbook://login?email=…&token=…
  const params = useLocalSearchParams<{ email?: string; token?: string; returnTo?: string }>();
  const router = useRouter();
  const { dark } = useTheme();
  const t = useT();
  const { startMagic, verifyMagic, signInWith } = useAuth();
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [methods, setMethods] = useState<AuthMethods | null>(null);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [methodsError, setMethodsError] = useState('');
  const [retry, setRetry] = useState(0);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const done = () => {
    if (params.returnTo === '/delete-account') router.replace('/delete-account');
    else if (router.canGoBack()) router.back();
    else router.replace('/profile');
  };

  useEffect(() => {
    let stale = false;
    setMethodsLoading(true);
    setMethodsError('');
    Promise.all([
      api<AuthMethods>('/auth/methods'),
      process.env.EXPO_OS === 'ios' ? AppleAuthentication.isAvailableAsync().catch(() => false) : Promise.resolve(false),
    ]).then(([value, nativeAppleAvailable]) => {
      if (typeof value.email !== 'boolean' || typeof value.apple !== 'boolean' || typeof value.google !== 'boolean')
        throw new Error(t('Сервер повернув невідомі способи входу.'));
      if (!stale) { setMethods(value); setAppleAvailable(nativeAppleAvailable); }
    }).catch((e) => {
      if (!stale) { setMethods(null); setMethodsError(errorMessage(e)); }
    }).finally(() => !stale && setMethodsLoading(false));
    return () => { stale = true; };
  }, [retry]);

  useEffect(() => {
    if (params.email && params.token) void run(() => verifyMagic(params.email!, { token: params.token! }).then(done));
  }, [params.email, params.token]);

  const send = () => {
    if (busy || !methods?.email || methodsLoading) return;
    void run(async () => {
      const devCode = await startMagic(email.trim());
      setSent(true);
      if (devCode) setCode(devCode);
    });
  };
  const apple = () => {
    if (busy || !methods?.apple || !appleAvailable || methodsLoading) return;
    void run(async () => {
      try {
        const cred = await AppleAuthentication.signInAsync({
          requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        });
        if (!cred.identityToken) throw new Error(t('Apple не повернув токен'));
        const name = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(' ') || undefined;
        await signInWith('apple', cred.identityToken, name);
        done();
      } catch (e) {
        if ((e as { code?: string }).code !== 'ERR_REQUEST_CANCELED') throw e;
      }
    });
  };

  return (
    <Screen>
      <T muted>{t('Увійдіть, щоб ділитися піснями, працювати зі спільними альбомами та надсилати пропозиції. Читати пісні можна без входу.')}</T>
      {methodsLoading && <T accessibilityLiveRegion="polite">{t('Перевірка способів входу…')}</T>}
      {methodsError ? (
        <>
          <Banner kind="warn" text={t('Не вдалося перевірити способи входу: {error}', { error: methodsError })} />
          <Button kind="secondary" title={t('Повторити')} onPress={() => setRetry(retry + 1)} disabled={busy || methodsLoading} />
        </>
      ) : null}
      {!methodsLoading && methods && !methods.email && <T muted>{t('Вхід через email зараз недоступний.')}</T>}
      {!methodsLoading && methods && !methods.email && !(methods.apple && appleAvailable) && <Banner kind="warn" text={t('На цьому пристрої зараз немає доступного способу входу. Спробуйте пізніше.')} />}
      <H>{t('Електронна пошта')}</H>
      <Field
        value={email}
        onChangeText={setEmail}
        accessibilityLabel={t('Електронна пошта')}
        editable={!busy}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
      />
      <Button title={t(busy ? 'Зачекайте…' : sent ? 'Надіслати ще раз' : 'Надіслати код')} busy={busy} disabled={!methods?.email || methodsLoading || !email.includes('@')} onPress={send} />
      {sent && (
        <>
          <T muted>{t('Ми надіслали 6-значний код і посилання для входу.')}</T>
          <H>{t('Код з листа')}</H>
          <Field
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            accessibilityLabel={t('Код з листа')}
            editable={!busy}
            placeholder={t('Код з листа')}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
          />
          <Button
            title={t(busy ? 'Вхід…' : 'Увійти')}
            busy={busy}
            disabled={code.length !== 6}
            onPress={() => { if (!busy) void run(() => verifyMagic(email.trim(), { code }).then(done)); }}
          />
        </>
      )}
      {error && <Banner kind="warn" text={error} />}
      {appleAvailable && methods?.apple && !methodsLoading && (
        <>
          <H>{t('Вхід через Apple')}</H>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={10}
            accessibilityState={{ disabled: busy, busy }}
            style={{ height: 48, opacity: busy ? 0.4 : 1 }}
            onPress={apple}
          />
        </>
      )}
      {busy && <T accessibilityLiveRegion="polite">{t('Вхід…')}</T>}
    </Screen>
  );
}
