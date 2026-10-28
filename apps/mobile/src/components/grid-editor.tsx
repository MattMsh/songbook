import { parseDirective, parseGridDirective, repeatGridBar, replaceGridCell, type GridCell } from '@songbook/shared';
import { useEffect, useState } from 'react';
import { Keyboard, View } from 'react-native';
import type { SongBlock } from '@/lib/song-builder';
import { useT } from '@/lib/settings';
import { BuilderMenu } from './builder-menu';
import { ChordGrid } from './chord-grid';
import { Button, Field, T } from './ui';

export function GridEditor({ block, palette, onChange }: { block: SongBlock; palette: string[]; onChange: (body: string) => void }) {
  const t = useT();
  const [source, setSource] = useState(false);
  const [selected, setSelected] = useState<{ cell: GridCell; strum: boolean } | null>(null);
  useEffect(() => setSelected(null), [block.marker, block.text]);
  const directive = parseDirective(block.marker);
  const grid = directive ? parseGridDirective(block.text, directive) : null;
  const choices = selected?.strum ? [
    { id: 'dn', title: t('Удар вниз') }, { id: 'up', title: t('Удар вгору') },
    { id: 'd+', title: t('Акцент вниз') }, { id: 'u+', title: t('Акцент вгору') },
    { id: 'dx', title: t('Глушіння вниз') }, { id: 'ux', title: t('Глушіння вгору') },
    { id: 'da', title: t('Арпеджіо вниз') }, { id: 'ua', title: t('Арпеджіо вгору') },
    { id: 'ds', title: t('Стакато вниз') }, { id: 'us', title: t('Стакато вгору') },
    { id: 'x', title: t('Приглушити струни') }, { id: 'dn~up', title: t('Вниз і вгору в одній комірці') },
  ] : palette.map(chord => ({ id: chord, title: chord }));
  const append = (line: string) => { Keyboard.dismiss(); setSelected(null); onChange(block.text + (block.text && !block.text.endsWith('\n') ? '\n' : '') + line + '\n'); };
  return <View style={{ gap: 12 }}>
    <T muted>{t('Натисніть комірку, щоб вибрати акорд або удар. Крапка — порожня комірка, не пауза. Широку схему можна прокрутити вбік.')}</T>
    {grid && <ChordGrid grid={{ ...grid, label: '' }} mapChord={c => c} selectedStart={selected?.cell.start} onCellPress={(cell, strum) => { Keyboard.dismiss(); setSelected({ cell, strum }); }} />}
    {selected && <BuilderMenu primary title={t('Вміст вибраної комірки')} actions={[
      ...choices, { id: '.', title: t('Порожня комірка') },
      ...(!selected.strum ? [{ id: '/', title: t('Повторити акорд') }, { id: '%', title: t('Повторити попередній такт') }] : []),
    ]} onAction={token => {
      const bar = grid?.rows.flatMap(row => row.bars).find(bar => bar.cells.some(cell => cell.start === selected.cell.start));
      onChange(token === '%' && bar ? repeatGridBar(block.text, bar) : replaceGridCell(block.text, selected.cell, token));
      setSelected(null);
    }} />}
    <BuilderMenu title={t('Додати такт')} actions={[3, 4, 6, 8].map(count => ({ id: String(count), title: t('Такт із {count} комірок', { count }) }))}
      onAction={count => append('| ' + Array(Number(count)).fill('.').join(' ') + ' |')} />
    <BuilderMenu title={t('Додати рядок бою')} actions={[
      { id: '|S dn up dn up |', title: t('Чотири удари: вниз, вгору') },
      { id: '|S dn~up dn~up dn~up dn~up |', title: t('Вісім ударів у чотирьох комірках') },
      { id: '|S d+ up dx up |', title: t('Акцент і глушіння') },
      { id: '|S . . . . |', title: t('Порожня схема бою') },
    ]} onAction={append} />
    <Button small kind="ghost" title={t(source ? 'Приховати вихідний запис' : 'Вихідний запис схеми')}
      onPress={() => { setSource(!source); setSelected(null); }} />
    {source && <>
      <T muted>{t('Розділяйте комірки пробілами, такти — |. Для бою почніть рядок із |S або |s. Символ ~ ділить комірку.')}</T>
      <Field multiline textAlignVertical="top" accessibilityLabel={t('Вихідний запис схеми')} value={block.text}
        onChangeText={text => { setSelected(null); onChange(text); }} autoCorrect={false} autoCapitalize="none" style={{ minHeight: 150, fontFamily: 'monospace' }} />
    </>}
  </View>;
}
