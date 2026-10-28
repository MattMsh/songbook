import { partKind } from '@songbook/shared';
import { BuilderMenu } from './builder-menu';
import { GridEditor } from './grid-editor';
import { useRef, useState } from 'react';
import { Alert, Keyboard, View } from 'react-native';
import { insertChord, newBlock, newGridBlock, readBlocks, splitBlock, writeBlocks, type SongBlock } from '@/lib/song-builder';
import { useT, useTheme } from '@/lib/settings';
import { Banner, Button, Field, H, T } from './ui';

const TYPES = ['Куплет', 'Приспів', 'Бридж', 'Вступ', 'Програш', 'Кінцівка'] as const;
const CHORDS = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'Am', 'Bm', 'Dm', 'Em', 'F#m', 'C#m', 'Bb', 'D7', 'E7', 'G7', 'A7', 'Csus4', 'Dsus4', 'C/E', 'G/B', 'D/F#'];

export function SongBuilder({ value, onChange, chords, german }: {
  value: string; onChange: (value: string) => void; chords: string[]; german: boolean;
}) {
  const t = useT();
  const { colors } = useTheme();
  const [source, setSource] = useState(false);
  const selection = useRef({ index: -1, start: 0, end: 0 });
  const blocks = readBlocks(value);
  const raw = source || !blocks;
  const palette = [...new Set([...chords, ...CHORDS.map(c => german && c !== 'Bb' ? c.replace(/B/g, 'H') : c)])];
  const update = (next: SongBlock[]) => onChange(writeBlocks(next));
  const title = (index: number) => blocks?.[index]?.label || t(blocks?.[index]?.kind === 'grid' ? 'Сітка акордів' : 'Текст без назви');
  const verseNumber = Math.max(0, ...(blocks ?? []).filter(b => partKind(b.label) === 'verse').map(b => Number(/\d+/.exec(b.label)?.[0]) || 0)) + 1;
  const labelFor = (type: string) => type === 'Куплет' ? `${t(type)} ${verseNumber}` : t(type);
  const typeActions = TYPES.map(type => ({ id: type, title: t(type) }));
  const addActions = [...typeActions, { id: 'grid', title: t('Сітка акордів') }, { id: 'strum', title: t('Схема бою') }];

  function addChord(index: number, chord: string) {
    const text = index < 0 ? value : blocks![index].text;
    const range = selection.current.index === index ? selection.current : { start: text.length, end: text.length };
    const inserted = insertChord(text, range, chord);
    if (index < 0) onChange(inserted.text);
    else update(blocks!.map((b, i) => i === index ? { ...b, text: inserted.text } : b));
    selection.current = { index, start: inserted.cursor, end: inserted.cursor };
  }

  function blockAction(index: number, action: string) {
    if (!blocks) return;
    const next = blocks.slice();
    Keyboard.dismiss();
    selection.current = { index: -1, start: 0, end: 0 };
    if (action === 'delete') {
      Alert.alert(t('Видалити блок?'), t('Текст цього блоку буде видалено.'), [
        { text: t('Скасувати'), style: 'cancel' },
        { text: t('Видалити'), style: 'destructive', onPress: () => update(next.filter((_, i) => i !== index)) },
      ]);
    } else if (action === 'up' || action === 'down') {
      const to = index + (action === 'up' ? -1 : 1);
      if (to < 0 || to >= next.length) return;
      [next[index], next[to]] = [next[to], next[index]];
      update(next);
    } else {
      next[index] = newBlock(labelFor(action), next[index].text);
      update(next);
    }
  }

  return <View style={{ gap: 12 }}>
    <H>{t('Блоки пісні')}</H>
    <T muted>{t('Кожен куплет і приспів — окремий блок. Додайте блок, оберіть його тип і введіть текст.')}</T>
    {raw && <Button small kind="secondary" title={t('До блоків')}
      disabled={!blocks} onPress={() => { Keyboard.dismiss(); setSource(false); }} />}
    {raw ? <>
      {!blocks && <Banner text={t('Ця пісня містить спеціальні директиви. Редагуйте ChordPro: усі дані збережено без перетворення.')} />}
      <T muted>{t('Заголовок блоку записується так: {c: Куплет 1}. Акорд перед словом: [Am]Текст.')}</T>
      <Field accessibilityLabel={t('Текст ChordPro')} multiline textAlignVertical="top" value={value}
        onChangeText={onChange} autoCorrect={false} autoCapitalize="none"
        onSelectionChange={e => { selection.current = { index: -1, ...e.nativeEvent.selection }; }}
        style={{ minHeight: 280, fontFamily: 'monospace' }} />
      <BuilderMenu title={t('Вставити акорд')} actions={palette.map(c => ({ id: c, title: c }))} onAction={chord => addChord(-1, chord)} />
    </> : <>
      {blocks.map((block, index) => <View key={index} style={{ gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
        <View style={{ gap: 8 }}>
          <T accessibilityRole="header" style={{ fontWeight: '600' }}>{title(index)}</T>
          <BuilderMenu title={t('Дії')} label={t('Дії з блоком {name}', { name: title(index) })} actions={[
            ...(block.kind === 'grid' ? [] : [{ title: t('Тип блоку'), subactions: typeActions }]),
            { id: 'up', title: t('Перемістити вище'), attributes: { disabled: index === 0 } },
            { id: 'down', title: t('Перемістити нижче'), attributes: { disabled: index === blocks.length - 1 } },
            { id: 'delete', title: t('Видалити блок'), attributes: { destructive: true } },
          ]} onAction={action => blockAction(index, action)} />
        </View>
        {block.kind === 'grid' ? <GridEditor block={block} palette={palette} onChange={text => update(blocks.map((b, i) => i === index ? { ...b, text } : b))} /> : <>
        <Field multiline textAlignVertical="top" value={block.text} placeholder={t('Введіть або вставте текст цього блоку')}
          accessibilityLabel={t('Текст блоку {name}', { name: title(index) })}
          onChangeText={text => update(blocks.map((b, i) => i === index ? { ...b, text } : b))}
          onFocus={() => { if (selection.current.index !== index) selection.current = { index, start: block.text.length, end: block.text.length }; }}
          onSelectionChange={e => { selection.current = { index, ...e.nativeEvent.selection }; }}
          style={{ minHeight: 150 }} />
        {!!block.text.trim() && <View style={{ gap: 8 }}>
          <BuilderMenu title={t('Вставити акорд')} actions={palette.map(c => ({ id: c, title: c }))} onAction={chord => addChord(index, chord)} />
          <BuilderMenu title={t('Розділити блок')} actions={typeActions} onAction={type => {
            const at = selection.current.index === index ? selection.current.start : 0;
            const parts = splitBlock(block, at, labelFor(type));
            if (parts.length === 1) {
              Alert.alert(t('Як розділити блок'), t('Поставте курсор у рядок, з якого починається наступний куплет або приспів. Потім натисніть «Розділити блок».'));
              return;
            }
            Keyboard.dismiss();
            selection.current = { index: -1, start: 0, end: 0 };
            update([...blocks.slice(0, index), ...parts, ...blocks.slice(index + 1)]);
          }} />
        </View>}
        </>}
      </View>)}
      <BuilderMenu primary title={t('Додати блок')} actions={addActions} onAction={type => {
        Keyboard.dismiss();
        const added = type === 'grid' || type === 'strum' ? newGridBlock(t(type === 'grid' ? 'Сітка акордів' : 'Схема бою'), type === 'strum') : newBlock(labelFor(type));
        update(blocks.length === 1 && !blocks[0].text.trim() && !blocks[0].kind ? [added] : [...blocks, added]);
      }} />
      <T muted>{t('Вставили всю пісню в один блок? Поставте курсор у перший рядок нового куплету й натисніть «Розділити блок».')}</T>
      <T muted>{t('Акорди необов’язкові. Поставте курсор перед словом і виберіть «Вставити акорд», або введіть [Am] вручну.')}</T>
      <Button small kind="ghost" title={t('Редагувати ChordPro')} onPress={() => { Keyboard.dismiss(); setSource(true); }} />
    </>}
  </View>;
}
