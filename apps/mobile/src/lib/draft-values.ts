export function draftChanged<T extends object>(draft: T | null, saved: T): boolean {
  return draft !== null && (Object.keys(draft) as (keyof T)[]).some((key) => (draft[key] ?? '') !== (saved[key] ?? ''));
}

export function localCalendarDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date');
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

export function parseLocalCalendarDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(2000, 0, 1, 12);
  date.setFullYear(year, month - 1, day);
  return year > 0 && localCalendarDate(date) === value ? date : undefined;
}
