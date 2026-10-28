import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export type AudioExtension = 'mp3' | 'm4a' | 'wav' | 'aac';
export interface AudioAttachment {
  filename: string;
  name: string;
  size: number;
}

export function audioExtension(name: string): AudioExtension {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase();
  if (ext !== 'mp3' && ext !== 'm4a' && ext !== 'wav' && ext !== 'aac') throw new Error('format');
  return ext;
}

export function validateAudioUrl(input: string): { url: string; name: string; extension: AudioExtension } {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('url'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) throw new Error('url');
  let name: string;
  try { name = decodeURIComponent(url.pathname.split('/').at(-1) ?? ''); } catch { throw new Error('url'); }
  if (/[\\/\x00-\x1f]/.test(name)) throw new Error('url');
  return { url: url.href, name, extension: audioExtension(name) };
}

export function validateAudioSize(size: number) {
  if (!Number.isFinite(size) || size <= 0 || size > MAX_AUDIO_BYTES) throw new Error('size');
}

export function validateLoopRange(start: number, end: number, duration: number): boolean {
  return [start, end, duration].every(Number.isFinite) && duration > 0 && start >= 0 && end <= duration && end - start >= 0.25;
}

export function isOwnedAudioFilename(filename: string): boolean {
  return /^audio-\d+-[a-z0-9]+\.(mp3|m4a|wav|aac)$/.test(filename);
}

/** Reject HTML and renamed documents before passing them to the native decoder. */
export function hasAudioHeader(bytes: Uint8Array, extension: AudioExtension): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length < 12) return false;
  if (extension === 'wav') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
  if (extension === 'm4a') return ascii(4, 8) === 'ftyp';
  if (extension === 'mp3') return ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 6) !== 0);
  return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
}

const directory = () => new Directory(Paths.document, 'rehearsal-audio');
export function audioFile(filename: string): File {
  if (!isOwnedAudioFilename(filename)) throw new Error('storage');
  const file = new File(directory(), filename);
  const staged = new File(directory(), `${filename}.deleting`);
  // Recover an interrupted deletion before playback or another removal attempt.
  if (!file.exists && staged.exists) staged.moveSync(file);
  return file;
}

async function ensureAudio(db: SQLiteDatabase) {
  await db.execAsync(`CREATE TABLE IF NOT EXISTS personal_rehearsal_audio (
    song_id TEXT NOT NULL, filename TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL
  )`);
}
export async function loadAudioAttachments(db: SQLiteDatabase, songId: string): Promise<AudioAttachment[]> {
  await ensureAudio(db);
  return db.getAllAsync<AudioAttachment>('SELECT filename, name, size FROM personal_rehearsal_audio WHERE song_id = ? ORDER BY rowid', songId);
}

export async function importRehearsalAudio(
  db: SQLiteDatabase,
  songId: string,
  source: { uri: string; name: string; size?: number; mimeType?: string },
  signal?: AbortSignal,
): Promise<AudioAttachment> {
  let extension: AudioExtension;
  let uri = source.uri;
  if (uri.startsWith('https:')) {
    const remote = validateAudioUrl(uri);
    extension = remote.extension;
    uri = remote.url;
  } else {
    if (!/^(file|content):\/\//.test(uri)) throw new Error('url');
    extension = audioExtension(source.name);
    if (source.mimeType && !source.mimeType.startsWith('audio/') && source.mimeType !== 'application/octet-stream') throw new Error('format');
  }
  if (source.size !== undefined) validateAudioSize(source.size);
  if (signal?.aborted) throw new Error('cancelled');
  await ensureAudio(db);
  if (signal?.aborted) throw new Error('cancelled');
  directory().create({ intermediates: true, idempotent: true });
  const filename = `audio-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const destination = audioFile(filename);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 120000);
  let tooLarge = false;
  try {
    if (uri.startsWith('https:')) {
      await File.downloadFileAsync(uri, destination, {
        signal: controller.signal,
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (bytesWritten > MAX_AUDIO_BYTES || totalBytes > MAX_AUDIO_BYTES) { tooLarge = true; controller.abort(); }
        },
      });
    } else {
      const original = new File(uri);
      validateAudioSize(original.size);
      await original.copy(destination);
    }
    if (controller.signal.aborted) throw new Error(tooLarge ? 'size' : 'cancelled');
    validateAudioSize(destination.size);
    const handle = destination.open();
    try { if (!hasAudioHeader(await handle.readBytes(16), extension)) throw new Error('format'); }
    finally { handle.close(); }
    if (controller.signal.aborted) throw new Error('cancelled');
    const attachment = { filename, name: source.name.slice(0, 240), size: destination.size };
    await db.runAsync('INSERT INTO personal_rehearsal_audio (song_id, filename, name, size) VALUES (?, ?, ?, ?)', songId, filename, attachment.name, attachment.size);
    return attachment;
  } catch (error) {
    if (destination.exists) destination.delete();
    if (tooLarge) throw new Error('size');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function removeAudioAttachment(db: SQLiteDatabase, songId: string, filename: string) {
  await ensureAudio(db);
  const row = await db.getFirstAsync<AudioAttachment>('SELECT filename, name, size FROM personal_rehearsal_audio WHERE song_id = ? AND filename = ?', songId, filename);
  if (!row) throw new Error('missing');
  const file = audioFile(row.filename);
  const staged = new File(directory(), `${row.filename}.deleting`);
  if (file.exists) file.moveSync(staged);
  try {
    await db.runAsync('DELETE FROM personal_rehearsal_audio WHERE song_id = ? AND filename = ?', songId, filename);
  } catch (error) {
    if (staged.exists) {
      try { staged.moveSync(new File(directory(), row.filename)); }
      catch (restoreError) {
        // Keep the staged bytes; audioFile retries restoration on the next access.
        throw new Error('audio_restore_failed', { cause: { database: error, restore: restoreError } });
      }
    }
    throw error;
  }
  // shortcut: a crash or cleanup failure can leave staged bytes; add orphan cleanup if storage use becomes a problem.
  try { if (staged.exists) staged.delete(); }
  catch (error) { console.warn('Removed audio metadata; staged file cleanup failed', error); }
}
