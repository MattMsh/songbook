import { lineDiff, type DiffLine, type Proposal } from '@songbook/shared';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { DiffView } from '@/components/diff-view';
import { Banner, Button, Chip, Field, Row, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { syncNow } from '@/lib/sync';
import { useT } from '@/lib/settings';

export default function ProposalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ready } = useAuth();
  const t = useT();
  const db = useSQLiteContext();
  const router = useRouter();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [text, setText] = useState('');
  const [comment, setComment] = useState('');
  const [tab, setTab] = useState<'diff' | 'text'>('diff');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    setProposal(null);
    setError(null);
    setComment('');
    if (user?.role !== 'admin') return;
    setLoading(true);
    api<Proposal[]>('/proposals?status=pending')
      .then((rows) => {
        if (!active) return;
        const p = rows.find((row) => row.id === id) ?? null;
        setProposal(p);
        setText(p?.chordpro ?? '');
      })
      .catch((e) => { if (active) setError(errorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, user?.id, user?.role]));

  const run = async (action: 'approve' | 'reject') => {
    if (!proposal || busy) return;
    setBusy(true);
    try {
      const body = action === 'approve'
        ? text === proposal.chordpro ? {} : { chordpro: text }
        : comment.trim() ? { comment: comment.trim() } : {};
      await api(`/proposals/${encodeURIComponent(proposal.id)}/${action}`, { body });
      await syncNow(db);
      router.back();
    } catch (e) {
      Alert.alert(t('Помилка'), errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const diff: DiffLine[] = proposal?.kind === 'new'
    ? text.split('\n').map((line) => ({ op: 'add', text: line }))
    : lineDiff(proposal?.current?.chordpro ?? '', text);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('Розгляд пропозиції') }} />
      {!ready ? <T muted>{t('Завантаження…')}</T> : user?.role !== 'admin' ? <T>{t('Тільки для адміністратора')}</T> : (
        <>
          {error && <Banner kind="warn" text={error} />}
          {loading ? <T muted>{t('Завантаження…')}</T> : !proposal ? (
            !error && <T muted>{t('Пропозицію не знайдено або вже розглянуто')}</T>
          ) : (
            <>
              <T style={{ fontSize: 22, fontWeight: '600' }}>{proposal.title}</T>
              <T>{t(proposal.kind === 'new' ? 'Нова пісня' : 'Правка')}</T>
              <T>{proposal.author.name ? `${proposal.author.name} · ${proposal.author.email}` : proposal.author.email}</T>
              <T muted>{new Date(proposal.createdAt).toLocaleString('uk-UA')}</T>
              {proposal.kind === 'edit' && (
                <>
                  <T muted>
                    {t('Базова версія: {base} · Поточна: {current}', {
                      base: proposal.baseVersion ?? '—',
                      current: proposal.current?.version ?? '—',
                    })}
                  </T>
                  {proposal.current && (proposal.baseVersion ?? 0) < proposal.current.version && (
                    <Banner kind="warn" text={t('Конфлікт версій: перевірте зміни відносно поточного тексту на сервері.')} />
                  )}
                  {!proposal.current && <Banner kind="warn" text={t('Пісню видалено з сервера. Схвалення недоступне.')} />}
                </>
              )}
              <Row>
                <Chip label={t('Зміни')} active={tab === 'diff'} onPress={() => setTab('diff')} />
                <Chip label={t('Текст')} active={tab === 'text'} onPress={() => setTab('text')} />
              </Row>
              {tab === 'diff' ? <DiffView diff={diff} /> : (
                <Field
                  multiline
                  value={text}
                  onChangeText={setText}
                  editable={!busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textAlignVertical="top"
                  style={{ minHeight: 320, fontFamily: 'monospace', fontSize: 15 }}
                />
              )}
              <Field
                multiline
                placeholder={t('Коментар до відхилення (необовʼязково)')}
                value={comment}
                onChangeText={setComment}
                editable={!busy}
              />
              <Row wrap>
                <Button
                  title={t('Схвалити')}
                  disabled={busy || !text.trim() || (proposal.kind === 'edit' && !proposal.current)}
                  onPress={() => run('approve')}
                />
                <Button title={t('Відхилити')} kind="danger" disabled={busy} onPress={() => run('reject')} />
              </Row>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
