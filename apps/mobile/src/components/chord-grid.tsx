import { gridCellText, isChord, strumMark, type ChordGrid as Grid, type GridCell } from '@songbook/shared';
import { Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useT, useTheme } from '@/lib/settings';
import { Banner, T } from './ui';

export function ChordGrid({ grid, mapChord, fontSize = 17, color, onChordPress, onCellPress, selectedStart }: {
  grid: Grid;
  mapChord: (chord: string) => string;
  fontSize?: number;
  color?: string;
  onChordPress?: (chord: string) => void;
  onCellPress?: (cell: GridCell, strum: boolean) => void;
  selectedStart?: number;
}) {
  const { colors } = useTheme();
  const t = useT();
  const { fontScale } = useWindowDimensions();
  const touch = Platform.OS === 'ios' ? 44 : 48;
  const cellLength = grid.rows.flatMap(row => row.bars.flatMap(bar =>
    bar.cells.map(cell => gridCellText(cell, row.strum, mapChord).length))).reduce((max, n) => Math.max(max, n), 4);
  const width = Math.max(touch, fontSize * cellLength * 0.75 * fontScale + 4);
  const barLength = grid.rows.reduce((max, row) => row.bars.reduce((n, bar) => Math.max(n, bar.opening.length, bar.closing.length), max), 1);
  const barWidth = fontSize * fontScale * (barLength === 1 ? 0.4 : barLength * 0.65);
  const textStyle = { fontSize, color: color ?? colors.chord, fontWeight: '600' as const };
  const tokenLabel = (token: string, strum: boolean): string => {
    if (!token || token === '.') return t('Порожня комірка');
    if (token === '/') return t('Повторити акорд');
    if (token === '%') return t('Повторити попередній такт');
    if (token === '%%') return t('Повторити попередні два такти');
    const mark = strum && strumMark(token);
    if (mark) return [t(mark.direction === 'up' ? 'Удар вгору' : mark.direction === 'down' ? 'Удар вниз' : 'Приглушити струни'),
      mark.accent && t('Акцент'), mark.technique === 'a' && t('Арпеджіо'), mark.technique === 'x' && t('Глушіння'), mark.technique === 's' && t('Стакато')].filter(Boolean).join(', ');
    return isChord(token) ? mapChord(token) : token;
  };
  return <View style={{ gap: 8 }}>
    {!!grid.label && <T accessibilityRole="header" style={{ fontWeight: '600' }}>{grid.label}</T>}
    {!!grid.issues.length && <Banner kind="warn" text={t('Частина схеми не підтримується або має помилку. Оригінальний запис збережено.')} />}
    {grid.issues.includes('shape') ? <T selectable>{grid.source}</T> : <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={{ gap: 8 }}>{grid.rows.map((row, r) => <View key={r} style={{ gap: 4 }}>
      {!row.valid ? <T selectable>{row.source}</T> : <>
        {!!row.left && <T muted selectable>{row.left}</T>}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {row.bars.map((bar, b) => <View key={b} accessibilityLabel={t('Такт {number}', { number: b + 1 })}
            style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: row.showBars ? 0.5 : 0, borderColor: colors.separator }}>
              <Text style={[textStyle, { minWidth: barWidth }]}>{row.showBars ? bar.opening : ' '}</Text>
              {bar.cells.map((cell, c) => {
                const label = cell.tokens.map(token => tokenLabel(token, row.strum)).join(', ');
                const chord = cell.tokens.length === 1 && isChord(cell.tokens[0]) ? cell.tokens[0] : null;
                const press = onCellPress ? () => onCellPress(cell, row.strum) : chord && onChordPress ? () => onChordPress(chord) : undefined;
                return <Pressable key={c} disabled={!press} onPress={press} accessibilityRole={press ? 'button' : 'text'}
                  accessibilityState={onCellPress ? { selected: selectedStart === cell.start } : undefined}
                  accessibilityLabel={onCellPress ? t('Змінити комірку {number}, такт {bar}, рядок {row}: {value}', { number: c + 1, bar: b + 1, row: r + 1, value: label }) : label}
                  style={({ pressed }) => ({ width, minHeight: touch, padding: 8, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: selectedStart === cell.start ? colors.accent : onCellPress ? colors.fill : 'transparent', borderRadius: 8, marginHorizontal: 2, opacity: pressed ? 0.6 : 1 })}>
                  <Text selectable={!press} style={[textStyle, selectedStart === cell.start && { color: colors.onAccent }]}>{gridCellText(cell, row.strum, mapChord)}</Text>
                </Pressable>;
              })}
              {b === row.bars.length - 1 && <Text style={[textStyle, { minWidth: barWidth }]}>{row.showBars ? bar.closing : ' '}</Text>}
          </View>)}
        </View>
        {!!row.right && <T muted selectable>{row.right}</T>}
      </>}
    </View>)}</View></ScrollView>}
    {grid.rows.some(row => row.strum) && <T muted>{t('↑ вгору · ↓ вниз · ! акцент · × глушіння · ≈ арпеджіо · крапка після стрілки — стакато')}</T>}
  </View>;
}
