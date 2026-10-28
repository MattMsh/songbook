import { Collapsible, Host, Picker } from '@expo/ui';
import {
  beatGrid, getDirective, isMinor, keyChoices, parseAccents, parseChord, setDirective, tapTempo,
  type Chord, type Notation,
} from '@songbook/shared';
import { useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { metaInput, setMetaInput } from '@/lib/song-meta';
import { useT, useTheme } from '@/lib/settings';
import { Button, Field, H, Row, T } from './ui';

const BEATS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const UNITS = ['2', '4', '8', '16'];
const DEFAULT_TIME = '4/4';

function effectiveKey(head: string, chords: string[]): Chord {
  const first = chords[0] ? parseChord(chords[0]) : null;
  const capo = Number(getDirective(head, 'capo')) || 0;
  const fromChord = first && { ...first, root: (first.root + capo) % 12 };
  return parseChord(getDirective(head, 'key') ?? '') ?? fromChord ?? { root: 0, quality: '' };
}
const keyName = (root: number, minor: boolean, notation: Notation) =>
  keyChoices({ root, quality: minor ? 'm' : '' }, notation)[root].name;

/** Writes defaults only when the original source has no key or meter. */
export function withRequiredMeta(head: string, chords: string[], notation: Notation): string {
  let h = head || '\n';
  if (!getDirective(h, 'key')) {
    const key = effectiveKey(h, chords);
    h = setDirective(h, 'key', keyName(key.root, isMinor(key), notation));
  }
  if (!getDirective(h, 'time')) h = setDirective(h, 'time', DEFAULT_TIME);
  return h;
}

export function MetaForm({ head, onChange, notation, chords }: {
  head: string; onChange: (head: string) => void; notation: Notation; chords: string[];
}) {
  const { colors } = useTheme();
  const t = useT();
  const [music, setMusic] = useState(false);
  const [details, setDetails] = useState(false);
  const taps = useRef<number[]>([]);
  const get = (name: string) => metaInput(head, name);
  const set = (name: string, value: string | number | null) => onChange(setMetaInput(head, name, value));
  const key = effectiveKey(head, chords);
  const currentKey = get('key').trim() || keyName(key.root, isMinor(key), notation);
  const time = get('time').trim() || DEFAULT_TIME;
  const [beats, unit] = time.split('/');
  const setTime = (value: string) => onChange(setMetaInput(setMetaInput(head, 'time', value), 'accents', null));
  const tempo = Number(get('tempo')) || null;
  const capo = Number(get('capo')) || 0;
  const rhythm = get('rhythm');
  const accents = parseAccents(get('accents'));
  const grid = beatGrid(time, accents);
  const touch = Platform.OS === 'android' ? 48 : 44;
  const picker = (label: string, value: string, values: string[], change: (value: string) => void) => (
    <View style={{ gap: 4 }}>
      <H>{label}</H>
      <Host ignoreSafeArea="all" matchContents={{ vertical: true }} accessibilityLabel={label} style={{ width: '100%', minHeight: touch }}>
        <Picker appearance="menu" selectedValue={value} onValueChange={change}>
          {[...new Set([value, ...values])].map(option => <Picker.Item key={option} value={option} label={option} />)}
        </Picker>
      </Host>
    </View>
  );
  const stepTempo = (delta: number) => set('tempo', Math.min(300, Math.max(20, (tempo ?? 80) + delta)));
  const tap = () => {
    taps.current = [...taps.current, Date.now()].slice(-10);
    const bpm = tapTempo(taps.current);
    if (bpm) set('tempo', bpm);
  };

  return <View style={{ gap: 12 }}>
    <H>{t('Назва')}</H>
    <Field accessibilityLabel={t('Назва пісні')} value={get('title')} onChangeText={v => set('title', v)} placeholder={t('Назва пісні')} />
    <T muted>{t('Назва обов’язкова. Інші параметри можна уточнити пізніше.')}</T>
    {picker(t('Тональність'), currentKey,
      [false, true].flatMap(minor => keyChoices({ root: 0, quality: minor ? 'm' : '' }, notation).map(k => k.name)), value => set('key', value))}
    {picker(t('Розмір'), time, ['4/4', '3/4', '6/8', '2/4', '12/8', '5/4', '7/8'], setTime)}
    <Host ignoreSafeArea="all" matchContents={{ vertical: true }} style={{ width: '100%', minHeight: touch }}>
      <Collapsible label={t('Для музикантів: темп, бій, капо')} isOpen={music} onOpenChange={setMusic} />
    </Host>
    {music && <View style={{ gap: 12 }}>
      <H>{t('Темп, BPM')}</H>
      <Field accessibilityLabel={t('Темп, BPM')} value={get('tempo')}
        onChangeText={v => set('tempo', v.replace(/\D/g, '').slice(0, 3))} placeholder={t('Не задано')}
        keyboardType="number-pad" />
      <Row wrap>
        <Button small kind="secondary" title="−" label={t('Зменшити темп')} onPress={() => stepTempo(-2)} />
        <Button small kind="secondary" title="+" label={t('Збільшити темп')} onPress={() => stepTempo(2)} />
        <Button small kind="secondary" title={t('Відбити темп')} onPress={tap} />
        {!!tempo && <Button small kind="ghost" title={t('Очистити темп')} onPress={() => set('tempo', null)} />}
      </Row>
      <T muted>{t('Натисніть «Відбити темп» кілька разів у ритмі пісні.')}</T>
      {picker(t('Кількість долей'), beats, BEATS, value => setTime(`${value}/${unit || '4'}`))}
      {picker(t('Тривалість долі'), unit || '4', UNITS, value => setTime(`${beats}/${value}`))}
      <H>{t('Сильні долі')}</H>
      <Row wrap>
        {grid.map((accent, i) => <Pressable key={i} accessibilityRole="checkbox" accessibilityLabel={t('Доля {n}', { n: i + 1 })}
          accessibilityState={{ checked: accent !== 'weak' }} onPress={() => {
            const list = accents ?? grid.flatMap((a, i) => a === 'weak' ? [] : [i + 1]);
            const next = list.includes(i + 1) ? list.filter(b => b !== i + 1) : [...list, i + 1].sort((a, b) => a - b);
            set('accents', next.length ? next.join(' ') : null);
          }} style={({ pressed }) => ({ minWidth: touch, minHeight: touch, padding: 10, borderRadius: 12,
            alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1,
            backgroundColor: accent === 'strong' ? colors.chord : accent === 'medium' ? colors.border : colors.card })}>
          <T style={{ color: accent === 'strong' ? colors.onChord : colors.text, fontWeight: '600' }}>{i + 1}</T>
        </Pressable>)}
        {accents && <Button small kind="ghost" title={t('Типово')} onPress={() => set('accents', null)} />}
      </Row>
      <T muted>{t('Типові акценти за розміром. Натисніть долю, щоб змінити.')}</T>
      <H>{t('Бій')}</H>
      <Field accessibilityLabel={t('Бій')} value={rhythm} onChangeText={v => set('rhythm', v)} placeholder={t('Не задано')} />
      <Row wrap>
        <Button small kind="secondary" title="↓" label={t('Удар вниз')} onPress={() => set('rhythm', rhythm + '↓')} />
        <Button small kind="secondary" title="↑" label={t('Удар вгору')} onPress={() => set('rhythm', rhythm + '↑')} />
        <Button small kind="secondary" title="×" label={t('Приглушити струни')} onPress={() => set('rhythm', rhythm + '×')} />
        <Button small kind="secondary" title={t('пробіл')} disabled={!rhythm || rhythm.endsWith(' ')} onPress={() => set('rhythm', rhythm + ' ')} />
        <Button small kind="secondary" icon="backspace" label={t('Стерти удар')} disabled={!rhythm} onPress={() => set('rhythm', rhythm.slice(0, -1))} />
        {!!rhythm && <Button small kind="ghost" title={t('Очистити')} onPress={() => set('rhythm', null)} />}
      </Row>
      {picker(t('Капо'), String(capo), Array.from({ length: 12 }, (_, i) => String(i)), value => set('capo', Number(value) || null))}
      {capo > 0 && <T muted>{t('Акорди записані як аплікатури для капо {capo}. Тональність вище — та, що звучить.', { capo })}</T>}
      <H>{t('Нотація акордів')}</H>
      <Host ignoreSafeArea="all" matchContents={{ vertical: true }} style={{ width: '100%', minHeight: touch }}>
        <Picker appearance="menu" selectedValue={get('notation')} onValueChange={value => set('notation', value || null)}>
          <Picker.Item value="" label={t('Авто')} />
          <Picker.Item value="english" label="C D E … B" />
          <Picker.Item value="german" label="C D E … H" />
        </Picker>
      </Host>
    </View>}
    <Host ignoreSafeArea="all" matchContents={{ vertical: true }} style={{ width: '100%', minHeight: touch }}>
      <Collapsible label={t('Додатково: номер, теги, джерело')} isOpen={details} onOpenChange={setDetails} />
    </Host>
    {details && <View style={{ gap: 12 }}>
      <H>{t('Номер')}</H>
      <Field accessibilityLabel={t('Номер пісні')} value={get('number')} onChangeText={v => set('number', v.replace(/\D/g, ''))}
        placeholder={t('авто')} keyboardType="number-pad" />
      <T muted>{t('Залиште порожнім — номер буде призначено автоматично.')}</T>
      <H>{t('Теги')}</H>
      <Field accessibilityLabel={t('Теги через кому')} value={get('tags')} onChangeText={v => set('tags', v)} placeholder={t('Теги через кому')} autoCorrect={false} />
      <H>{t('Посилання на текст')}</H>
      <Field accessibilityLabel={t('Посилання на текст')} value={get('link')} onChangeText={v => set('link', v)} placeholder="https://…"
        keyboardType="url" autoCapitalize="none" autoCorrect={false} />
    </View>}
  </View>;
}
