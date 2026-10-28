/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ secure: new Map<string, string>(), files: new Set<string>(), failFile: '', fetch: vi.fn() }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => state.secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { state.secure.set(key, value); },
  deleteItemAsync: async (key: string) => { state.secure.delete(key); },
}));
vi.mock('expo-file-system', () => ({ File: class {
  constructor(public uri: string) {}
  get exists() { return state.files.has(this.uri); }
  delete() { if (this.uri === state.failFile) throw new Error('disk failure'); state.files.delete(this.uri); }
} }));
vi.mock('../src/lib/api', () => ({ API_URL: 'https://api.example', ApiError: class extends Error {
  constructor(public status: number, public code: string) { super(code); }
} }));
vi.mock('../src/lib/rehearsal-audio', () => ({
  isOwnedAudioFilename: (name: string) => /^audio-\d+-[a-z0-9]+\.mp3$/.test(name),
  audioFile: (name: string) => ({ uri: `file:///${name}`, get exists() { return state.files.has(this.uri); },
    delete() { if (this.uri === state.failFile) throw new Error('disk failure'); state.files.delete(this.uri); } }),
}));
import { clearDeletedAccountPrivateData, deleteAccountOnServer, finishAccountDeletion, isAccountPrivateKey, pendingAccountDeletion } from '../src/lib/account-deletion';
const databases: DatabaseSync[] = [];
beforeEach(() => {
  state.secure.clear(); state.files.clear(); state.failFile = ''; state.fetch.mockReset();
  vi.stubGlobal('__DEV__', false); vi.stubGlobal('fetch', state.fetch);
});
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function database() {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec(`CREATE TABLE personal_section_notes(song_id TEXT, section_key TEXT, text TEXT);
    CREATE TABLE personal_rehearsal_audio(song_id TEXT, filename TEXT PRIMARY KEY);`);
  const adapter = {
    async getFirstAsync(sql: string, ...args: (string | number | null)[]) { return sqlite.prepare(sql).get(...args) ?? null; },
    async getAllAsync(sql: string, ...args: (string | number | null)[]) { return sqlite.prepare(sql).all(...args); },
    async runAsync(sql: string, ...args: (string | number | null)[]) { return sqlite.prepare(sql).run(...args); },
    async withExclusiveTransactionAsync(work: (tx: unknown) => Promise<void>) {
      sqlite.exec('BEGIN'); try { await work(adapter); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, db: adapter as unknown as SQLiteDatabase };
}

describe('account deletion local safety', () => {
  it('matches only the exact account scope, never guests, prefixes or malformed keys', () => {
    expect(isAccountPrivateKey('["u1","song"]', 'u1')).toBe(true);
    for (const key of ['["u10","song"]', '[null,"song"]', '["u1","song","extra"]', '["u1",{}]', 'song', '{"0":"u1"}'])
      expect(isAccountPrivateKey(key, 'u1')).toBe(false);
  });
  it('deletes only owned notes, audio rows and files while preserving other accounts and guest data', async () => {
    const { db, sqlite } = database();
    for (const [key, filename] of [['["u1","song"]', 'audio-1-own.mp3'], ['["u2","song"]', 'audio-2-other.mp3'], ['[null,"song"]', 'audio-3-guest.mp3']]) {
      sqlite.prepare('INSERT INTO personal_section_notes VALUES (?,?,?)').run(key, 'verse', 'private');
      sqlite.prepare('INSERT INTO personal_rehearsal_audio VALUES (?,?)').run(key, filename);
      state.files.add(`file:///${filename}`);
    }
    await clearDeletedAccountPrivateData(db, 'u1');
    expect(sqlite.prepare('SELECT song_id FROM personal_section_notes').all().map((row) => row.song_id)).toEqual(['["u2","song"]', '[null,"song"]']);
    expect(sqlite.prepare('SELECT filename FROM personal_rehearsal_audio').all().map((row) => row.filename)).toEqual(['audio-2-other.mp3', 'audio-3-guest.mp3']);
    expect([...state.files]).toEqual(['file:///audio-2-other.mp3', 'file:///audio-3-guest.mp3']);
    await clearDeletedAccountPrivateData(db, 'u1');
    expect(state.files.size).toBe(2);
  });
  it('retains metadata on file cleanup failure and safely retries without touching another account', async () => {
    const { db, sqlite } = database();
    sqlite.prepare('INSERT INTO personal_rehearsal_audio VALUES (?,?)').run('["u1","song"]', 'audio-1-own.mp3');
    state.files.add('file:///audio-1-own.mp3'); state.failFile = 'file:///audio-1-own.mp3';
    await expect(clearDeletedAccountPrivateData(db, 'u1')).rejects.toThrow('disk failure');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM personal_rehearsal_audio').get()?.n).toBe(1);
    state.failFile = '';
    await clearDeletedAccountPrivateData(db, 'u1');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM personal_rehearsal_audio').get()?.n).toBe(0);
  });
  it('rejects unsafe audio paths before removing metadata or files', async () => {
    const { db, sqlite } = database();
    sqlite.prepare('INSERT INTO personal_rehearsal_audio VALUES (?,?)').run('["u1","song"]', '../other-account.mp3');
    await expect(clearDeletedAccountPrivateData(db, 'u1')).rejects.toThrow('безпечно');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM personal_rehearsal_audio').get()?.n).toBe(1);
  });
});

describe('deletion request recovery', () => {
  it('retains a pending bearer on network failure and recovers after normal credentials are cleared', async () => {
    state.secure.set('session_token', 'original-bearer');
    state.fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(deleteAccountOnServer('u1')).rejects.toThrow('локальні дані поки збережено');
    expect(await pendingAccountDeletion()).toMatchObject({ userId: 'u1', token: 'original-bearer' });
    state.secure.delete('session_token');
    state.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, appleRevocation: 'manual_required' }), { status: 200 }));
    expect(await deleteAccountOnServer('u1')).toEqual({ ok: true, appleRevocation: 'manual_required' });
    expect(state.fetch.mock.lastCall?.[1].headers.Authorization).toBe('Bearer original-bearer');
    expect(JSON.parse(state.fetch.mock.lastCall?.[1].body)).toEqual({ userId: 'u1', confirmation: 'DELETE' });
    await deleteAccountOnServer('u1');
    expect(state.fetch).toHaveBeenCalledTimes(2);
    await finishAccountDeletion();
    expect(await pendingAccountDeletion()).toBeNull();
  });
  it('does not report a generic unauthorized response or malformed success as deletion', async () => {
    state.secure.set('session_token', 'bearer');
    state.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'recent_auth_required' }), { status: 401 }));
    await expect(deleteAccountOnServer('u1')).rejects.toMatchObject({ status: 401, code: 'recent_auth_required' });
    expect(await pendingAccountDeletion()).toBeNull();
    state.fetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(deleteAccountOnServer('u1')).rejects.toThrow('Сервер не підтвердив');
    expect((await pendingAccountDeletion())?.result).toBeUndefined();
  });
  it('does not overwrite a different account pending request', async () => {
    state.secure.set('session_token', 'bearer');
    state.fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(deleteAccountOnServer('u1')).rejects.toThrow();
    await expect(deleteAccountOnServer('u2')).rejects.toThrow('попереднє видалення');
    expect((await pendingAccountDeletion())?.userId).toBe('u1');
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });
});
