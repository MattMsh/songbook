import { parseChordPro } from '@songbook/shared';
import { Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ChordSheet } from '@/components/chord-sheet';
import { Card, H, Screen, T } from '@/components/ui';
import { useT, useTheme } from '@/lib/settings';

/** Song examples are song content, so they stay untranslated. */
const TOPICS: { title: string; rules: string[]; example: string; modes?: boolean }[] = [
  {
    title: 'Акорди над словами',
    rules: ['Напишіть акорд у квадратних дужках перед складом, на якому він звучить.'],
    example: "[C]Хочу [G/B]все [F]життя співати Ім'я", // i18n-ignore
  },
  {
    title: 'Блоки пісні',
    rules: [
      '{c: Куплет} починає блок. Назви блоків: Куплет, Приспів, Бридж, Вступ, Програш, Кода.',
      '{soc} і {eoc} обгортають приспів. {chorus} повторює останній приспів.',
      'Інший коментар, наприклад {c: тихо}, показується як нотатка для виконавців.',
    ],
    example: '{c: Куплет}\n[Am]Слова [F]куплету\n{c: тихо}\n{soc: Приспів}\n[C]Слова [G]приспіву\n{eoc}', // i18n-ignore
  },
  {
    title: 'Такти в рядку зі словами',
    rules: [
      '| — тактова риска. Поставте її перед першим складом такту.',
      '|: і :| позначають повтор, || — кінець частини.',
      'Два акорди в такті ділять його порівну.',
      'Такт без нового акорду продовжує попередній акорд.',
      'Один запис показується по-різному в кожному режимі. Співак бачить лише слова.',
    ],
    example: "| [C]Хочу [G/B]все | [F]життя | співати Ім'я |", // i18n-ignore
    modes: true,
  },
  {
    title: 'Рядок лише з акордами',
    rules: [
      'Для вступу чи програшу без слів напишіть акорди між рисками.',
      'x2 у кінці рядка означає повтор рядка.',
    ],
    example: '{c: Вступ}\n| [Am] - [F] | [C] | [G] | x2', // i18n-ignore
  },
  {
    title: 'Сітка акордів',
    rules: [
      'Сітка ділить такти на комірки однакової довжини. shape="2x4" — два такти по чотири комірки.',
      '. — порожня комірка. ~ ділить комірку: Am~G. % повторює попередній такт.',
      'Сітка не містить слів. Використовуйте її для частин без слів і для точного ритму.',
    ],
    example: '{start_of_grid shape="2x4" label="Вступ"}\n| Am . . . | F . G~E . |\n{end_of_grid}', // i18n-ignore
  },
  {
    title: 'Схема бою',
    rules: [
      'Рядок бою в сітці починається з |S.',
      'd — удар вниз, u — вгору, x — глушіння, + — акцент.',
      'a — арпеджіо, s — стакато. Наприклад: d+, dx, ua.',
    ],
    example: '{start_of_grid shape="2x4" label="Бій"}\n| Am . . . | F . G . |\n|S d+ u dx u | d u d u |\n{end_of_grid}', // i18n-ignore
  },
];

/** How to write songs: each rule comes with its ChordPro source and the rendered result. */
export default function SongFormatScreen() {
  const t = useT();
  const { colors } = useTheme();
  const preview = (example: string, showChords: boolean, showLyrics = true) => (
    <ChordSheet song={parseChordPro(example)} showChords={showChords} showLyrics={showLyrics} mapChord={(c) => c} fontSize={16} />
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: t('Як писати пісні') }} />
      <T muted style={{ fontSize: 13 }}>
        {t('Пісні записуються у форматі ChordPro. Застосунок підтримує його частину. Невідомі директиви зберігаються без змін.')}
      </T>
      {TOPICS.map((topic) => (
        <View key={topic.title} style={{ gap: 8 }}>
          <H>{t(topic.title)}</H>
          {topic.rules.map((rule) => <T key={rule}>{t(rule)}</T>)}
          <Card>
            <Text selectable style={[styles.source, { color: colors.text }]}>{topic.example}</Text>
          </Card>
          {topic.modes ? (
            [[t('Співаю / читаю'), false, true], [t('Музикант'), true, true], [t('Музикант без тексту'), true, false]].map(([label, chords, lyrics]) => (
              <View key={String(label)} style={{ gap: 4 }}>
                <T muted style={{ fontSize: 13 }}>{label}</T>
                {preview(topic.example, !!chords, !!lyrics)}
              </View>
            ))
          ) : preview(topic.example, true)}
        </View>
      ))}
      <H>{t('Параметри пісні')}</H>
      <T>{t('Назву, тональність, темп, розмір і капо задайте на вкладці «Параметри». Редактор запише їх як {title}, {key}, {tempo}, {time} і {capo}.')}</T>
    </Screen>
  );
}

const styles = StyleSheet.create({
  source: { fontFamily: 'monospace', fontSize: 14 },
});
