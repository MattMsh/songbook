import { DEFAULT_PART_TYPES, type PartType } from '@songbook/shared';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { ColorSwatches } from '@/components/color-swatches';
import { Button, Card, Field, H, Row, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { setPartTypes, usePartTypes } from '@/lib/parts';
import { useT } from '@/lib/settings';

/** Aliases are edited as one comma-separated line. */
type Draft = Omit<PartType, 'aliases'> & { aliases: string };
const toDraft = (types: PartType[]): Draft[] => types.map((p) => ({ ...p, aliases: p.aliases.join(', ') }));

/** Admin list of song blocks: names, other names that match labels in songs, default colours. */
export default function PartsScreen() {
  const t = useT();
  const router = useRouter();
  const { user, ready } = useAuth();
  const saved = usePartTypes();
  const [draft, setDraft] = useState(() => toDraft(saved));
  const [busy, setBusy] = useState(false);

  const edit = (id: string, patch: Partial<Draft>) => setDraft((d) => d.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = () => setDraft((d) => [...d, { id: `custom-${Date.now().toString(36)}`, name: '', aliases: '', color: 'gray' }]);
  const invalid = !draft.length || draft.some((p) => !p.name.trim());

  const save = async () => {
    setBusy(true);
    try {
      const types = draft.map((p) => ({ ...p, aliases: p.aliases.split(',').map((a) => a.trim()).filter(Boolean) }));
      setPartTypes(await api<PartType[]>('/parts', { method: 'PUT', body: { types } }));
      router.back();
    } catch (e) {
      Alert.alert(t('Помилка'), errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('Блоки пісень') }} />
      {!ready ? (
        <T muted>{t('Завантаження…')}</T>
      ) : user?.role !== 'admin' ? (
        <T>{t('Тільки для адміністратора')}</T>
      ) : (
        <>
          <T muted style={{ fontSize: 13 }}>
            {t('Мітка в пісні, наприклад «Приспів x2», отримує колір блоку, якщо починається з його назви або іншої назви.')}
          </T>
          {draft.map((p) => (
            <Card key={p.id}>
              <H>{t('Назва')}</H>
              <Field value={p.name} onChangeText={(name) => edit(p.id, { name })} placeholder={t('Назва блоку')} />
              <H>{t('Інші назви, через кому')}</H>
              <Field
                value={p.aliases}
                onChangeText={(aliases) => edit(p.id, { aliases })}
                placeholder="Chorus, Припев" // i18n-ignore: sample aliases, not UI text
                autoCapitalize="none"
                autoCorrect={false}
              />
              <H>{t('Типовий колір')}</H>
              <ColorSwatches label={p.name} value={p.color} onChange={(color) => edit(p.id, { color })} />
              <Button
                small
                kind="ghost"
                icon="trash"
                title={t('Видалити блок')}
                onPress={() => setDraft((d) => d.filter((x) => x.id !== p.id))}
              />
            </Card>
          ))}
          <Row wrap>
            <Button kind="secondary" icon="add" title={t('Додати блок')} onPress={add} />
            <Button kind="ghost" title={t('Відновити типові')} onPress={() => setDraft(toDraft(DEFAULT_PART_TYPES))} />
          </Row>
          <Button title={t('Зберегти для всіх')} disabled={busy || invalid} onPress={save} />
        </>
      )}
    </Screen>
  );
}
