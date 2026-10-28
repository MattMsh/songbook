import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireUser } from './auth';
import { fail, sha256, type AppEnv } from './lib';

const RECENT_AUTH_MS = 15 * 60_000;
const RECEIPT_TTL_MS = 30 * 24 * 3600_000;

/** Only a matching deletion receipt can recover a lost response after session invalidation. */
export const account = new Hono<AppEnv>().post('/delete',
  bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
  async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await c.req.json().catch(() => null);
    if (!body || body.confirmation !== 'DELETE') fail(400, 'bad_confirmation');
    if (typeof body.userId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.userId)) fail(400, 'bad_request');
    const token = c.req.header('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) fail(401, 'unauthorized');
    const now = Date.now();
    const receiptHash = await sha256(JSON.stringify([token, body.userId]));
    const receipt = await c.env.DB.prepare(
      'SELECT apple_revocation FROM account_deletion_receipts WHERE request_hash = ? AND created_at >= ?',
    ).bind(receiptHash, now - RECEIPT_TTL_MS).first<{ apple_revocation: number }>();
    if (receipt) return c.json({ ok: true, appleRevocation: receipt.apple_revocation ? 'manual_required' : 'not_applicable' });
    const user = requireUser(c);
    if (body.userId !== user.id) fail(403, 'forbidden');
    const session = await c.env.DB.prepare(
      `SELECT s.created_at, u.apple_sub FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.user_id = ? AND s.expires_at > ?`,
    ).bind(await sha256(token), user.id, now).first<{ created_at: number; apple_sub: string | null }>();
    if (!session) fail(401, 'unauthorized');
    if (session.created_at < now - RECENT_AUTH_MS || session.created_at > now) fail(401, 'recent_auth_required');
    const db = c.env.DB;
    // D1 batches roll back all statements on failure, including the recovery receipt.
    await db.batch([
      db.prepare('DELETE FROM account_deletion_receipts WHERE created_at < ?').bind(now - RECEIPT_TTL_MS),
      db.prepare('INSERT INTO account_deletion_receipts (request_hash, apple_revocation, created_at) VALUES (?, ?, ?)')
        .bind(receiptHash, session.apple_sub ? 1 : 0, now),
      db.prepare('DELETE FROM login_codes WHERE email = (SELECT email FROM users WHERE id = ?)').bind(user.id),
      db.prepare('UPDATE song_versions SET proposal_id = NULL WHERE proposal_id IN (SELECT id FROM proposals WHERE author_id = ?)').bind(user.id),
      db.prepare('UPDATE song_versions SET author_id = NULL WHERE author_id = ?').bind(user.id),
      db.prepare('UPDATE proposals SET reviewer_id = NULL WHERE reviewer_id = ?').bind(user.id),
      db.prepare('DELETE FROM proposals WHERE author_id = ?').bind(user.id),
      db.prepare('DELETE FROM share_links WHERE created_by = ?').bind(user.id),
      db.prepare('UPDATE shared_albums SET created_by = NULL WHERE created_by = ?').bind(user.id),
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
      db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
    ]);
    // TN3194 requires deletion even when this legacy login has no revocable Apple tokens.
    return c.json({ ok: true, appleRevocation: session.apple_sub ? 'manual_required' : 'not_applicable' });
  });
