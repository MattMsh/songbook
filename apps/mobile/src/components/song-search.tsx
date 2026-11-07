import { Host, Picker } from '@expo/ui';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Field, H, Row } from '@/components/ui';
import { useRevision, type SongListItem } from '@/lib/db';
import { searchFilteredSongs, songFilterChoices } from '@/lib/song-filters';
import { useT } from '@/lib/settings';

/** Search field and metadata filters shared by the song list and the album song picker. */
export function useSongSearch() {
  const db = useSQLiteContext();
  const t = useT();
  const revision = useRevision();
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<SongListItem[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tag, setTag] = useState('');
  const [key, setKey] = useState('');
  const [time, setTime] = useState('');
  const [tempoMin, setTempoMin] = useState('');
  const [tempoMax, setTempoMax] = useState('');
  const [choices, setChoices] = useState({ tags: [] as string[], keys: [] as string[], times: [] as string[] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const filtered = !!(tag || key || time || tempoMin || tempoMax);
  const invalidRange = !!(tempoMin && tempoMax && Number(tempoMin) > Number(tempoMax));
  const clear = () => {
    setTag(''); setKey(''); setTime(''); setTempoMin(''); setTempoMax(''); setQuery('');
  };

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError('');
    Promise.all([
      searchFilteredSongs(db, query, {
        tag, key, time,
        tempoMin: tempoMin ? Number(tempoMin) : undefined,
        tempoMax: tempoMax ? Number(tempoMax) : undefined,
      }),
      songFilterChoices(db),
    ]).then(([rows, options]) => {
      if (!stale) { setSongs(rows); setChoices(options); }
    }).catch((e: unknown) => {
      if (!stale) { setSongs([]); setError(String(e)); }
    }).finally(() => !stale && setLoading(false));
    return () => { stale = true; };
  }, [db, query, revision, tag, key, time, tempoMin, tempoMax, retry]);

  const picker = (label: string, value: string, values: string[], onChange: (value: string) => void) => (
    <View style={{ alignSelf: 'stretch', gap: 4 }}>
      <H>{label}</H>
      <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
        <Picker selectedValue={value} onValueChange={onChange} appearance="menu">
          <Picker.Item value="" label={label + ': ' + t('Усі')} />
          {[...new Set([...values, ...(value ? [value] : [])])].map((option) => (
            <Picker.Item key={option} value={option} label={`${label}: ${option}`} />
          ))}
        </Picker>
      </Host>
    </View>
  );

  const controls = (
    <>
      <Field
        value={query}
        onChangeText={setQuery}
        placeholder={t('Номер, назва або слова')}
        clearButtonMode="while-editing"
        autoCorrect={false}
        returnKeyType="search"
      />
      <Row>
        <Button small kind={filtered ? 'primary' : 'secondary'} title={t(filtersOpen ? 'Сховати фільтри' : 'Фільтри')} onPress={() => setFiltersOpen(!filtersOpen)} />
        {(filtered || query) && <Button small kind="ghost" title={t('Скинути')} onPress={clear} />}
      </Row>
      {filtersOpen && (
        <View style={{ gap: 8 }}>
          {picker(t('Тег'), tag, choices.tags, setTag)}
          {picker(t('Тональність'), key, choices.keys, setKey)}
          {picker(t('Розмір'), time, choices.times, setTime)}
          <H>{t('Темп, BPM')}</H>
          <Row>
            <Field style={{ flex: 1 }} value={tempoMin} onChangeText={(v) => setTempoMin(v.replace(/\D/g, '').slice(0, 3))} placeholder={t('Від BPM')} accessibilityLabel={t('Мінімальний темп')} keyboardType="number-pad" />
            <Field style={{ flex: 1 }} value={tempoMax} onChangeText={(v) => setTempoMax(v.replace(/\D/g, '').slice(0, 3))} placeholder={t('До BPM')} accessibilityLabel={t('Максимальний темп')} keyboardType="number-pad" />
          </Row>
          {invalidRange && <Banner kind="warn" text={t('Мінімальний темп не може перевищувати максимальний.')} />}
        </View>
      )}
      {error ? <><Banner kind="warn" text={t('Помилка: {code}', { code: error })} /><Button small title={t('Повторити')} onPress={() => setRetry(retry + 1)} /></> : null}
    </>
  );

  return { songs, loading, error, searching: !!query || filtered, controls };
}
