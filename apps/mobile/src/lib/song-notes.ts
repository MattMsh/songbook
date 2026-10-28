import { DEFAULT_PART_TYPES, matchPart, type ParsedSong, type Section } from '@songbook/shared';
import type { SQLiteDatabase } from 'expo-sqlite';

export interface NoteSection {
  key: string;
  label: string | null;
  kind: Section['kind'];
  preview: string;
  sectionIndex: number;
  /** Exclusive source-line end, including a named comment block's content. */
  endLine: number;
}
export interface SongNote {
  section_key: string;
  label: string;
  preview: string;
  text: string;
}
export const MAX_NOTE_LENGTH = 10000;

export const personalSongKey = (songId: string, userId: string | null) => JSON.stringify([userId, songId]);

/** Content identity prevents an edited or reordered verse from inheriting another verse's note. */
export function noteSections(song: ParsedSong): NoteSection[] {
  const sections: (Section & { sectionIndex: number; endLine: number })[] = [];
  for (let sectionIndex = 0; sectionIndex < song.sections.length; sectionIndex++) {
    const section = song.sections[sectionIndex];
    let current = { ...section, sectionIndex, endLine: 0, lines: [] as Section['lines'] };
    for (let lineIndex = 0; lineIndex < section.lines.length; lineIndex++) {
      const line = section.lines[lineIndex];
      if (line.type === 'comment' && matchPart(line.text, DEFAULT_PART_TYPES)) {
        current.endLine = lineIndex;
        if (current.lines.some((l) => l.type !== 'empty')) sections.push(current);
        current = { kind: section.kind, label: line.text, sectionIndex, endLine: 0, lines: [] };
      } else current.lines.push(line);
    }
    current.endLine = section.lines.length;
    if (current.lines.some((l) => l.type !== 'empty')) sections.push(current);
  }
  const identities = sections.map((s) => JSON.stringify([s.kind, s.label, s.lines.filter((l) => l.type !== 'empty')]));
  return sections.map((section, index) => {
    const identity = identities[index];
    const repeated = identities.filter((key) => key === identity).length > 1;
    // Duplicate sections are ambiguous after a structural edit; retain their notes as unmatched instead.
    const key = repeated ? JSON.stringify([identity, identities, index]) : identity;
    return {
      key,
      label: section.label,
      kind: section.kind,
      sectionIndex: section.sectionIndex,
      endLine: section.endLine,
      preview: section.lines.filter((l) => l.type === 'lyrics').map((l) => l.segments.map((s) => s.text).join('')).join('\n').slice(0, 240),
    };
  });
}

async function ensureNotes(db: SQLiteDatabase) {
  await db.execAsync(`CREATE TABLE IF NOT EXISTS personal_section_notes (
    song_id TEXT NOT NULL, section_key TEXT NOT NULL, label TEXT NOT NULL,
    preview TEXT NOT NULL, text TEXT NOT NULL,
    PRIMARY KEY (song_id, section_key)
  )`);
}

export async function loadSongNotes(db: SQLiteDatabase, songId: string): Promise<SongNote[]> {
  await ensureNotes(db);
  return db.getAllAsync<SongNote>('SELECT section_key, label, preview, text FROM personal_section_notes WHERE song_id = ? ORDER BY rowid', songId);
}

export async function saveSongNote(db: SQLiteDatabase, songId: string, note: SongNote) {
  if (!songId || !note.section_key || note.text.length > MAX_NOTE_LENGTH) throw new Error('Invalid note');
  await ensureNotes(db);
  if (!note.text.trim()) {
    await db.runAsync('DELETE FROM personal_section_notes WHERE song_id = ? AND section_key = ?', songId, note.section_key);
  } else {
    await db.runAsync(`INSERT INTO personal_section_notes (song_id, section_key, label, preview, text)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(song_id, section_key)
      DO UPDATE SET label = excluded.label, preview = excluded.preview, text = excluded.text`,
    songId, note.section_key, note.label, note.preview, note.text);
  }
}
