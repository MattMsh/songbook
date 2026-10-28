/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseChordPro } from '@songbook/shared';
import { loadSongNotes, MAX_NOTE_LENGTH, noteSections, personalSongKey, saveSongNote } from '../src/lib/song-notes';
import { audioExtension, audioFile, hasAudioHeader, importRehearsalAudio, isOwnedAudioFilename, loadAudioAttachments, MAX_AUDIO_BYTES, removeAudioAttachment, validateAudioSize, validateAudioUrl, validateLoopRange } from '../src/lib/rehearsal-audio';

const storage = vi.hoisted(() => ({
  files: new Map<string, { size: number; bytes: Uint8Array }>(), oversized: false,
  moveFailure: null as 'stage' | 'restore' | null, deleteFailure: false,
}));
vi.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = parts.map((p) => typeof p === 'string' ? p : p.uri).join('/'); }
    create() {}
  }
  class File extends Directory {
    get exists() { return storage.files.has(this.uri); }
    get size() { return storage.files.get(this.uri)?.size ?? 0; }
    async copy(destination: File) {
      await Promise.resolve();
      storage.files.set(destination.uri, storage.files.get(this.uri)!);
    }
    moveSync(destination: File) {
      const phase = destination.uri.endsWith('.deleting') ? 'stage' : 'restore';
      if (storage.moveFailure === phase) throw new Error('move failed');
      if (!this.exists || destination.exists) throw new Error('invalid move');
      storage.files.set(destination.uri, storage.files.get(this.uri)!);
      storage.files.delete(this.uri);
      this.uri = destination.uri;
    }
    delete() {
      if (storage.deleteFailure) throw new Error('delete failed');
      storage.files.delete(this.uri);
    }
    open() { return { readBytes: async () => storage.files.get(this.uri)!.bytes, close() {} }; }
    static async downloadFileAsync(_url: string, destination: File, options: { signal?: AbortSignal; onProgress: (progress: { bytesWritten: number; totalBytes: number }) => void }) {
      storage.files.set(destination.uri, { size: 128, bytes: new Uint8Array([73, 68, 51, ...new Array(13).fill(0)]) });
      options.onProgress({ bytesWritten: storage.oversized ? MAX_AUDIO_BYTES + 1 : 128, totalBytes: 128 });
      if (options.signal?.aborted) throw new Error('aborted');
      return destination;
    }
  }
  return { Directory, File, Paths: { document: 'file:///documents' } };
});

const connections: DatabaseSync[] = [];
function database() {
  const sql = new DatabaseSync(':memory:');
  connections.push(sql);
  const db = {
    execAsync: async (query: string) => { sql.exec(query); },
    runAsync: async (query: string, ...args: (string | number | null)[]) => sql.prepare(query).run(...args),
    getFirstAsync: async (query: string, ...args: (string | number | null)[]) => sql.prepare(query).get(...args) ?? null,
    getAllAsync: async (query: string, ...args: (string | number | null)[]) => sql.prepare(query).all(...args),
  } as unknown as SQLiteDatabase;
  return { sql, db };
}
beforeEach(() => {
  storage.files.clear(); storage.oversized = false;
  storage.moveFailure = null; storage.deleteFailure = false;
});
afterEach(() => { for (const sql of connections.splice(0)) sql.close(); });

const verse = '{sov: Verse}\n[C]One\n{eov}';
const chorus = '{soc: Chorus}\n[G]Two\n{eoc}';
describe('private section notes', () => {
  it('keeps identity when distinct sections reorder and orphans edited text', () => {
    const original = noteSections(parseChordPro(`${verse}\n${chorus}`));
    const reordered = noteSections(parseChordPro(`${chorus}\n${verse}`));
    expect(original.map((s) => s.key).sort()).toEqual(reordered.map((s) => s.key).sort());
    expect(noteSections(parseChordPro(verse.replace('One', 'Different')))[0].key).not.toBe(original[0].key);
  });
  it('does not reuse ambiguous duplicate identities after a structural edit', () => {
    const original = noteSections(parseChordPro(`${verse}\n${verse}`));
    expect(new Set(original.map((s) => s.key)).size).toBe(2);
    const changed = noteSections(parseChordPro(`${verse}\n${verse}\n${chorus}`));
    expect(changed.some((s) => original.some((old) => old.key === s.key))).toBe(false);
    expect(original.some((s) => s.key === noteSections(parseChordPro(verse))[0].key)).toBe(false);
  });
  it('recognizes named comment sections without exposing chord tokens in previews', () => {
    const sections = noteSections(parseChordPro('{c: Куплет 1}\n[C]First\n{c: Приспів}\n[G]Second'));
    expect(sections.map((s) => s.label)).toEqual(['Куплет 1', 'Приспів']);
    expect(sections.map((s) => s.preview)).toEqual(['First', 'Second']);
  });
  it('persists, updates, isolates accounts and deletes notes without migration changes', async () => {
    const { db, sql } = database();
    sql.exec('PRAGMA user_version = 9');
    const section = noteSections(parseChordPro(verse))[0];
    const note = { section_key: section.key, label: 'Verse', preview: section.preview, text: 'Private' };
    const scope = personalSongKey('song', 'a');
    await saveSongNote(db, scope, note);
    await saveSongNote(db, scope, { ...note, text: 'Updated' });
    expect(await loadSongNotes(db, scope)).toEqual([{ ...note, text: 'Updated' }]);
    expect(await loadSongNotes(db, personalSongKey('song', 'b'))).toEqual([]);
    expect(await loadSongNotes(db, personalSongKey('song', null))).toEqual([]);
    expect(personalSongKey('song', 'guest')).not.toBe(personalSongKey('song', null));
    expect(sql.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 9 });
    await expect(saveSongNote(db, scope, { ...note, text: 'x'.repeat(MAX_NOTE_LENGTH + 1) })).rejects.toThrow();
    await saveSongNote(db, scope, { ...note, text: '  ' });
    expect(await loadSongNotes(db, scope)).toEqual([]);
  });
});

describe('audio validation and owned offline storage', () => {
  it('allows HTTPS direct files including signed URLs and rejects unsafe sources', () => {
    expect(validateAudioUrl(' https://example.com/demo.MP3?token=abc ').extension).toBe('mp3');
    for (const url of ['http://example.com/a.mp3', 'file:///a.mp3', 'https://u:p@example.com/a.mp3', 'https://example.com/watch?v=1', 'https://example.com/a.mp3#x', 'https://example.com/%2Fdemo.mp3', 'https://example.com/%zz.mp3']) {
      expect(() => validateAudioUrl(url)).toThrow();
    }
    expect(() => audioExtension('file.exe')).toThrow('format');
    expect(() => audioExtension('file.mp3.exe')).toThrow('format');
  });
  it('validates sizes and finite ordered loop boundaries', () => {
    validateAudioSize(MAX_AUDIO_BYTES);
    for (const size of [0, -1, Infinity, NaN, MAX_AUDIO_BYTES + 1]) expect(() => validateAudioSize(size)).toThrow('size');
    expect(validateLoopRange(0, 0.25, 2)).toBe(true);
    expect(validateLoopRange(1, 2, 2)).toBe(true);
    for (const range of [[-1, 1, 2], [1, 1, 2], [1, 3, 2], [0, 0.1, 2], [NaN, 1, 2], [0, Infinity, 2]]) {
      expect(validateLoopRange(...range as [number, number, number])).toBe(false);
    }
  });
  it('checks headers, not just filename extensions', () => {
    const bytes = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)));
    expect(hasAudioHeader(bytes('ID3xxxxxxxxxxxxx'), 'mp3')).toBe(true);
    expect(hasAudioHeader(bytes('RIFFxxxxWAVExxxx'), 'wav')).toBe(true);
    expect(hasAudioHeader(bytes('xxxxftypM4Axxxxx'), 'm4a')).toBe(true);
    expect(hasAudioHeader(new Uint8Array([255, 241, ...new Array(14).fill(0)]), 'aac')).toBe(true);
    expect(hasAudioHeader(bytes('<!doctype html>'), 'mp3')).toBe(false);
    expect(hasAudioHeader(bytes('ID3'), 'mp3')).toBe(false);
  });
  it('refuses path traversal and non-owned files', () => {
    expect(isOwnedAudioFilename('audio-123-abcd.mp3')).toBe(true);
    for (const name of ['../audio-123-abcd.mp3', 'file:///documents/a.mp3', 'audio-123-abcd.mp3/../a', 'audio-123-a%2f.mp3', 'a.mp3']) {
      expect(isOwnedAudioFilename(name)).toBe(false);
      expect(() => audioFile(name)).toThrow('storage');
    }
  });
  it('downloads and persists an offline copy, isolates scopes and safely removes it', async () => {
    const { db } = database();
    const scope = personalSongKey('song', 'a');
    const attachment = await importRehearsalAudio(db, scope, { uri: 'https://example.com/demo.mp3', name: 'demo.mp3' });
    expect(audioFile(attachment.filename).exists).toBe(true);
    expect(await loadAudioAttachments(db, scope)).toEqual([attachment]);
    expect(await loadAudioAttachments(db, personalSongKey('song', 'b'))).toEqual([]);
    await expect(removeAudioAttachment(db, personalSongKey('song', 'b'), attachment.filename)).rejects.toThrow('missing');
    expect(audioFile(attachment.filename).exists).toBe(true);
    await removeAudioAttachment(db, scope, attachment.filename);
    expect(audioFile(attachment.filename).exists).toBe(false);
    expect(await loadAudioAttachments(db, scope)).toEqual([]);
  });
  it('awaits picked-file copies before validation and preserves the original on removal', async () => {
    const { db } = database();
    const uri = 'file:///picker/demo.mp3';
    storage.files.set(uri, { size: 128, bytes: new Uint8Array([73, 68, 51, ...new Array(13).fill(0)]) });
    const attachment = await importRehearsalAudio(db, 'scope', { uri, name: 'demo.mp3', mimeType: 'audio/mpeg' });
    await removeAudioAttachment(db, 'scope', attachment.filename);
    expect(storage.files.has(uri)).toBe(true);
  });
  it('restores audio on SQL deletion failure and permits playback and removal retries', async () => {
    const { db, sql } = database();
    const attachment = await importRehearsalAudio(db, 'scope', { uri: 'https://example.com/demo.mp3', name: 'demo.mp3' });
    const uri = audioFile(attachment.filename).uri;
    const bytes = storage.files.get(uri);
    sql.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON personal_rehearsal_audio BEGIN SELECT RAISE(ABORT, 'locked'); END");
    await expect(removeAudioAttachment(db, 'scope', attachment.filename)).rejects.toThrow('locked');
    expect(await loadAudioAttachments(db, 'scope')).toEqual([attachment]);
    expect([...storage.files.keys()]).toEqual([uri]);
    expect(storage.files.get(audioFile(attachment.filename).uri)).toBe(bytes);
    sql.exec('DROP TRIGGER reject_delete');
    await removeAudioAttachment(db, 'scope', attachment.filename);
    expect(await loadAudioAttachments(db, 'scope')).toEqual([]);
    expect(storage.files.size).toBe(0);
  });
  it('preserves staged bytes when restoration fails and recovers on the next access', async () => {
    const { db, sql } = database();
    const attachment = await importRehearsalAudio(db, 'scope', { uri: 'https://example.com/demo.mp3', name: 'demo.mp3' });
    const uri = audioFile(attachment.filename).uri;
    sql.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON personal_rehearsal_audio BEGIN SELECT RAISE(ABORT, 'locked'); END");
    storage.moveFailure = 'restore';
    await expect(removeAudioAttachment(db, 'scope', attachment.filename)).rejects.toThrow('audio_restore_failed');
    expect(await loadAudioAttachments(db, 'scope')).toEqual([attachment]);
    expect([...storage.files.keys()]).toEqual([`${uri}.deleting`]);
    storage.moveFailure = null;
    expect(audioFile(attachment.filename).exists).toBe(true);
    expect([...storage.files.keys()]).toEqual([uri]);
    sql.exec('DROP TRIGGER reject_delete');
    await removeAudioAttachment(db, 'scope', attachment.filename);
    expect(storage.files.size).toBe(0);
  });
  it('retains the file and metadata when staging fails', async () => {
    const { db } = database();
    const attachment = await importRehearsalAudio(db, 'scope', { uri: 'https://example.com/demo.mp3', name: 'demo.mp3' });
    const uri = audioFile(attachment.filename).uri;
    storage.moveFailure = 'stage';
    await expect(removeAudioAttachment(db, 'scope', attachment.filename)).rejects.toThrow('move failed');
    expect(await loadAudioAttachments(db, 'scope')).toEqual([attachment]);
    expect([...storage.files.keys()]).toEqual([uri]);
  });
  it('reports a committed removal as successful even when staged-byte cleanup fails', async () => {
    const { db } = database();
    const attachment = await importRehearsalAudio(db, 'scope', { uri: 'https://example.com/demo.mp3', name: 'demo.mp3' });
    const uri = audioFile(attachment.filename).uri;
    storage.deleteFailure = true;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await removeAudioAttachment(db, 'scope', attachment.filename);
      expect(await loadAudioAttachments(db, 'scope')).toEqual([]);
      expect([...storage.files.keys()]).toEqual([`${uri}.deleting`]);
      expect(warning).toHaveBeenCalledOnce();
    } finally { warning.mockRestore(); }
  });
  it('removes stale metadata even when the original audio file is already missing', async () => {
    const { db } = database();
    const attachment = await importRehearsalAudio(db, 'scope', { uri: 'https://example.com/demo.mp3', name: 'demo.mp3' });
    storage.files.clear();
    await removeAudioAttachment(db, 'scope', attachment.filename);
    expect(await loadAudioAttachments(db, 'scope')).toEqual([]);
  });
  it('cleans partial files after oversized downloads, bad formats or failed metadata writes', async () => {
    const { db, sql } = database();
    storage.oversized = true;
    await expect(importRehearsalAudio(db, 'scope', { uri: 'https://example.com/demo.mp3', name: 'demo.mp3' })).rejects.toThrow('size');
    expect(storage.files.size).toBe(0);
    storage.oversized = false;
    const bad = 'file:///picker/bad.mp3';
    storage.files.set(bad, { size: 64, bytes: new Uint8Array(16) });
    await expect(importRehearsalAudio(db, 'scope', { uri: bad, name: 'bad.mp3' })).rejects.toThrow('format');
    expect([...storage.files.keys()]).toEqual([bad]);
    sql.exec("CREATE TRIGGER reject_audio BEFORE INSERT ON personal_rehearsal_audio BEGIN SELECT RAISE(ABORT, 'full'); END");
    await expect(importRehearsalAudio(db, 'scope', { uri: 'https://example.com/demo.mp3', name: 'demo.mp3' })).rejects.toThrow('full');
    expect([...storage.files.keys()]).toEqual([bad]);
    expect(await loadAudioAttachments(db, 'scope')).toEqual([]);
  });
  it('honors cancellation while storage initialization is pending', async () => {
    const { db } = database();
    const controller = new AbortController();
    const exec = db.execAsync.bind(db);
    vi.spyOn(db, 'execAsync').mockImplementation(async (query) => { await exec(query); controller.abort(); });
    await expect(importRehearsalAudio(db, 'scope', { uri: 'https://example.com/demo.mp3', name: 'demo.mp3' }, controller.signal)).rejects.toThrow('cancelled');
    expect(storage.files.size).toBe(0);
  });
  it('refuses a tampered metadata path and an already-cancelled import', async () => {
    const { db, sql } = database();
    await loadAudioAttachments(db, 'scope');
    sql.prepare('INSERT INTO personal_rehearsal_audio VALUES (?, ?, ?, ?)').run('scope', '../outside.mp3', 'bad', 128);
    await expect(removeAudioAttachment(db, 'scope', '../outside.mp3')).rejects.toThrow('storage');
    const controller = new AbortController(); controller.abort();
    await expect(importRehearsalAudio(db, 'scope', { uri: 'https://example.com/demo.mp3', name: 'demo.mp3' }, controller.signal)).rejects.toThrow('cancelled');
    expect(storage.files.size).toBe(0);
  });
});
