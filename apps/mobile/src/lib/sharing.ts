import {
  lyricsText, normalizeSearch, parseChordPro, parsePlanShareRequest, parsePlanShareSnapshot,
  PUBLIC_SONG_ID_RE, SHARE_MAX_SONGS, SHARE_TOKEN_RE, ShareValidationError, songFields,
  type PlanShareRequest, type PlanShareSnapshot, type SyncSong,
} from '@songbook/shared';
import * as Linking from 'expo-linking';
import type { SQLiteDatabase } from 'expo-sqlite';
import { api, ApiError } from './api';
import { albumSongIds, bumpRevision, getAlbum, getAlbumPlan, getSong, searchEngine } from './db';
import { t } from './i18n';

/** Imported snapshots retain the original public ID but never replace the canonical row. */
export function publicSongId(id: string): string {
  const source = id.replace(/^share:\d+:/, '');
  if (!PUBLIC_SONG_ID_RE.test(source)) throw new Error(t('Цю локальну пісню неможливо поширити'));
  return source;
}

// Expo Go links require the same running Metro session; installed builds use the app scheme.
export const songShareUrl = (id: string) => Linking.createURL(`/share-song/${encodeURIComponent(publicSongId(id))}`);
export const planShareUrl = (token: string) => {
  if (!SHARE_TOKEN_RE.test(token)) throw new Error(t('Недійсне посилання'));
  return Linking.createURL(`/share/${token}`);
};

export async function createPlanShare(db: SQLiteDatabase, albumId: number): Promise<string> {
  const album = await getAlbum(db, albumId);
  if (!album) throw new Error(t('Альбом не знайдено'));
  const ids = await albumSongIds(db, albumId);
  if (!ids.length) throw new Error(t('Альбом порожній'));
  if (ids.length > SHARE_MAX_SONGS) throw new Error(t('Посилання може містити не більше 100 пісень'));
  const plan = await getAlbumPlan(db, albumId);
  let request: PlanShareRequest;
  try {
    request = parsePlanShareRequest({ ...plan, name: album.name, songIds: ids.map(publicSongId),
      songSettings: Object.fromEntries(Object.entries(plan.songSettings ?? {}).map(([id, settings]) => [publicSongId(id), settings])) });
  } catch (e) {
    if (e instanceof ShareValidationError && e.message === 'size')
      throw new Error(t('План завеликий для посилання. Зменште кількість пісень.'));
    throw e;
  }
  try {
    const { token } = await api<{ token: string }>('/shares', { body: request });
    return planShareUrl(token);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'missing_songs')
      throw new Error(t('Деякі пісні недоступні на сервері. Оновіть план і повторіть.'));
    if (e instanceof ApiError && e.status === 413)
      throw new Error(t('План завеликий для посилання. Зменште кількість пісень.'));
    throw e;
  }
}

export async function fetchPlanShare(token: string): Promise<PlanShareSnapshot> {
  if (!SHARE_TOKEN_RE.test(token)) throw new Error(t('Недійсне посилання'));
  const value = await api<unknown>(`/shares/${token}`);
  try { return parsePlanShareSnapshot(value); }
  catch { throw new Error(t('Посилання містить недійсний або неповний план')); }
}

async function insertSong(tx: SQLiteDatabase, id: string, chordpro: string, version = 1, updatedAt = Date.now()) {
  const fields = songFields(chordpro);
  const titleNorm = normalizeSearch(fields.title);
  const lyricsNorm = normalizeSearch(lyricsText(parseChordPro(chordpro)));
  const result = await tx.runAsync(
    `INSERT OR IGNORE INTO songs (id, number, title, key, bpm, time_sig, rhythm, chordpro, version, updated_at, title_norm, lyrics_norm)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, fields.number, fields.title, fields.key, fields.bpm, fields.timeSig, fields.rhythm,
    chordpro, version, updatedAt, titleNorm, lyricsNorm,
  );
  if (result.changes && searchEngine() === 'FTS5')
    await tx.runAsync('INSERT INTO songs_fts (id, title_norm, lyrics_norm) VALUES (?, ?, ?)', id, titleNorm, lyricsNorm);
}

/** One transaction creates an independent local copy, including every song and plan setting. */
export async function importPlanShare(db: SQLiteDatabase, value: unknown): Promise<number> {
  const snapshot = parsePlanShareSnapshot(value);
  let albumId = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.runAsync('INSERT INTO albums (name, created_at) VALUES (?, ?)', snapshot.name, Date.now());
    albumId = row.lastInsertRowId;
    const { version: _version, name: _name, songs, ...plan } = snapshot;
    const idFor = (id: string) => `share:${albumId}:${id}`;
    const localPlan = { ...plan, songSettings: Object.fromEntries(
      Object.entries(plan.songSettings ?? {}).map(([id, settings]) => [idFor(id), settings]),
    ) };
    await tx.runAsync('UPDATE albums SET plan = ? WHERE id = ?', JSON.stringify(localPlan), albumId);
    for (const [position, song] of songs.entries()) {
      await insertSong(tx, idFor(song.id), song.chordpro);
      await tx.runAsync('INSERT INTO album_songs (album_id, song_id, position) VALUES (?, ?, ?)', albumId, idFor(song.id), position);
    }
  });
  bumpRevision();
  return albumId;
}

/** A song link works offline when cached; a cache miss fetches only that public song. */
export async function ensureSharedSong(db: SQLiteDatabase, id: string): Promise<void> {
  if (!PUBLIC_SONG_ID_RE.test(id)) throw new Error(t('Недійсне посилання'));
  if (await getSong(db, id)) return;
  const song = await api<SyncSong>(`/songs/${encodeURIComponent(id)}`);
  if (song.deletedAt || song.id !== id) throw new Error(t('Пісню видалено або ще не синхронізовано'));
  const snapshot = parsePlanShareSnapshot({ version: 1, name: 'song', songs: [song] });
  await db.withExclusiveTransactionAsync(async (tx) => {
    await insertSong(tx, id, snapshot.songs[0].chordpro,
      Number.isInteger(song.version) && song.version > 0 ? song.version : 1,
      Number.isFinite(song.updatedAt) ? song.updatedAt : Date.now());
  });
  bumpRevision();
}
