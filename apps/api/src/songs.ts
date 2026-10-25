import { Hono } from 'hono';
import { setDirective, songFields, type SyncPage, type SyncSong } from '@songbook/shared';
import { requireAdmin } from './auth';
import { fail, isUniqueError, NEXT_TS, readJson, requireString, toSong, type AppEnv, type SongRow } from './lib';

export const getSong = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM songs WHERE id = ?').bind(id).first<SongRow>();

/**
 * Creates (`existing` = null) or updates a song and records a `song_versions` row.
 * Everything runs in one D1 batch; the UNIQUE constraints on song_versions turn a
 * racing write into a failed batch instead of a lost update.
 */
export async function writeSong(
  db: D1Database,
  o: {
    existing: SongRow | null;
    chordpro: string;
    authorId: string;
    proposalId?: string;
    extra?: D1PreparedStatement[];
  },
): Promise<SyncSong> {
  const { existing } = o;
  let chordpro = o.chordpro;
  let { number } = songFields(chordpro);
  if (number === null) {
    number =
      existing?.number ??
      (await db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM songs WHERE deleted_at IS NULL').first<number>('n'))!;
    chordpro = setDirective(chordpro, 'number', number);
  }
  const f = songFields(chordpro);
  const id = existing?.id ?? crypto.randomUUID();
  const taken = await db
    .prepare('SELECT id FROM songs WHERE number = ? AND deleted_at IS NULL AND id != ?')
    .bind(number, id)
    .first();
  if (taken) fail(409, 'number_taken', { number });

  const now = Date.now();
  const version = (existing?.version ?? 0) + 1;
  const write = existing
    ? db
        .prepare(
          `UPDATE songs SET number = ?, title = ?, key = ?, bpm = ?, time_sig = ?, rhythm = ?, chordpro = ?,
             version = version + 1, updated_at = ${NEXT_TS} WHERE id = ? AND version = ? AND deleted_at IS NULL`,
        )
        .bind(f.number, f.title, f.key, f.bpm, f.timeSig, f.rhythm, chordpro, now, id, existing.version)
    : db
        .prepare(
          `INSERT INTO songs (id, number, title, key, bpm, time_sig, rhythm, chordpro, version, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ${NEXT_TS})`,
        )
        .bind(id, f.number, f.title, f.key, f.bpm, f.timeSig, f.rhythm, chordpro, now);
  const history = db
    .prepare(
      'INSERT INTO song_versions (song_id, version, chordpro, author_id, proposal_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(id, version, chordpro, o.authorId, o.proposalId ?? null, now);
  try {
    await db.batch([write, history, ...(o.extra ?? [])]);
  } catch (e) {
    if (!isUniqueError(e)) throw e;
    const msg = String(e);
    if (msg.includes('songs.number')) fail(409, 'number_taken', { number });
    if (msg.includes('proposal_id')) fail(409, 'already_reviewed');
    fail(409, 'version_conflict');
  }
  return toSong((await getSong(db, id))!);
}

export const songs = new Hono<AppEnv>()
  .get('/:id', async (c) => {
    const row = await getSong(c.env.DB, c.req.param('id'));
    if (!row) fail(404, 'not_found');
    return c.json(toSong(row));
  })
  .post('/', async (c) => {
    const admin = requireAdmin(c);
    const body = await readJson<{ chordpro: string }>(c);
    const chordpro = requireString(body.chordpro, 'chordpro');
    return c.json(await writeSong(c.env.DB, { existing: null, chordpro, authorId: admin.id }), 201);
  })
  .put('/:id', async (c) => {
    const admin = requireAdmin(c);
    const body = await readJson<{ chordpro: string; baseVersion: number }>(c);
    const chordpro = requireString(body.chordpro, 'chordpro');
    if (typeof body.baseVersion !== 'number') fail(400, 'bad_request', { field: 'baseVersion' });
    const existing = await getSong(c.env.DB, c.req.param('id'));
    if (!existing || existing.deleted_at) fail(404, 'not_found');
    if (existing.version !== body.baseVersion) fail(409, 'version_conflict', { currentVersion: existing.version });
    return c.json(await writeSong(c.env.DB, { existing, chordpro, authorId: admin.id }));
  })
  .delete('/:id', async (c) => {
    const admin = requireAdmin(c);
    const db = c.env.DB;
    const existing = await getSong(db, c.req.param('id'));
    if (!existing || existing.deleted_at) fail(404, 'not_found');
    const now = Date.now();
    await db.batch([
      db
        .prepare(
          `UPDATE songs SET deleted_at = ?, version = version + 1, updated_at = ${NEXT_TS} WHERE id = ? AND version = ?`,
        )
        .bind(now, now, existing.id, existing.version),
      db
        .prepare('INSERT INTO song_versions (song_id, version, chordpro, author_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(existing.id, existing.version + 1, existing.chordpro, admin.id, now),
    ]);
    return c.json({ ok: true });
  });

export const sync = new Hono<AppEnv>().get('/', async (c) => {
  const cursor = c.req.query('cursor') ?? '';
  const sep = cursor.indexOf(':');
  const ts = sep > 0 ? Number(cursor.slice(0, sep)) || 0 : 0;
  const afterId = sep > 0 ? cursor.slice(sep + 1) : '';
  const limit = Math.min(1000, Math.max(1, Number(c.req.query('limit')) || 500));
  // A fresh client has nothing to delete, so the first sync skips tombstones.
  const live = cursor ? '' : 'AND deleted_at IS NULL';
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM songs WHERE (updated_at > ?1 OR (updated_at = ?1 AND id > ?2)) ${live}
     ORDER BY updated_at, id LIMIT ?3`,
  )
    .bind(ts, afterId, limit + 1)
    .all<SongRow>();
  const rows = results.slice(0, limit);
  const last = rows.at(-1);
  return c.json<SyncPage>({
    songs: rows.map(toSong),
    cursor: last ? `${last.updated_at}:${last.id}` : cursor,
    hasMore: results.length > limit,
  });
});
