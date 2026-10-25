import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

/** Files under `dir` (recursive, sorted) with one of the extensions. */
export function walk(dir: string, exts: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p, exts);
      return exts.includes(extname(e.name).toLowerCase()) ? [p] : [];
    });
}
