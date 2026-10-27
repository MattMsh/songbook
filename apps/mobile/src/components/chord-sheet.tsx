import { chordBars, isChordOnlyLine, type Line, type ParsedSong, type Segment } from '@songbook/shared';
import { StyleSheet, Text, View } from 'react-native';
import { usePartStyle } from '@/lib/parts';
import { useTheme } from '@/lib/settings';

interface Part {
  chord: string | null;
  text: string;
}

/**
 * Groups segments into words so a line wraps only between words and a chord
 * stays attached to the first word of its segment.
 */
export function toWords(segments: Segment[]): Part[][] {
  const words: Part[][] = [];
  let cur: Part[] = [];
  for (const seg of segments) {
    const tokens = seg.text.match(/\s+|\S+\s*/g) ?? [''];
    tokens.forEach((text, i) => {
      const prev = cur.at(-1);
      if (cur.length && (/\s$/.test(prev!.text) || /^\s/.test(text))) {
        words.push(cur);
        cur = [];
      }
      cur.push({ chord: i === 0 ? seg.chord : null, text });
    });
  }
  if (cur.length) words.push(cur);
  return words;
}

/** «Приспів x2» → «ПРИСПІВ x2»: capitals for the name, the repeat mark stays readable. */
const labelText = (label: string) => {
  const [, name, repeat = ''] = /^(.*?)(\s*[x×х]\d+)?$/i.exec(label)!; // i18n-ignore: Cyrillic «х» is a repeat mark in song text
  return name.toUpperCase() + repeat.toLowerCase();
};

export function ChordSheet({
  song,
  showChords,
  mapChord,
  fontSize,
  showLyrics = true,
}: {
  song: ParsedSong;
  showChords: boolean;
  mapChord: (c: string) => string;
  fontSize: number;
  /** With chords on: false shows only the chords of each line. */
  showLyrics?: boolean;
}) {
  const { colors } = useTheme();
  const parts = usePartStyle();
  const lyric = { color: colors.text, fontSize, lineHeight: fontSize * 1.35 };
  // Each song block gets its own chord colour; unlabelled parts keep the base one.
  const partColor = (label: string | null) => {
    const type = label ? parts.match(label) : null;
    return type ? parts.colorOf(type) : null;
  };
  const baseChord = { fontSize: fontSize * 0.85, fontWeight: '700' as const, lineHeight: fontSize * 1.15 };

  const renderLine = (line: Line, key: number, lines: Line[], color: string) => {
    const chordStyle = { ...baseChord, color };
    if (line.type === 'empty') return <View key={key} style={{ height: fontSize * 0.6 }} />;
    if (line.type === 'comment') {
      const isPart = !!partColor(line.text);
      // Readers don't need a label like «Програш» whose content is only chords.
      const next = lines.slice(key + 1).find((l) => l.type !== 'empty');
      if (!showChords && (!next || (next.type === 'lyrics' && isChordOnlyLine(next.segments)))) return null;
      // A block name looks the same whether it comes from {soc: …} or a {c: …} comment.
      if (isPart)
        return (
          <Text key={key} style={[styles.label, { color: showChords ? chordStyle.color : colors.muted, fontSize: fontSize * 0.75 }]}>
            {labelText(line.text)}
          </Text>
        );
      return (
        <Text key={key} style={[styles.comment, { color: colors.muted, fontSize: fontSize * 0.8 }]}>
          {line.text}
        </Text>
      );
    }
    if (!showChords) {
      if (isChordOnlyLine(line.segments)) return null;
      return (
        <Text key={key} style={lyric}>
          {line.segments.map((s) => s.text).join('').trim()}
        </Text>
      );
    }
    const grid = isChordOnlyLine(line.segments) ? chordBars(line.segments) : null;
    if (grid)
      return (
        <View key={key} style={styles.gridRow}>
          <View style={styles.bars}>
            {grid.bars.map((bar, b) => (
              // Four equal bars per row (a musical phrase); chords inside a bar split it evenly.
              <View
                key={b}
                style={[styles.bar, { borderColor: colors.muted }, b === grid.bars.length - 1 && styles.lastBar]}>
                {bar.map((c, i) => (
                  <Text key={i} numberOfLines={1} style={[chordStyle, { flex: 1 }]}>
                    {mapChord(c)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
          {/* Always reserved, so bar columns line up across sections. */}
          <Text style={[lyric, { color: colors.muted, width: fontSize * 2.2, textAlign: 'right' }]}>{grid.rest}</Text>
        </View>
      );
    if (isChordOnlyLine(line.segments))
      return (
        <Text key={key} style={[lyric, { color: colors.muted }]}>
          {line.segments.map((s, i) => (
            <Text key={i}>
              {s.chord && <Text style={chordStyle}>{mapChord(s.chord)}</Text>}
              {s.text || ' '}
            </Text>
          ))}
        </Text>
      );
    const hasChords = line.segments.some((s) => s.chord);
    if (!showLyrics) {
      if (!hasChords) return null;
      return (
        <Text key={key} style={[chordStyle, { marginBottom: 4 }]}>
          {line.segments
            .filter((s) => s.chord)
            .map((s) => mapChord(s.chord!))
            .join('   ')}
        </Text>
      );
    }
    return (
      <View key={key} style={styles.line}>
        {toWords(line.segments).map((word, w) => (
          <View key={w} style={styles.word}>
            {word.map((p, i) => (
              <View key={i}>
                {hasChords && <Text style={[chordStyle, styles.chord]}>{p.chord ? mapChord(p.chord) : ' '}</Text>}
                <Text style={lyric}>{p.text}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={{ gap: fontSize * 0.2 }}>
      {song.sections.map((section, s) => {
        const labelColor = partColor(section.label);
        const color = labelColor ?? colors.chord;
        // A label comment such as «Приспів» switches the colour from that line on.
        const lineColors: string[] = [];
        for (const l of section.lines)
          lineColors.push((l.type === 'comment' && partColor(l.text)) || (lineColors.at(-1) ?? color));
        return (
          <View key={s} style={section.kind === 'chorus' && [styles.chorus, { borderColor: showChords ? color : colors.accent }]}>
            {section.label && (
              <Text style={[styles.label, { color: labelColor && showChords ? color : colors.muted, fontSize: fontSize * 0.75 }]}>
                {labelText(section.label)}
              </Text>
            )}
            {section.lines.map((line, i) => renderLine(line, i, section.lines, lineColors[i]))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  word: { flexDirection: 'row' },
  chord: { paddingRight: 4 },
  comment: { fontStyle: 'italic', fontWeight: '600', marginTop: 8 },
  label: { fontWeight: '700', marginTop: 8 },
  chorus: { borderLeftWidth: 3, paddingLeft: 10, marginVertical: 6 },
  gridRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  bars: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 },
  bar: { width: '25%', flexDirection: 'row', borderLeftWidth: 1.5, paddingLeft: 6 },
  lastBar: { borderRightWidth: 1.5 },
});
