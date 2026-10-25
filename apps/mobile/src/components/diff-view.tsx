import type { DiffLine } from '@songbook/shared';
import { Text, View } from 'react-native';
import { useTheme } from '@/lib/settings';

export function DiffView({ diff }: { diff: DiffLine[] }) {
  const { colors } = useTheme();
  return (
    <View>
      {diff.map((l, i) => (
        <Text
          key={i}
          style={{
            fontFamily: 'monospace',
            fontSize: 13,
            color: l.op === 'eq' ? colors.muted : colors.text,
            backgroundColor: l.op === 'add' ? colors.add : l.op === 'del' ? colors.del : 'transparent',
          }}>
          {l.op === 'add' ? '+ ' : l.op === 'del' ? '− ' : '  '}
          {l.text}
        </Text>
      ))}
    </View>
  );
}
