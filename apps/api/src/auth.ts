import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AuthResult, User } from '@songbook/shared';
import { fail, randomHex, readJson, sha256, toUser, type AppEnv, type Bindings, type Ctx, type UserRow } from './lib';

const SESSION_TTL = 90 * 24 * 3600_000;
const CODE_TTL = 15 * 60_000;
const MAX_ATTEMPTS = 5;

export const loadUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.req.header('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  let user: User | null = null;
  if (token) {
    const row = await c.env.DB.prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
      .bind(await sha256(token), Date.now())
      .first<UserRow>();
    if (row) user = toUser(row, c.env);
  }
  c.set('user', user);
  await next();
});

export const requireUser = (c: Ctx): User => c.get('user') ?? fail(401, 'unauthorized');

export function requireAdmin(c: Ctx): User {
  const user = requireUser(c);
  if (user.role !== 'admin') fail(403, 'forbidden');
  return user;
}

/** Musicians and admins: the roles that work with shared albums. */
export function requireMusician(c: Ctx): User {
  const user = requireUser(c);
  if (user.role !== 'admin' && user.role !== 'musician') fail(403, 'forbidden');
  return user;
}

async function createSession(c: Ctx, row: UserRow): Promise<AuthResult> {
  const token = randomHex();
  const now = Date.now();
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), row.id, now, now + SESSION_TTL)
    .run();
  return { token, user: toUser(row, c.env) };
}

async function userByEmail(db: D1Database, email: string, name?: string | null): Promise<UserRow> {
  await db
    .prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING')
    .bind(crypto.randomUUID(), email, name ?? null, Date.now())
    .run();
  return (await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>())!;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendMail(env: Bindings, to: string, subject: string, text: string) {
  if (!env.RESEND_API_KEY) {
    // Outside dev mode a logged code reaches nobody, so say plainly that email login is off.
    if (env.DEV_MODE !== 'true') fail(503, 'provider_not_configured');
    console.log(`[mail] to: ${to}\n${subject}\n\n${text}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject, text }),
  });
  if (!res.ok) {
    console.error('resend failed', res.status, await res.text());
    fail(502, 'mail_failed');
  }
}

const JWKS = {
  apple: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')),
  google: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
};

async function verifyIdToken(env: Bindings, provider: 'apple' | 'google', idToken: string): Promise<JWTPayload> {
  const audience = (provider === 'apple' ? env.APPLE_AUDIENCE : env.GOOGLE_AUDIENCE)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!audience.length) fail(503, 'provider_not_configured');
  const issuer =
    provider === 'apple' ? env.APPLE_ISSUER : [env.GOOGLE_ISSUER, env.GOOGLE_ISSUER.replace(/^https:\/\//, '')];
  try {
    return (await jwtVerify(idToken, JWKS[provider], { issuer, audience })).payload;
  } catch {
    fail(401, 'invalid_token');
  }
}

/** Finds the user by provider subject, else links an existing account by verified email, else creates one. */
async function oauthUser(c: Ctx, provider: 'apple' | 'google', p: JWTPayload, name?: string): Promise<UserRow> {
  const db = c.env.DB;
  const col = provider === 'apple' ? 'apple_sub' : 'google_sub';
  const bySub = await db.prepare(`SELECT * FROM users WHERE ${col} = ?`).bind(p.sub).first<UserRow>();
  if (bySub) return bySub;
  const email = typeof p.email === 'string' ? p.email.toLowerCase() : null;
  const verified = p.email_verified === true || p.email_verified === 'true';
  if (!email) fail(400, 'email_required');
  const existing = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  if (existing && !verified) fail(409, 'email_unverified');
  const user = existing ?? (await userByEmail(db, email, name));
  await db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind(p.sub, user.id).run();
  return user;
}

export const auth = new Hono<AppEnv>()
  .get('/methods', (c) => {
    c.header('Cache-Control', 'no-store');
    const configured = (audience: string) => audience.split(',').some((value) => value.trim());
    return c.json({
      email: c.env.DEV_MODE === 'true' || Boolean(c.env.RESEND_API_KEY?.trim()),
      apple: configured(c.env.APPLE_AUDIENCE ?? ''),
      google: configured(c.env.GOOGLE_AUDIENCE ?? ''),
    });
  })
  .post('/magic/start', async (c) => {
    const { email: raw } = await readJson<{ email: string }>(c);
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email)) fail(400, 'invalid_email');
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
    const token = randomHex();
    await c.env.DB.prepare(
      `INSERT INTO login_codes (email, code_hash, token_hash, expires_at, attempts) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, token_hash = excluded.token_hash,
         expires_at = excluded.expires_at, attempts = 0`,
    )
      .bind(email, await sha256(code), await sha256(token), Date.now() + CODE_TTL)
      .run();
    const link = `songbook://login?email=${encodeURIComponent(email)}&token=${token}`;
    await sendMail(
      c.env,
      email,
      `Код входу до Songbook: ${code}`,
      `Ваш код входу: ${code}\n\nАбо відкрийте посилання на телефоні:\n${link}\n\nКод діє 15 хвилин. Якщо ви не входили, просто проігноруйте цей лист.`,
    );
    return c.json(c.env.DEV_MODE === 'true' ? { ok: true, devCode: code, devToken: token } : { ok: true });
  })
  .post('/magic/verify', async (c) => {
    const body = await readJson<{ email: string; code: string; token: string }>(c);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const db = c.env.DB;
    const row = await db
      .prepare('SELECT * FROM login_codes WHERE email = ?')
      .bind(email)
      .first<{ code_hash: string; token_hash: string; expires_at: number; attempts: number }>();
    if (!row) fail(401, 'invalid_code');
    if (row.expires_at < Date.now()) {
      await db.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
      fail(401, 'expired');
    }
    if (row.attempts >= MAX_ATTEMPTS) fail(429, 'too_many_attempts');
    const ok =
      (typeof body.code === 'string' && (await sha256(body.code.trim())) === row.code_hash) ||
      (typeof body.token === 'string' && (await sha256(body.token)) === row.token_hash);
    if (!ok) {
      await db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').bind(email).run();
      fail(401, 'invalid_code');
    }
    await db.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
    return c.json(await createSession(c, await userByEmail(db, email)));
  })
  .post('/apple', async (c) => {
    const body = await readJson<{ idToken: string; name: string }>(c);
    if (typeof body.idToken !== 'string') fail(400, 'bad_request');
    const payload = await verifyIdToken(c.env, 'apple', body.idToken);
    const name = typeof body.name === 'string' ? body.name : undefined;
    return c.json(await createSession(c, await oauthUser(c, 'apple', payload, name)));
  })
  .post('/google', async (c) => {
    const body = await readJson<{ idToken: string }>(c);
    if (typeof body.idToken !== 'string') fail(400, 'bad_request');
    const payload = await verifyIdToken(c.env, 'google', body.idToken);
    const name = typeof payload.name === 'string' ? payload.name : undefined;
    return c.json(await createSession(c, await oauthUser(c, 'google', payload, name)));
  })
  .post('/logout', async (c) => {
    requireUser(c);
    const token = c.req.header('Authorization')!.slice('Bearer '.length);
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return c.json({ ok: true });
  });
