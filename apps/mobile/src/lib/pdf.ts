import { buildPdfHtml, type PdfDocument, type PdfSong, type PdfVariant } from '@songbook/shared';
import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';
import { albumSongIds, getAlbum, getAlbumPlan, getOverride, getSong } from './db';
import { t } from './i18n';

export interface ExportTarget { songId?: string; albumId?: number }

/** Call only after confirming that PDF export includes the user's local arrangement edits. */
export async function createPdfDocument(db: SQLiteDatabase, target: ExportTarget, variant: PdfVariant,
  notation?: PdfDocument['notation']): Promise<PdfDocument> {
  const album = target.albumId === undefined ? null : await getAlbum(db, target.albumId);
  if (target.albumId !== undefined && !album) throw new Error(t('Альбом не знайдено'));
  const plan = target.albumId === undefined ? {} : await getAlbumPlan(db, target.albumId);
  const ids = target.songId ? [target.songId] : target.albumId === undefined ? [] : await albumSongIds(db, target.albumId);
  if (!ids.length) throw new Error(t('Альбом порожній'));
  const songs: PdfSong[] = [];
  for (const id of ids) {
    const song = await getSong(db, id);
    if (!song) throw new Error(t('Пісню видалено або ще не синхронізовано'));
    const override = await getOverride(db, id);
    songs.push({ title: song.title, chordpro: override?.chordpro ?? song.chordpro,
      settings: target.albumId === undefined ? { transpose: override?.transpose, capo: override?.capo } : plan.songSettings?.[id] });
  }
  return { ...plan, title: target.songId ? songs[0].title! : album!.name, songs, variant, notation,
    labels: { verse: t('Куплет'), chorus: t('Приспів'), bridge: t('Бридж'), key: t('Тональність'),
      capo: t('Капо'), leader: t('Ведучий'), notes: t('Нотатки') } };
}

/** Keep the temporary file until the native share sheet finishes, then remove it on every exit. */
export async function exportPdf(document: PdfDocument): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error(t('Поширення PDF недоступне на цьому пристрої'));
  const { uri } = await Print.printToFileAsync({ html: buildPdfHtml(document), width: 595, height: 842 });
  try {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: document.title });
  } finally {
    const file = new File(uri);
    if (file.exists) file.delete();
  }
}
