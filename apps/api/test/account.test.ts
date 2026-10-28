/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import app from '../src/index';
import { sha256, type AppEnv } from '../src/lib';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'));
  const db = {
    prepare(sql: string) {
      let args: (string | number | null)[] = [];
      return { bind(...values: (string | number | null)[]) { args = values; return this; },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { return { meta: sqlite.prepare(sql).run(...args) }; } };
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      sqlite.exec('BEGIN');
      try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const now = Date.now();
  sqlite.exec(`INSERT INTO users(id,email,apple_sub,created_at) VALUES ('u1','one@example.com','apple-one',1),('u2','two@example.com',NULL,2);
    INSERT INTO songs(id,title,chordpro,version,updated_at) VALUES ('s1','Church song','[C]Public',1,1);
    INSERT INTO proposals(id,kind,song_id,chordpro,author_id,created_at) VALUES ('p1','edit','s1','[D]Own proposal','u1',1);
    INSERT INTO proposals(id,kind,song_id,chordpro,author_id,status,reviewer_id,created_at) VALUES ('p2','edit','s1','[E]Other proposal','u2','approved','u1',2);
    INSERT INTO song_versions(song_id,version,chordpro,author_id,proposal_id,created_at) VALUES ('s1',1,'[C]Public','u1','p1',1),('s1',2,'[D]Public','u2','p2',2);
    INSERT INTO shared_albums(id,name,created_by,created_at,updated_at) VALUES ('church','Church plan','u1',1,2);
    INSERT INTO login_codes(email,code_hash,token_hash,expires_at) VALUES ('one@example.com','one','one',9999999999999),('two@example.com','two','two',9999999999999);`);
  for (const [token, userId, created] of [['token1', 'u1', now], ['token1-other', 'u1', now], ['old-token', 'u1', now - 16 * 60_000], ['token2', 'u2', now]] as const)
    sqlite.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(await sha256(token), userId, created, now + 3600000);
  sqlite.prepare('INSERT INTO share_links(token,snapshot,created_by,created_at) VALUES (?,?,?,?)').run('a'.repeat(64), '{"private":"snapshot"}', 'u1', now);
  sqlite.prepare('INSERT INTO share_links(token,snapshot,created_by,created_at) VALUES (?,?,?,?)').run('b'.repeat(64), '{}', 'u2', now);
  const env = { DB: db, DEV_MODE: 'false', ADMIN_EMAILS: '', APPLE_AUDIENCE: 'app.id', GOOGLE_AUDIENCE: '' } as unknown as AppEnv['Bindings'];
  const request = (path: string, token?: string, body?: unknown) => app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const remove = (token = 'token1', body: unknown = { confirmation: 'DELETE', userId: 'u1' }) => request('/account/delete', token, body);
  return { sqlite, request, remove, env };
}

describe('authenticated self-account deletion', () => {
  it('removes personal records and all sessions, anonymizes references, and preserves communal content and other accounts', async () => {
    const { sqlite, request, remove } = await fixture();
    const response = await remove();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, appleRevocation: 'manual_required' });
    expect(sqlite.prepare('SELECT * FROM users WHERE id=?').get('u1')).toBeUndefined();
    expect(sqlite.prepare('SELECT * FROM sessions WHERE user_id=?').all('u1')).toHaveLength(0);
    expect(sqlite.prepare('SELECT * FROM login_codes WHERE email=?').get('one@example.com')).toBeUndefined();
    expect(sqlite.prepare('SELECT * FROM proposals WHERE id=?').get('p1')).toBeUndefined();
    expect(sqlite.prepare('SELECT * FROM share_links WHERE created_by=?').all('u1')).toHaveLength(0);
    expect(sqlite.prepare('SELECT reviewer_id FROM proposals WHERE id=?').get('p2')?.reviewer_id).toBeNull();
    expect(sqlite.prepare('SELECT author_id,proposal_id FROM song_versions WHERE version=1').get()).toMatchObject({ author_id: null, proposal_id: null });
    expect(sqlite.prepare('SELECT author_id,proposal_id FROM song_versions WHERE version=2').get()).toMatchObject({ author_id: 'u2', proposal_id: 'p2' });
    expect(sqlite.prepare('SELECT name,created_by FROM shared_albums').get()).toMatchObject({ name: 'Church plan', created_by: null });
    expect(sqlite.prepare('SELECT title FROM songs').get()?.title).toBe('Church song');
    expect(sqlite.prepare('SELECT id FROM users').all()).toMatchObject([{ id: 'u2' }]);
    expect(sqlite.prepare('SELECT email FROM login_codes').all()).toMatchObject([{ email: 'two@example.com' }]);
    expect(sqlite.prepare('SELECT created_by FROM share_links').all()).toMatchObject([{ created_by: 'u2' }]);
    expect((await request('/me', 'token1')).status).toBe(401);
    expect((await request('/me', 'token1-other')).status).toBe(401);
    expect((await request('/me', 'token2')).status).toBe(200);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });
  it('requires authentication, explicit confirmation, a matching account and recent credentials', async () => {
    const { sqlite, request, remove } = await fixture();
    expect((await request('/account/delete', undefined, { confirmation: 'DELETE', userId: 'u1' })).status).toBe(401);
    expect((await remove('token1', { confirmation: 'delete', userId: 'u1' })).status).toBe(400);
    expect((await remove('token1', { confirmation: 'DELETE', userId: 'u2' })).status).toBe(403);
    const old = await remove('old-token');
    expect(old.status).toBe(401);
    expect(await old.json()).toEqual({ error: 'recent_auth_required' });
    expect(sqlite.prepare('SELECT id FROM users').all()).toHaveLength(2);
    expect(sqlite.prepare('SELECT * FROM account_deletion_receipts').all()).toHaveLength(0);
  });
  it('recovers a lost response only with the original bearer and expected account, never resurrecting a session', async () => {
    const { sqlite, request, remove } = await fixture();
    await remove();
    expect((await remove()).status).toBe(200);
    expect((await remove('token1-other')).status).toBe(401);
    expect((await remove('token1', { confirmation: 'DELETE', userId: 'u2' })).status).toBe(401);
    expect((await request('/me', 'token1')).status).toBe(401);
    const receipt = sqlite.prepare('SELECT * FROM account_deletion_receipts').get()!;
    expect(receipt.request_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(receipt).sort()).toEqual(['apple_revocation', 'created_at', 'request_hash']);
    sqlite.prepare('UPDATE account_deletion_receipts SET created_at=0').run();
    expect((await remove()).status).toBe(401);
  });
  it('rolls back sessions, personal rows, references and receipt on any foreign-key failure', async () => {
    const { sqlite, remove, request } = await fixture();
    sqlite.exec("CREATE TABLE deletion_blocker(user_id TEXT REFERENCES users(id)); INSERT INTO deletion_blocker VALUES ('u1')");
    expect((await remove()).status).toBe(500);
    expect(sqlite.prepare('SELECT id FROM users WHERE id=?').get('u1')?.id).toBe('u1');
    expect(sqlite.prepare('SELECT id FROM proposals WHERE author_id=?').all('u1')).toHaveLength(1);
    expect(sqlite.prepare('SELECT * FROM share_links WHERE created_by=?').all('u1')).toHaveLength(1);
    expect(sqlite.prepare('SELECT email FROM login_codes WHERE email=?').get('one@example.com')?.email).toBe('one@example.com');
    expect(sqlite.prepare('SELECT created_by FROM shared_albums').get()?.created_by).toBe('u1');
    expect(sqlite.prepare('SELECT author_id,proposal_id FROM song_versions WHERE version=1').get()).toMatchObject({ author_id: 'u1', proposal_id: 'p1' });
    expect(sqlite.prepare('SELECT * FROM account_deletion_receipts').all()).toHaveLength(0);
    expect((await request('/me', 'token1')).status).toBe(200);
  });
  it('reports available login methods without revealing credentials', async () => {
    const f = await fixture();
    expect(await (await f.request('/auth/methods')).json()).toEqual({ email: false, apple: true, google: false });
    f.env.DEV_MODE = 'true';
    expect(await (await f.request('/auth/methods')).json()).toEqual({ email: true, apple: true, google: false });
    f.env.DEV_MODE = 'false';
    f.env.RESEND_API_KEY = 'not-returned';
    expect(await (await f.request('/auth/methods')).json()).toEqual({ email: true, apple: true, google: false });
  });
});
