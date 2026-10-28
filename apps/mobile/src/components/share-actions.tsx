import type { PdfVariant } from '@songbook/shared';
import Constants from 'expo-constants';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Share, useWindowDimensions, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Banner, Button, Card, Row, T } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useRevision } from '@/lib/db';
import { createPdfDocument, exportPdf, type ExportTarget } from '@/lib/pdf';
import { useSettings, useT } from '@/lib/settings';
import { createPlanShare, songShareUrl } from '@/lib/sharing';

/** Song ID takes precedence; album ID alone creates an immutable plan link. */
export function ShareActions({ songId, albumId }: ExportTarget) {
  const db = useSQLiteContext();
  const t = useT();
  const revision = useRevision();
  const { width } = useWindowDimensions();
  const [url, setUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { setUrl(undefined); setError(undefined); }, [songId, albumId, revision]);

  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setUrl(songId ? songShareUrl(songId) : await createPlanShare(db, albumId!));
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const confirm = () => Alert.alert(t('Поширити посилання?'),
    t('Кожен, хто має посилання, зможе прочитати вміст. План містить порядок, налаштування та нотатки плану. Особисті нотатки, аудіо та локальні зміни пісень не поширюються.'),
    [{ text: t('Скасувати'), style: 'cancel' }, { text: t('Створити посилання'), onPress: () => void create() }]);
  const share = async () => {
    if (!url) return;
    try { await Share.share({ message: url, url }); }
    catch (e) { setError(errorMessage(e)); }
  };
  return <View style={{ gap: 10 }}>
    <Button title={t('Посилання та QR')} kind="secondary" disabled={busy || (!songId && albumId === undefined)} onPress={confirm} />
    {busy && <ActivityIndicator accessibilityLabel={t('Завантаження…')} />}
    {error && <Banner text={error} kind="warn" />}
    {url && <Card>
      <T selectable>{t('Кожен, хто має посилання, зможе прочитати вміст.')}</T>
      <View accessible accessibilityLabel={t('QR-код посилання')} style={{ alignSelf: 'center', padding: 16, backgroundColor: '#fff' }}>
        <QRCode value={url} size={Math.max(120, Math.min(240, width - 96))} />
      </View>
      <T selectable style={{ fontSize: 13 }}>{url}</T>
      <Button title={t('Поширити')} onPress={() => void share()} />
      <Button title={t('Сховати')} kind="ghost" onPress={() => setUrl(undefined)} />
    </Card>}
    {Constants.executionEnvironment === 'storeClient' && <T muted style={{ fontSize: 12 }}>
      {t('У Expo Go посилання працює лише з поточним сервером розробки. Для постійних посилань установіть збірку застосунку.')}
    </T>}
  </View>;
}

/** Local ChordPro edits are included only after the explicit PDF confirmation. */
export function PdfActions(target: ExportTarget) {
  const db = useSQLiteContext();
  const t = useT();
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (variant: PdfVariant) => {
    setBusy(true);
    setError(undefined);
    try {
      await exportPdf(await createPdfDocument(db, target, variant, settings.notation === 'auto' ? undefined : settings.notation));
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const confirm = (variant: PdfVariant) => Alert.alert(t('Експорт PDF'),
    t('PDF міститиме локальні зміни тексту та поточні налаштування транспозиції й капо. Для плану також додаються його нотатки. Особисті нотатки й аудіо не додаються.'),
    [{ text: t('Скасувати'), style: 'cancel' }, { text: t('Експортувати'), onPress: () => void run(variant) }]);
  return <View style={{ gap: 10 }}>
    <Row wrap>
      <Button small title={t('PDF: текст')} kind="secondary" disabled={busy} onPress={() => confirm('lyrics')} />
      <Button small title={t('PDF: музикант')} kind="secondary" disabled={busy} onPress={() => confirm('musician')} />
    </Row>
    {busy && <ActivityIndicator accessibilityLabel={t('Створення PDF…')} />}
    {error && <Banner text={error} kind="warn" />}
  </View>;
}
