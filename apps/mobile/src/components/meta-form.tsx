import {
  beatGrid,
  getDirective,
  isMinor,
  keyChoices,
  parseAccents,
  parseChord,
  setDirective,
  tapTempo,
  type Chord,
  type Notation,
} from '@songbook/shared';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useT, useTheme } from '@/lib/settings';
import { Button, Chip, Field, H, Row, T } from './ui';
import { Wheel } from './wheel';

const BEATS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const UNITS = ['2', '4', '8', '16'];
const STROKES = ['↓', '↑', '×'];
const DEFAULT_TIME = '4/4';

/** Key of the song: its directive, else the first chord, else C. Key and time are never empty. */
function effectiveKey(head: string, chords: string[], notation: Notation): Chord {
  const first = chords[0] ? parseChord(chords[0]) : null;
  // Chords are shapes for the song capo, so the sounding key is that much higher.
  const capo = Number(getDirective(head, 'capo')) || 0;
  const fromChord = first && { ...first, root: (first.root + capo) % 12 };
  return parseChord(getDirective(head, 'key') ?? '') ?? fromChord ?? { root: 0, quality: '' };
}

const keyName = (root: number, minor: boolean, notation: Notation) =>
  keyChoices({ root, quality: minor ? 'm' : '' }, notation)[root].name;

/** Writes the effective key and time into the header if they are missing. */
export function withRequiredMeta(head: string, chords: string[], notation: Notation): string {
  let h = head || '\n';
  if (!getDirective(h, 'key')) {
    const key = effectiveKey(h, chords, notation);
    h = setDirective(h, 'key', keyName(key.root, isMinor(key), notation));
  }
  if (!getDirective(h, 'time')) h = setDirective(h, 'time', DEFAULT_TIME);
  return h;
}

/** Form over the song's header directives; edits `head` in place via setDirective. */
export function MetaForm({
  head,
  onChange,
  notation,
  chords,
}: {
  head: string;
  onChange: (head: string) => void;
  notation: Notation;
  chords: string[];
}) {
  const { colors } = useTheme();
  const t = useT();
  const taps = useRef<number[]>([]);
  const get = (name: string) => getDirective(head, name) ?? '';
  const apply = (h: string, name: string, value: string | number | null) => {
    const v = typeof value === 'string' ? value.replace(/[{}]/g, '').trim() || null : value;
    // A fresh header gets a blank line before the lyrics.
    return v === null ? setDirective(h, name, null) : setDirective(h || '\n', name, v);
  };
  const set = (name: string, value: string | number | null) => onChange(apply(head, name, value));

  const key = effectiveKey(head, chords, notation);
  const minor = isMinor(key);
  const time = /^\d+\/\d+$/.test(get('time')) ? get('time') : DEFAULT_TIME;
  const [beats, unit] = time.split('/');
  // Accents belong to the meter, so a new time signature starts from the default ones.
  const setTime = (t: string) => onChange(apply(apply(head, 'time', t), 'accents', null));
  const tempo = Number(get('tempo')) || null;
  const capo = Number(get('capo')) || 0;
  const rhythm = get('rhythm');

  const accents = parseAccents(get('accents'));
  const grid = beatGrid(time, accents);
  const toggleBeat = (beat: number) => {
    const list = accents ?? grid.flatMap((a, i) => (a === 'weak' ? [] : [i + 1]));
    const next = list.includes(beat) ? list.filter((b) => b !== beat) : [...list, beat].sort((a, b) => a - b);
    set('accents', next.length ? next.join(' ') : null);
  };

  const tap = () => {
    taps.current = [...taps.current, Date.now()].slice(-10);
    const bpm = tapTempo(taps.current);
    if (bpm) set('tempo', bpm);
  };
  const stepTempo = (d: number) => set('tempo', Math.min(300, Math.max(20, (tempo ?? 80) + d)));

  return (
    <View style={{ gap: 10 }}>
      <H>{t('Назва')}</H>
      <Field value={get('title')} onChangeText={(v) => set('title', v)} placeholder={t('Назва пісні')} />

      <Row gap={16}>
        <View style={{ gap: 6 }}>
          <H>{t('Номер')}</H>
          <Field
            value={get('number')}
            onChangeText={(v) => set('number', v.replace(/\D/g, ''))}
            placeholder={t('авто')}
            keyboardType="number-pad"
            style={{ width: 90 }}
          />
        </View>
        <View style={{ gap: 6, flex: 1 }}>
          <H>{t('Темп, BPM')}</H>
          <Row gap={6}>
            <Button small kind="secondary" title="−" onPress={() => stepTempo(-2)} />
            <Field
              value={get('tempo')}
              onChangeText={(v) => set('tempo', v.replace(/\D/g, '').slice(0, 3))}
              placeholder="—"
              keyboardType="number-pad"
              style={{ width: 64, textAlign: 'center' }}
            />
            <Button small kind="secondary" title="+" onPress={() => stepTempo(2)} />
            <Button small kind="secondary" title="Tap" onPress={tap} />
          </Row>
        </View>
      </Row>

      <H>{t('Тональність')}</H>
      <Row gap={12} style={{ justifyContent: 'center' }}>
        <Wheel
          label={t('Нота тональності')}
          items={keyChoices({ root: 0, quality: minor ? 'm' : '' }, notation).map((k) => k.name.replace(/m$/, ''))}
          index={key.root}
          onChange={(i) => set('key', keyName(i, minor, notation))}
        />
        <Wheel
          label={t('Лад')}
          width={110}
          items={[t('мажор'), t('мінор')]}
          index={minor ? 1 : 0}
          onChange={(i) => set('key', keyName(key.root, i === 1, notation))}
        />
        <T style={{ width: 60, fontSize: 22, fontWeight: '700' }}>{keyName(key.root, minor, notation)}</T>
      </Row>

      <H>{t('Розмір')}</H>
      <Row gap={12} style={{ justifyContent: 'center' }}>
        <Wheel
          label={t('Кількість долей')}
          items={BEATS}
          index={Math.max(0, BEATS.indexOf(beats))}
          onChange={(i) => setTime(`${BEATS[i]}/${unit}`)}
        />
        <T style={{ fontSize: 22 }}>/</T>
        <Wheel
          label={t('Тривалість долі')}
          items={UNITS}
          index={Math.max(0, UNITS.indexOf(unit))}
          onChange={(i) => setTime(`${beats}/${UNITS[i]}`)}
        />
        <T style={{ width: 60, fontSize: 22, fontWeight: '700' }}>{time}</T>
      </Row>

      <H>{t('Сильні долі')}</H>
      <Row wrap gap={6}>
        {grid.map((accent, i) => (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={t('Доля {n}', { n: i + 1 })}
            accessibilityState={{ selected: accent !== 'weak' }}
            onPress={() => toggleBeat(i + 1)}
            style={[
              styles.beat,
              {
                backgroundColor: accent === 'strong' ? colors.chord : accent === 'medium' ? colors.border : colors.card,
                borderColor: colors.border,
              },
            ]}>
            <Text style={{ color: accent === 'strong' ? colors.onChord : colors.text, fontWeight: '700' }}>{i + 1}</Text>
          </Pressable>
        ))}
        {accents && <Button small kind="ghost" title={t('Типово')} onPress={() => set('accents', null)} />}
      </Row>
      <T muted style={{ fontSize: 13 }}>
        {t(accents ? 'Ваші акценти для метронома.' : 'Типові акценти за розміром. Натисніть долю, щоб змінити.')}
      </T>

      <H>{t('Бій')}</H>
      <View style={[styles.rhythm, { backgroundColor: colors.card }]}>
        <Text style={{ color: rhythm ? colors.text : colors.muted, fontSize: 24, letterSpacing: 3 }}>
          {rhythm || t('не задано')}
        </Text>
      </View>
      <Row wrap gap={6}>
        {STROKES.map((s) => (
          <Button key={s} small kind="secondary" title={s} onPress={() => set('rhythm', rhythm + s)} />
        ))}
        <Button small kind="secondary" title={t('пробіл')} onPress={() => rhythm && !rhythm.endsWith(' ') && set('rhythm', rhythm + ' ')} />
        <Button small kind="secondary" icon="backspace" label={t('Стерти удар')} onPress={() => set('rhythm', rhythm.slice(0, -1))} />
        {rhythm ? <Button small kind="ghost" title={t('Очистити')} onPress={() => set('rhythm', null)} /> : null}
      </Row>

      <H>{t('Капо')}</H>
      <Row gap={6}>
        <Button small kind="secondary" title="−" onPress={() => set('capo', capo > 1 ? capo - 1 : null)} />
        <T style={{ minWidth: 24, textAlign: 'center' }}>{capo}</T>
        <Button small kind="secondary" title="+" onPress={() => set('capo', Math.min(11, capo + 1))} />
      </Row>
      {capo > 0 && (
        <T muted style={{ fontSize: 13 }}>
          {t('Акорди записані як аплікатури для капо {capo}. Тональність вище — та, що звучить.', { capo })}
        </T>
      )}

      <H>{t('Посилання на текст')}</H>
      <Field
        value={get('link')}
        onChangeText={(v) => set('link', v)}
        placeholder="https://…"
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <H>{t('Нотація акордів')}</H>
      <Row wrap gap={6}>
        <Chip label={t('Авто')} active={!get('notation')} onPress={() => set('notation', null)} />
        <Chip label="C D E … B" active={get('notation') === 'english'} onPress={() => set('notation', 'english')} />
        <Chip label="C D E … H" active={get('notation') === 'german'} onPress={() => set('notation', 'german')} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  beat: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rhythm: { borderRadius: 10, padding: 12, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
});
