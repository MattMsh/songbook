/**
 * Song blocks (verse, chorus, …) as admins configure them. A label in a song such as
 * «Приспів x2» or {c: Куплет 1} matches a block by its name or one of its aliases.
 */

/** Colour keys; each app theme maps a key to a readable light and dark shade. */
export const PART_COLORS = ['orange', 'red', 'pink', 'violet', 'blue', 'teal', 'green', 'yellow', 'gray'] as const;
export type PartColor = (typeof PART_COLORS)[number];

export interface PartType {
  id: string;
  /** Shown in settings; also matches labels. */
  name: string;
  /** Other words that name this block in songs, e.g. Russian and English names. */
  aliases: string[];
  color: PartColor;
}

export const DEFAULT_PART_TYPES: PartType[] = [
  { id: 'intro', name: 'Вступ', aliases: ['Вступление', 'Інтро', 'Интро', 'Intro'], color: 'teal' },
  { id: 'verse', name: 'Куплет', aliases: ['Verse'], color: 'orange' },
  { id: 'chorus', name: 'Приспів', aliases: ['Припев', 'Пр', 'Chorus'], color: 'red' },
  { id: 'interlude', name: 'Програш', aliases: ['Проигрыш', 'Interlude', 'Instrumental'], color: 'blue' },
  { id: 'bridge', name: 'Бридж', aliases: ['Брідж', 'Мост', 'Bridge'], color: 'violet' },
  { id: 'prechorus', name: 'Заспів', aliases: ['Запев', 'Передприспів', 'Предприпев', 'Pre-chorus'], color: 'pink' },
  {
    id: 'ending',
    name: 'Завершення',
    aliases: ['Завершение', 'Кінцівка', 'Концовка', 'Кода', 'Outro', 'Ending', 'Тег', 'Tag'],
    color: 'green',
  },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');

/** The block a label names, matched on whole leading words; the longest name wins («Pre-chorus» over «Chorus»). */
export function matchPart(label: string, types: PartType[]): PartType | null {
  const text = norm(label);
  let best: { type: PartType; length: number } | null = null;
  for (const type of types)
    for (const word of [type.name, ...type.aliases].map(norm).filter(Boolean))
      if (text.startsWith(word) && !/\p{L}/u.test(text[word.length] ?? '') && word.length > (best?.length ?? 0))
        best = { type, length: word.length };
  return best?.type ?? null;
}

const LIMITS = { types: 30, name: 40, aliases: 20 };

/** Validates an admin's block list; returns it cleaned, or the name of the first bad field. */
export function parsePartTypes(input: unknown): PartType[] | { error: string } {
  if (!Array.isArray(input) || !input.length || input.length > LIMITS.types) return { error: 'types' };
  const ids = new Set<string>();
  const out: PartType[] = [];
  for (const raw of input) {
    const t = (raw ?? {}) as Record<string, unknown>;
    const id = typeof t.id === 'string' ? t.id.trim() : '';
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    if (!id || id.length > LIMITS.name || ids.has(id)) return { error: 'id' };
    if (!name || name.length > LIMITS.name) return { error: 'name' };
    if (!PART_COLORS.includes(t.color as PartColor)) return { error: 'color' };
    const aliases = Array.isArray(t.aliases) ? t.aliases : [];
    if (aliases.length > LIMITS.aliases || !aliases.every((a) => typeof a === 'string' && a.trim().length <= LIMITS.name))
      return { error: 'aliases' };
    ids.add(id);
    out.push({ id, name, aliases: (aliases as string[]).map((a) => a.trim()).filter(Boolean), color: t.color as PartColor });
  }
  return out;
}
