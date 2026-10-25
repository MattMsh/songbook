import { beatGrid, startTicker, tapTempo, type Accent } from '@songbook/shared';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT, useTheme } from '@/lib/settings';
import { Button, Row, T } from './ui';

const HAPTIC: Record<Accent, Haptics.ImpactFeedbackStyle> = {
  strong: Haptics.ImpactFeedbackStyle.Heavy,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  weak: Haptics.ImpactFeedbackStyle.Light,
};
const SIZE: Record<Accent, number> = { strong: 26, medium: 20, weak: 14 };
// The strong beat gets the high click; other beats the low one, softer on weak beats.
const VOLUME: Record<Accent, number> = { strong: 1, medium: 1, weak: 0.5 };

/** Metronome with sound, haptics and a visual beat; the ticker corrects timer drift against absolute time. */
export function Metronome({ bpm: initialBpm, time, accents }: { bpm: number | null; time: string | null; accents: number[] | null }) {
  const { colors } = useTheme();
  const t = useT();
  const grid = beatGrid(time, accents);
  const [bpm, setBpm] = useState(initialBpm ?? 80);
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState(-1);
  const [haptics, setHaptics] = useState(true);
  const [sound, setSound] = useState(true);
  const high = useAudioPlayer(require('../../assets/sounds/click-high.wav'));
  const low = useAudioPlayer(require('../../assets/sounds/click-low.wav'));
  const taps = useRef<number[]>([]);

  useEffect(() => {
    if (!running) return setBeat(-1);
    // Heard with the ring switch on silent, and mixed with the user's music instead of stopping it.
    if (sound) setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
    return startTicker(bpm, (n) => {
      const i = n % grid.length;
      const accent = grid[i];
      setBeat(i);
      if (sound) {
        const player = accent === 'strong' ? high : low;
        player.volume = VOLUME[accent];
        player.seekTo(0).catch(() => {});
        player.play();
      }
      if (haptics) Haptics.impactAsync(HAPTIC[accent]).catch(() => {});
    });
  }, [running, bpm, haptics, sound, grid.length, high, low]);

  const tap = () => {
    taps.current = [...taps.current, Date.now()].slice(-10);
    const t = tapTempo(taps.current);
    if (t) setBpm(t);
  };
  const changeBpm = (d: number) => setBpm((b) => Math.min(300, Math.max(20, b + d)));

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.grid}>
        {grid.map((accent, i) => (
          <View key={i} style={styles.cell}>
            <View
              style={{
                width: SIZE[accent],
                height: SIZE[accent],
                borderRadius: SIZE[accent] / 2,
                backgroundColor: i === beat ? colors.chord : colors.border,
              }}
            />
          </View>
        ))}
      </View>
      <Row wrap>
        <Button small icon={running ? 'pause' : 'play'} label={t(running ? 'Зупинити метроном' : 'Запустити метроном')} onPress={() => setRunning(!running)} />
        <Button small kind="secondary" title="−" onPress={() => changeBpm(-2)} />
        <T style={{ minWidth: 70, textAlign: 'center', fontWeight: '700' }}>{bpm} BPM</T>
        <Button small kind="secondary" title="+" onPress={() => changeBpm(2)} />
        <Button small kind="secondary" title="Tap" onPress={tap} />
        <Button
          small
          kind={sound ? 'secondary' : 'ghost'}
          icon={sound ? 'sound' : 'soundOff'}
          label={t(sound ? 'Вимкнути звук' : 'Увімкнути звук')}
          onPress={() => setSound(!sound)}
        />
        <Button small kind={haptics ? 'secondary' : 'ghost'} icon="haptics" label={t(haptics ? 'Вимкнути вібрацію' : 'Увімкнути вібрацію')} onPress={() => setHaptics(!haptics)} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  cell: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
});
