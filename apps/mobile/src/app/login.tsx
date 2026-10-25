import * as AppleAuthentication from 'expo-apple-authentication';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Banner, Button, Field, H, Screen, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT, useTheme } from '@/lib/settings';

export default function LoginScreen() {
  // Deep link: songbook://login?email=…&token=…
  const params = useLocalSearchParams<{ email?: string; token?: string }>();
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
  const done = () => (router.canGoBack() ? router.back() : router.replace('/profile'));

  useEffect(() => {
    if (params.email && params.token) run(() => verifyMagic(params.email!, { token: params.token! }).then(done));
    if (process.env.EXPO_OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
  }, [params.email, params.token]);

  const send = () =>
    run(async () => {
      const devCode = await startMagic(email.trim());
      setSent(true);
      if (devCode) setCode(devCode);
    });

  const apple = () =>
    run(async () => {
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

  return (
    <Screen>
      <T muted>{t('Вхід потрібен лише для пропозицій та адміністрування. Читати пісні можна без нього.')}</T>
      <H>Email</H>
      <Field
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <Button title={t(sent ? 'Надіслати ще раз' : 'Надіслати код')} disabled={busy || !email.includes('@')} onPress={send} />
      {sent && (
        <>
          <T muted>{t('Ми надіслали 6-значний код і посилання для входу.')}</T>
          <Field
            value={code}
            onChangeText={setCode}
            placeholder={t('Код з листа')}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
          />
          <Button
            title={t('Увійти')}
            disabled={busy || code.length !== 6}
            onPress={() => run(() => verifyMagic(email.trim(), { code }).then(done))}
          />
        </>
      )}
      {error && <Banner kind="warn" text={error} />}
      <H>{t('Інші способи')}</H>
      {appleAvailable && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={10}
          style={{ height: 48 }}
          onPress={apple}
        />
      )}
      <Button
        kind="secondary"
        title={t('Увійти через Google')}
        onPress={() =>
          Alert.alert(
            t('Потрібна dev-збірка'),
            t(
              'Вхід через Google працює лише у власній збірці з @react-native-google-signin/google-signin. У Expo Go скористайтеся кодом з email.',
            ),
          )
        }
      />
    </Screen>
  );
}
