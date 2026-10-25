import type { Proposal } from '@songbook/shared';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Banner, Card, ListItem, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/settings';

export default function QueueScreen() {
  const { user, ready } = useAuth();
  const t = useT();
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let active = true;
    setProposals([]);
    setError(null);
    if (user?.role !== 'admin') return;
    setLoading(true);
    api<Proposal[]>('/proposals?status=pending')
      .then((rows) => { if (active) setProposals(rows); })
      .catch((e) => { if (active) setError(errorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, user?.role]));

  return (
    <Screen>
      <Stack.Screen options={{ title: t('Черга пропозицій') }} />
      {!ready ? <T muted>{t('Завантаження…')}</T> : user?.role !== 'admin' ? <T>{t('Тільки для адміністратора')}</T> : (
        <>
          {error && <Banner kind="warn" text={error} />}
          {loading && <T muted>{t('Завантаження…')}</T>}
          {!loading && !error && !proposals.length && <T muted>{t('Черга порожня')}</T>}
          {proposals.map((p) => (
            <Card key={p.id}>
              <ListItem
                title={p.title}
                subtitle={t(p.kind === 'new' ? 'Нова пісня' : 'Правка')}
                onPress={() => router.push(`/admin/proposal/${p.id}`)}
              />
              <T>{p.author.name ? `${p.author.name} · ${p.author.email}` : p.author.email}</T>
              <T muted>{new Date(p.createdAt).toLocaleString('uk-UA')}</T>
              {p.kind === 'edit' && p.current && (p.baseVersion ?? 0) < p.current.version && (
                <Banner kind="warn" text={t('Конфлікт версій')} />
              )}
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
