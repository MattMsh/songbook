import { parseDirective, partKind } from '@songbook/shared';

export interface SongBlock { marker: string; label: string; text: string }

/** Keep source bytes; unsupported directives stay in the source editor instead of being discarded. */
export function readBlocks(body: string): SongBlock[] | null {
  const blocks: SongBlock[] = [];
  let current: SongBlock = { marker: '', label: '', text: '' };
  for (const line of body.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const directive = parseDirective(line);
    if (directive) {
      if (directive.name !== 'comment' || !partKind(directive.value)) return null;
      if (current.marker || current.text) blocks.push(current);
      current = { marker: line, label: directive.value, text: '' };
    } else current.text += line;
  }
  if (current.marker || current.text || !blocks.length) blocks.push(current);
  return blocks;
}

export function writeBlocks(blocks: SongBlock[]): string {
  return blocks.reduce((body, block, index) => {
    // Moving unlabelled lyrics after a named block must not merge the two blocks.
    const marker = block.marker || (index > 0 ? newBlock('Куплет').marker : '');
    const separator = body && !body.endsWith('\n') && marker ? '\n' : '';
    const afterMarker = marker && !marker.endsWith('\n') && block.text ? '\n' : '';
    return body + separator + marker + afterMarker + block.text;
  }, '');
}

export function newBlock(label: string, text = ''): SongBlock {
  return { marker: `{c: ${label}}\n`, label, text };
}

/** Split before the cursor's line, never inside an existing chord or a word. */
export function splitBlock(block: SongBlock, cursor: number, label: string): SongBlock[] {
  if (cursor <= 0) return [block];
  const at = block.text.lastIndexOf('\n', Math.min(cursor, block.text.length) - 1) + 1;
  if (at <= 0 || !block.text.slice(at).trim()) return [block];
  return [{ ...block, text: block.text.slice(0, at) }, newBlock(label, block.text.slice(at))];
}

export function insertChord(text: string, selection: { start: number; end: number }, chord: string) {
  let start = Math.max(0, Math.min(selection.start, text.length));
  let end = Math.max(start, Math.min(selection.end, text.length));
  if (start > 0 && text.lastIndexOf('[', start - 1) > text.lastIndexOf(']', start - 1)) {
    const close = text.indexOf(']', start);
    if (close >= 0) start = end = close + 1;
  }
  const tag = `${text[start - 1] === '|' ? ' ' : ''}[${chord}]`;
  return { text: text.slice(0, start) + tag + text.slice(end), cursor: start + tag.length };
}
