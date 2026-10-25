import { NativeTabs } from 'expo-router/native-tabs';
import { useT, useTheme } from '@/lib/settings';

export default function TabLayout() {
  const { colors } = useTheme();
  const t = useT();
  return (
    <NativeTabs tintColor={colors.accent}>
      <NativeTabs.Trigger name="(songs)">
        <NativeTabs.Trigger.Icon sf="music.note.list" md="queue_music" />
        <NativeTabs.Trigger.Label>{t('Пісні')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(albums)">
        <NativeTabs.Trigger.Icon sf={{ default: 'square.stack', selected: 'square.stack.fill' }} md="library_music" />
        <NativeTabs.Trigger.Label>{t('Альбоми')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(profile)">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
        <NativeTabs.Trigger.Label>{t('Профіль')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
