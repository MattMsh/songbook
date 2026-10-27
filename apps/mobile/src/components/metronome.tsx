import { beatGrid, clickBar, startTicker, tapTempo, type Accent } from '@songbook/shared';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
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

/**
 * Metronome with sound, haptics and a visual beat. With sound on, one bar of clicks loops natively
 * and the dots follow the player's position, so they never drift from what you hear. Without sound,
 * a timer that corrects drift against absolute time drives the dots and haptics.
 */
export function Metronome({ bpm: initialBpm, time, accents }: { bpm: number | null; time: string | null; accents: number[] | null }) {
  const { colors } = useTheme();
  const t = useT();
  const grid = beatGrid(time, accents);
  const [bpm, setBpm] = useState(initialBpm ?? 80);
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState(-1);
  const [haptics, setHaptics] = useState(true);
  const [sound, setSound] = useState(true);
  const player = useAudioPlayer(null);
  const pattern = grid.join('-');
  const taps = useRef<number[]>([]);

  useEffect(() => {
    if (!running) return setBeat(-1);
    const onBeat = (i: number) => {
      setBeat(i);
      if (haptics) Haptics.impactAsync(HAPTIC[grid[i]]).catch(() => {});
    };
    if (!sound) return startTicker(bpm, (n) => onBeat(n % grid.length));

    let frame = 0;
    let shown = -1;
    let stopped = false;
    (async () => {
      // Heard with the ring switch on silent, and mixed with the user's music instead of stopping it.
      await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
      const file = new File(Paths.cache, `metronome-${bpm}-${pattern}.wav`);
      if (!file.exists) await file.write(clickBar(bpm, grid));
      if (stopped) return;
      player.replace({ uri: file.uri });
      player.loop = true;
      player.play();
      const step = () => {
        const i = Math.floor((player.currentTime * bpm) / 60) % grid.length;
        if (i !== shown) onBeat((shown = i));
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      player.pause();
    };
  }, [running, bpm, haptics, sound, pattern, player]);

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
