import { usePreventRemove } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useT } from './settings';

/** Protect back buttons, swipe dismissal and explicit cancellation with the same confirmation. */
export function useUnsavedChanges(dirty: boolean, saving = false) {
  const t = useT();
  const [discarded, setDiscarded] = useState(false);
  useEffect(() => { if (!dirty && !saving) setDiscarded(false); }, [dirty, saving]);
  const confirmDiscard = (proceed: () => void) => {
    if (saving) { Alert.alert(t('Збереження…'), t('Зачекайте, доки зміни буде збережено.')); return; }
    if (!dirty) { proceed(); return; }
    Alert.alert(t('Відкинути незбережені зміни?'), t('Зміни ще не збережено. Ви можете залишитися та зберегти їх.'), [
      { text: t('Залишитися'), style: 'cancel' },
      { text: t('Відкинути зміни'), style: 'destructive', onPress: () => { setDiscarded(true); proceed(); } },
    ]);
  };
  usePreventRemove((dirty || saving) && !discarded, ({ repeat }) => confirmDiscard(repeat));
  return confirmDiscard;
}
