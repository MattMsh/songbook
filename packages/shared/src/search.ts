/**
 * Folds Ukrainian and Russian spelling variants together so that
 * «Святий» matches «Святый» and «п'ять» matches «пять».
 */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD') // й→и+˘, ї→і+¨, ё→е+¨; also drops stress marks
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’ʼ`ʻ‘ьъ]/g, '')
    .replace(/[іиы]/g, 'и')
    .replace(/[еєэ]/g, 'е')
    .replace(/ґ/g, 'г')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export type SearchQuery =
  | { kind: 'all' }
  | { kind: 'number'; number: string }
  | { kind: 'text'; tokens: string[] };

export function parseSearch(q: string): SearchQuery {
  const t = q.trim();
  const num = /^№?\s*(\d+)$/.exec(t);
  if (num) return { kind: 'number', number: num[1] };
  const tokens = normalizeSearch(t).split(' ').filter(Boolean);
  return tokens.length ? { kind: 'text', tokens } : { kind: 'all' };
}

/** FTS5 MATCH expression: every token as a quoted prefix, all required. */
export function ftsMatch(tokens: string[]): string {
  return tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
}
