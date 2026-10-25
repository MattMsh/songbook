import type { Proposal } from '@songbook/shared';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Banner, Button, Card, Row, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT, useTheme } from '@/lib/settings';

const statuses = { pending: 'на розгляді', approved: 'схвалено', rejected: 'відхилено' };

export default function MineScreen() {
  const { user, ready } = useAuth();
  const { colors } = useTheme();
  const t = useT();
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let active = true;
    setProposals([]);
    setError(null);
    if (!ready || !user) return;
    setLoading(true);
    api<Proposal[]>('/proposals/mine')
      .then((rows) => { if (active) setProposals(rows); })
      .catch((e) => { if (active) setError(errorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ready, user?.id]));

  return (
    <Screen>
      <Stack.Screen options={{ title: t('Мої пропозиції') }} />
      {!ready ? <T muted>{t('Завантаження…')}</T> : !user ? (
        <>
          <T>{t('Увійдіть, щоб переглянути свої пропозиції.')}</T>
          <Button title={t('Увійти')} onPress={() => router.push('/login')} />
        </>
      ) : (
        <>
          {error && <Banner kind="warn" text={error} />}
          {loading && <T muted>{t('Завантаження…')}</T>}
          {!loading && !error && !proposals.length && <T muted>{t('У вас ще немає пропозицій')}</T>}
          {proposals.map((p) => (
            <Card key={p.id}>
              <T style={{ fontWeight: '600' }}>{p.title}</T>
              <Row wrap>
                <T muted>{t(p.kind === 'new' ? 'Нова пісня' : 'Правка')}</T>
                <T style={{
                  color: p.status === 'approved' ? colors.success : p.status === 'rejected' ? colors.danger : colors.accent,
                  backgroundColor: colors.bg,
                  borderRadius: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  fontSize: 13,
                }}>{t(statuses[p.status])}</T>
              </Row>
              <T muted>{new Date(p.createdAt).toLocaleString('uk-UA')}</T>
              {p.reviewComment && <T>{p.reviewComment}</T>}
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
