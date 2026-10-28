import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import type { SQLiteDatabase } from 'expo-sqlite';
import { API_URL, ApiError } from './api';
import { t } from './i18n';
import { audioFile, isOwnedAudioFilename } from './rehearsal-audio';

const PENDING_KEY = 'pending_account_deletion';
export const APPLE_REVOCATION_HELP_URL = 'https://support.apple.com/en-us/102571';
export interface AccountDeletionResult {
  ok: true;
  appleRevocation: 'manual_required' | 'not_applicable';
}
export interface PendingAccountDeletion {
  userId: string;
  token: string;
  result?: AccountDeletionResult;
}

export function isAccountPrivateKey(key: string, userId: string): boolean {
  try {
    const value = JSON.parse(key);
    return Array.isArray(value) && value.length === 2 && value[0] === userId && typeof value[1] === 'string';
  } catch { return false; }
}

export async function pendingAccountDeletion(): Promise<PendingAccountDeletion | null> {
  const value = await SecureStore.getItemAsync(PENDING_KEY);
  if (!value) return null;
  const pending = JSON.parse(value) as PendingAccountDeletion;
  if (!pending || typeof pending.userId !== 'string' || !pending.userId || typeof pending.token !== 'string' || !pending.token ||
      pending.result && (pending.result.ok !== true || !['manual_required', 'not_applicable'].includes(pending.result.appleRevocation)))
    throw new Error(t('Не вдалося прочитати стан видалення акаунта'));
  return pending;
}

/** Save the old bearer separately so a lost response can be recovered after startup invalidates the session. */
export async function deleteAccountOnServer(userId: string): Promise<AccountDeletionResult> {
  let pending = await pendingAccountDeletion();
  if (pending && pending.userId !== userId) throw new Error(t('Спочатку завершіть попереднє видалення акаунта'));
  if (pending?.result) return pending.result;
  if (!pending) {
    const token = await SecureStore.getItemAsync('session_token');
    if (!token) throw new ApiError(401, 'unauthorized');
    pending = { userId, token };
    await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(pending));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_URL}/account/delete`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pending.token}` },
      body: JSON.stringify({ userId, confirmation: 'DELETE' }),
    }).catch(() => {
      throw new Error(t('Не вдалося підтвердити видалення через мережу. Повторіть запит; локальні дані поки збережено.'));
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) await SecureStore.deleteItemAsync(PENDING_KEY);
      throw new ApiError(response.status, body.error ?? 'http_' + response.status);
    }
    if (body.ok !== true || !['manual_required', 'not_applicable'].includes(body.appleRevocation))
      throw new Error(t('Сервер не підтвердив видалення. Спробуйте ще раз.'));
    const result: AccountDeletionResult = { ok: true, appleRevocation: body.appleRevocation };
    await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify({ ...pending, result }));
    return result;
  } finally { clearTimeout(timer); }
}

export const finishAccountDeletion = () => SecureStore.deleteItemAsync(PENDING_KEY);

/** Exact JSON ownership checks preserve guest data and every other account's private rows. */
export async function clearDeletedAccountPrivateData(db: SQLiteDatabase, userId: string): Promise<void> {
  if (!userId) throw new Error('Missing account ID');
  const exists = async (table: string) => Boolean(await db.getFirstAsync('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?', 'table', table));
  const hasNotes = await exists('personal_section_notes');
  const hasAudio = await exists('personal_rehearsal_audio');
  const audio = hasAudio ? (await db.getAllAsync<{ song_id: string; filename: string }>(
    'SELECT song_id, filename FROM personal_rehearsal_audio',
  )).filter((row) => isAccountPrivateKey(row.song_id, userId)) : [];
  // Retain metadata until all owned files are gone, so an interrupted cleanup can safely retry.
  for (const row of audio) {
    if (!isOwnedAudioFilename(row.filename)) throw new Error(t('Не вдалося безпечно видалити аудіофайл'));
    const file = audioFile(row.filename);
    if (file.exists) file.delete();
    const staged = new File(file.uri + '.deleting');
    if (staged.exists) staged.delete();
  }
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const table of [hasNotes && 'personal_section_notes', hasAudio && 'personal_rehearsal_audio']) {
      if (!table) continue;
      const keys = await tx.getAllAsync<{ song_id: string }>(`SELECT DISTINCT song_id FROM ${table}`);
      for (const { song_id } of keys) if (isAccountPrivateKey(song_id, userId))
        await tx.runAsync(`DELETE FROM ${table} WHERE song_id = ?`, song_id);
    }
  });
}
