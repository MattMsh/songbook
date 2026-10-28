import { BottomSheet, Host } from '@expo/ui';
import { guitarFrets, pianoPitchClasses, pitchClassName, type Notation } from '@songbook/shared';
import { ScrollView, Text, View } from 'react-native';
import { useT, useTheme } from '@/lib/settings';
import { Button, H, T } from './ui';

export function ChordDiagram({ chord, capo, notation, onDismiss }: {
  chord: string | null;
  capo: number;
  notation: Notation;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const t = useT();
  const frets = chord ? guitarFrets(chord) : null;
  const piano = chord ? pianoPitchClasses(chord, capo) : null;
  const firstFret = frets && Math.max(...frets.map((f) => f ?? 0)) > 5
    ? Math.min(...frets.filter((f): f is number => f !== null && f > 0)) : 1;
  const fretText = frets?.map((f) => f === null ? '×' : String(f)).join(' · ');
  const noteText = piano?.notes.map((pc) => pitchClassName(pc, notation)).join(' · ');

  return (
    <Host style={{ position: 'absolute' }}>
      <BottomSheet isPresented={chord !== null} onDismiss={onDismiss} snapPoints={['full']} containerColor={colors.bg}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }} accessibilityViewIsModal>
          <T accessibilityRole="header" style={{ fontSize: 24, fontWeight: '700' }}>{chord}</T>
          <H>{t('Гітара — аплікатура {chord}', { chord: chord ?? '' })}</H>
          <T muted>{t('Капо: {capo}. Лади вказані від капо.', { capo })}</T>
          {frets ? (
            <>
              <View accessible accessibilityLabel={t('Струни від низької E до високої E: {frets}', { frets: fretText ?? '' })} style={{ alignSelf: 'center', width: 220, height: 230 }}>
                {Array.from({ length: 6 }, (_, i) => (
                  <View key={`string-${i}`} style={{ position: 'absolute', left: 40 + i * 32, top: 32, height: 160, width: 1, backgroundColor: colors.muted }} />
                ))}
                {Array.from({ length: 6 }, (_, i) => (
                  <View key={`fret-${i}`} style={{ position: 'absolute', left: 40, top: 32 + i * 32, width: 160, height: i === 0 && firstFret === 1 ? 3 : 1, backgroundColor: colors.muted }} />
                ))}
                {Array.from({ length: 5 }, (_, i) => (
                  <T key={`number-${i}`} muted style={{ position: 'absolute', left: 4, top: 39 + i * 32, fontSize: 14 }}>{firstFret + i}</T>
                ))}
                {frets.map((fret, i) => (
                  <View key={i}>
                    {(fret === null || fret === 0) ? (
                      <T style={{ position: 'absolute', left: 31 + i * 32, top: 3, width: 20, textAlign: 'center' }}>{fret === null ? '×' : '○'}</T>
                    ) : (
                      <View style={{ position: 'absolute', left: 30 + i * 32, top: 38 + (fret - firstFret) * 32, width: 21, height: 21, borderRadius: 11, backgroundColor: colors.accent }} />
                    )}
                    <T muted style={{ position: 'absolute', left: 27 + i * 32, top: 198, width: 27, textAlign: 'center', fontSize: 12 }}>{['E', 'A', 'D', 'G', notation === 'german' ? 'H' : 'B', 'E'][i]}</T>
                  </View>
                ))}
              </View>
              <T selectable style={{ textAlign: 'center', fontWeight: '600' }}>{fretText}</T>
              <T muted>{t('0 — відкрита струна; × — не грати. Однаковий лад можна затиснути баре.')}</T>
            </>
          ) : <T muted>{t('Для цього акорду немає перевіреної гітарної аплікатури.')}</T>}
          <H>{t('Фортепіано — ноти, що звучать')}</H>
          {piano ? (
            <>
              <View accessible accessibilityLabel={noteText} style={{ height: 130, flexDirection: 'row' }}>
                {[0, 2, 4, 5, 7, 9, 11].map((pc) => (
                  <View key={pc} style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: piano.notes.includes(pc) ? colors.accent : colors.card }}>
                    <Text style={{ color: piano.notes.includes(pc) ? colors.onAccent : colors.text, fontWeight: '600' }}>{pitchClassName(pc, notation)}</Text>
                  </View>
                ))}
                {[{ pc: 1, after: 1 }, { pc: 3, after: 2 }, { pc: 6, after: 4 }, { pc: 8, after: 5 }, { pc: 10, after: 6 }].map(({ pc, after }) => (
                  <View key={pc} style={{ position: 'absolute', left: `${after * 100 / 7 - 4}%`, top: 0, width: '8%', height: 78, borderWidth: 1, borderColor: colors.border, backgroundColor: piano.notes.includes(pc) ? colors.chord : colors.text }} />
                ))}
              </View>
              <T selectable>{noteText}</T>
              <T>{t('Бас: {note}', { note: pitchClassName(piano.bass, notation) })}</T>
              <T muted>{t('Показано класи висот з урахуванням капо, а не розташування пальців чи октави.')}</T>
            </>
          ) : <T muted>{t('Ноти цього типу акорду не підтримуються.')}</T>}
          <Button title={t('Готово')} onPress={onDismiss} />
        </ScrollView>
      </BottomSheet>
    </Host>
  );
}
