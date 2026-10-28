import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ remove: vi.fn(), print: vi.fn(), share: vi.fn(), available: vi.fn() }));
vi.mock('expo-file-system', () => ({ File: class { exists = true; delete() { native.remove(); } } }));
vi.mock('expo-print', () => ({ printToFileAsync: native.print }));
vi.mock('expo-sharing', () => ({ shareAsync: native.share, isAvailableAsync: native.available }));
vi.mock('../src/lib/db', () => ({ albumSongIds: vi.fn(), getAlbum: vi.fn(), getAlbumPlan: vi.fn(), getOverride: vi.fn(), getSong: vi.fn() }));
import { albumSongIds, getAlbum, getAlbumPlan, getOverride, getSong } from '../src/lib/db';
import { createPdfDocument, exportPdf } from '../src/lib/pdf';
const db = {} as SQLiteDatabase;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('__DEV__', false);
  vi.mocked(getSong).mockResolvedValue({ id: 'a', title: 'Пісня', chordpro: '{title: Пісня}\n[C]Canonical' } as Awaited<ReturnType<typeof getSong>>);
  vi.mocked(getOverride).mockResolvedValue({ chordpro: '[D]Local arrangement', transpose: 5, capo: 3 } as Awaited<ReturnType<typeof getOverride>>);
  vi.mocked(getAlbum).mockResolvedValue({ id: 1, name: 'План', remote_id: null });
  vi.mocked(getAlbumPlan).mockResolvedValue({ serviceDate: '2026-10-25', notes: 'Public plan notes', songSettings: { a: { transpose: 2, capo: 1 } } });
  vi.mocked(albumSongIds).mockResolvedValue(['a']);
  native.available.mockResolvedValue(true);
  native.print.mockResolvedValue({ uri: 'file:///cache/export.pdf' });
  native.share.mockResolvedValue(undefined);
});
describe('explicit PDF export', () => {
  it('includes local ChordPro and personal offsets for a standalone song', async () => {
    const document = await createPdfDocument(db, { songId: 'a' }, 'musician');
    expect(document.songs[0]).toMatchObject({ chordpro: '[D]Local arrangement', settings: { transpose: 5, capo: 3 } });
    expect(document.notes).toBeUndefined();
  });
  it('uses plan order, metadata and settings instead of personal offsets', async () => {
    const document = await createPdfDocument(db, { albumId: 1 }, 'musician');
    expect(document.title).toBe('План');
    expect(document.serviceDate).toBe('2026-10-25');
    expect(document.notes).toBe('Public plan notes');
    expect(document.songs[0].settings).toEqual({ transpose: 2, capo: 1 });
    vi.mocked(getAlbumPlan).mockResolvedValue({});
    expect((await createPdfDocument(db, { songId: 'a', albumId: 1 }, 'lyrics')).songs[0].settings).toBeUndefined();
  });
  it('refuses empty plans and missing songs rather than silently exporting partial content', async () => {
    vi.mocked(albumSongIds).mockResolvedValue([]);
    await expect(createPdfDocument(db, { albumId: 1 }, 'lyrics')).rejects.toThrow('Альбом порожній');
    vi.mocked(getSong).mockResolvedValue(null);
    await expect(createPdfDocument(db, { songId: 'a' }, 'lyrics')).rejects.toThrow('Пісню видалено');
  });
  it('shares the PDF and removes its temporary file on success and failure', async () => {
    const document = await createPdfDocument(db, { songId: 'a' }, 'lyrics');
    await exportPdf(document);
    expect(native.share).toHaveBeenCalledWith('file:///cache/export.pdf', expect.objectContaining({ mimeType: 'application/pdf' }));
    expect(native.remove).toHaveBeenCalledTimes(1);
    native.share.mockRejectedValue(new Error('share failed'));
    await expect(exportPdf(document)).rejects.toThrow('share failed');
    expect(native.remove).toHaveBeenCalledTimes(2);
  });
  it('does not generate an orphan file when sharing is unavailable', async () => {
    native.available.mockResolvedValue(false);
    await expect(exportPdf(await createPdfDocument(db, { songId: 'a' }, 'lyrics'))).rejects.toThrow('Поширення PDF недоступне');
    expect(native.print).not.toHaveBeenCalled();
  });
});
