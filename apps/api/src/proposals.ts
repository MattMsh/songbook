import { Hono } from 'hono';
import { songFields, type Proposal, type ProposalStatus } from '@songbook/shared';
import { requireAdmin, requireUser } from './auth';
import { fail, readJson, requireString, type AppEnv } from './lib';
import { getSong, writeSong } from './songs';

interface ProposalRow {
  id: string;
  kind: 'edit' | 'new';
  song_id: string | null;
  base_version: number | null;
  chordpro: string;
  author_id: string;
  status: ProposalStatus;
  review_comment: string | null;
  created_at: number;
  reviewed_at: number | null;
  author_email: string;
  author_name: string | null;
  current_chordpro?: string | null;
  current_version?: number | null;
}

const SELECT = `SELECT p.*, u.email AS author_email, u.name AS author_name,
  CASE WHEN s.deleted_at IS NULL THEN s.chordpro END AS current_chordpro, s.version AS current_version
  FROM proposals p JOIN users u ON u.id = p.author_id LEFT JOIN songs s ON s.id = p.song_id`;

const toProposal = (r: ProposalRow, withCurrent = false): Proposal => ({
  id: r.id,
  kind: r.kind,
  songId: r.song_id,
  baseVersion: r.base_version,
  chordpro: r.chordpro,
  title: songFields(r.chordpro).title,
  status: r.status,
  reviewComment: r.review_comment,
  createdAt: r.created_at,
  reviewedAt: r.reviewed_at,
  author: { id: r.author_id, email: r.author_email, name: r.author_name },
  current:
    withCurrent && r.current_chordpro != null ? { chordpro: r.current_chordpro, version: r.current_version! } : null,
});

const load = (db: D1Database, id: string) => db.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<ProposalRow>();

export const proposals = new Hono<AppEnv>()
  .post('/', async (c) => {
    const user = requireUser(c);
    const body = await readJson<{ kind: string; songId: string; baseVersion: number; chordpro: string }>(c);
    const chordpro = requireString(body.chordpro, 'chordpro');
    let conflict = false;
    if (body.kind === 'edit') {
      const song = typeof body.songId === 'string' ? await getSong(c.env.DB, body.songId) : null;
      if (!song || song.deleted_at) fail(404, 'not_found');
      if (typeof body.baseVersion !== 'number') fail(400, 'bad_request', { field: 'baseVersion' });
      conflict = body.baseVersion < song.version;
    } else if (body.kind !== 'new') fail(400, 'bad_request', { field: 'kind' });

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO proposals (id, kind, song_id, base_version, chordpro, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, body.kind, body.kind === 'edit' ? body.songId : null, body.baseVersion ?? null, chordpro, user.id, Date.now())
      .run();
    return c.json({ proposal: toProposal((await load(c.env.DB, id))!), conflict }, 201);
  })
  .get('/mine', async (c) => {
    const user = requireUser(c);
    const { results } = await c.env.DB.prepare(`${SELECT} WHERE p.author_id = ? ORDER BY p.created_at DESC`)
      .bind(user.id)
      .all<ProposalRow>();
    return c.json(results.map((r) => toProposal(r)));
  })
  .get('/', async (c) => {
    requireAdmin(c);
    const status = c.req.query('status') ?? 'pending';
    const { results } = await c.env.DB.prepare(`${SELECT} WHERE p.status = ? ORDER BY p.created_at`)
      .bind(status)
      .all<ProposalRow>();
    return c.json(results.map((r) => toProposal(r, true)));
  })
  .post('/:id/approve', async (c) => {
    const admin = requireAdmin(c);
    const db = c.env.DB;
    const p = await load(db, c.req.param('id'));
    if (!p) fail(404, 'not_found');
    if (p.status !== 'pending') fail(409, 'already_reviewed');
    const body = await readJson<{ chordpro: string }>(c);
    const chordpro = body.chordpro === undefined ? p.chordpro : requireString(body.chordpro, 'chordpro');
    const existing = p.kind === 'edit' ? await getSong(db, p.song_id!) : null;
    if (p.kind === 'edit' && (!existing || existing.deleted_at)) fail(409, 'song_deleted');

    const now = Date.now();
    const mark = db
      .prepare(
        `UPDATE proposals SET status = 'approved', chordpro = ?, reviewer_id = ?, reviewed_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(chordpro, admin.id, now, p.id);
    const song = await writeSong(db, { existing, chordpro, authorId: p.author_id, proposalId: p.id, extra: [mark] });
    if (p.kind === 'new') await db.prepare('UPDATE proposals SET song_id = ? WHERE id = ?').bind(song.id, p.id).run();
    return c.json({ proposal: toProposal((await load(db, p.id))!), song });
  })
  .post('/:id/reject', async (c) => {
    const admin = requireAdmin(c);
    const db = c.env.DB;
    const body = await readJson<{ comment: string }>(c);
    const comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null;
    const id = c.req.param('id');
    const res = await db
      .prepare(
        `UPDATE proposals SET status = 'rejected', review_comment = ?, reviewer_id = ?, reviewed_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(comment, admin.id, Date.now(), id)
      .run();
    const p = await load(db, id);
    if (!p) fail(404, 'not_found');
    if (!res.meta.changes) fail(409, 'already_reviewed');
    return c.json({ proposal: toProposal(p) });
  });
