import { parseDirective, setDirective } from '@songbook/shared';

/** Unlike parsed metadata, editable values must keep the space after the last typed word. */
export function metaInput(head: string, name: string): string {
  const line = head.split('\n').find(line => parseDirective(line)?.name === name);
  if (!line || !line.includes(':')) return '';
  return line.slice(line.indexOf(':') + 1, line.lastIndexOf('}')).replace(/^[ \t]/, '');
}

export function setMetaInput(head: string, name: string, value: string | number | null): string {
  const cleaned = typeof value === 'string' ? value.replace(/[{}]/g, '').replace(/[\r\n]+/g, ' ') : value;
  const next = typeof cleaned === 'string' && !cleaned.trim() ? null : cleaned;
  return setDirective(next === null ? head : head || '\n', name, next);
}
