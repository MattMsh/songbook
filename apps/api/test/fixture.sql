-- Five songs with the same updated_at: the sync cursor must page through them without looping.
INSERT INTO songs (id, number, title, key, chordpro, version, updated_at) VALUES
  ('fx-1', 1, 'Перша', 'Am', '{title: Перша}' || char(10) || '{number: 1}' || char(10) || '{key: Am}' || char(10) || '[Am]Слава [F]Тобі', 1, 1000),
  ('fx-2', 2, 'Друга', 'G', '{title: Друга}' || char(10) || '{number: 2}' || char(10) || '{key: G}' || char(10) || '[G]Світло [D]Твоє', 1, 1000),
  ('fx-3', 3, 'Третя', 'C', '{title: Третя}' || char(10) || '{number: 3}' || char(10) || '{key: C}' || char(10) || '[C]Радість [G]моя', 1, 1000),
  ('fx-4', 4, 'Четверта', 'D', '{title: Четверта}' || char(10) || '{number: 4}' || char(10) || '{key: D}' || char(10) || '[D]Хвала [A]Тобі', 1, 1000),
  ('fx-5', 5, 'П''ята', 'E', '{title: П''ята}' || char(10) || '{number: 5}' || char(10) || '{key: E}' || char(10) || '[E]Співаю [B]Тобі', 1, 1000);
INSERT INTO song_versions (song_id, version, chordpro, created_at) SELECT id, version, chordpro, updated_at FROM songs;
