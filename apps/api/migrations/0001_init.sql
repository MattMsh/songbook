CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'musician', 'member')),
  apple_sub TEXT UNIQUE,
  google_sub TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE songs (
  id TEXT PRIMARY KEY,
  number INTEGER,
  title TEXT NOT NULL,
  key TEXT,
  bpm INTEGER,
  time_sig TEXT,
  rhythm TEXT,
  chordpro TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX songs_number_live ON songs(number) WHERE deleted_at IS NULL AND number IS NOT NULL;
CREATE INDEX songs_sync ON songs(updated_at, id);

CREATE TABLE song_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  chordpro TEXT NOT NULL,
  author_id TEXT,
  proposal_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  UNIQUE (song_id, version)
);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('edit', 'new')),
  song_id TEXT,
  base_version INTEGER,
  chordpro TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_comment TEXT,
  reviewer_id TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE INDEX proposals_status ON proposals(status, created_at);
CREATE INDEX proposals_author ON proposals(author_id, created_at);
