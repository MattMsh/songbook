import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Language } from '@/lib/i18n';
import { deviceLanguage, useSettings, useT, useTheme, type Settings } from '@/lib/settings';
import { Icon, type IconName } from './ui';

// Before a language is chosen the globe says it visually; screen readers hear both languages.
const CHOOSE_LANGUAGE = 'Оберіть мову. Выберите язык'; // i18n-ignore

function BigChoice({ icon, title, subtitle, onPress }: { icon?: IconName; title: string; subtitle?: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        minHeight: 88,
        padding: 20,
        borderRadius: 20,
        borderCurve: 'continuous',
        backgroundColor: colors.card,
        opacity: pressed ? 0.7 : 1,
      })}>
      {icon && <Icon name={icon} size={32} color={colors.accent} />}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '600' }}>{title}</Text>
        {subtitle && <Text style={{ color: colors.muted, fontSize: 16 }}>{subtitle}</Text>}
      </View>
    </Pressable>
  );
}

/**
 * First run: reader or musician mode, plus the language when the device language is neither
 * Ukrainian nor Russian. Both stay editable in the profile.
 */
export function Welcome() {
  const { update } = useSettings();
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'language' | 'mode'>(() => (deviceLanguage() ? 'mode' : 'language'));

  const pickLanguage = (language: Language) => {
    update({ language });
    setStep('mode');
  };
  const pickMode = (mode: Settings['mode']) => update({ mode, onboarded: true });
  const titleStyle = { color: colors.text, fontSize: 28, fontWeight: '700', textAlign: 'center', paddingBottom: 8 } as const;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
      }}>
      {step === 'language' ? (
        <>
          <View accessible accessibilityRole="header" accessibilityLabel={CHOOSE_LANGUAGE} style={{ alignItems: 'center', paddingBottom: 8 }}>
            <Icon name="globe" size={72} color={colors.accent} />
          </View>
          {/* Language names stay in their own language, so anyone can find theirs. */}
          <BigChoice title="Українська" onPress={() => pickLanguage('uk')} />
          <BigChoice title="Русский" onPress={() => pickLanguage('ru')} />
        </>
      ) : (
        <>
          <Text accessibilityRole="header" style={titleStyle}>
            {t('Як ви користуватиметесь збірником?')}
          </Text>
          <BigChoice
            icon="singer"
            title={t('Співаю / читаю')}
            subtitle={t('Тексти пісень великим шрифтом, без акордів.')}
            onPress={() => pickMode('reader')}
          />
          <BigChoice
            icon="musician"
            title={t('Музикант')}
            subtitle={t('Акорди, тональність, капо, метроном і бій.')}
            onPress={() => pickMode('musician')}
          />
          <Text style={{ color: colors.muted, fontSize: 15, textAlign: 'center' }}>{t('Це можна змінити будь-коли в профілі.')}</Text>
        </>
      )}
    </ScrollView>
  );
}
