-- App-wide settings that admins edit, one JSON value per key (e.g. the song block list).
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
