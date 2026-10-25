// Checks UI translations: every Ukrainian string in the code has a Russian text, Ukrainian JSX
// text is wrapped in t(), and each translation keeps the same {params}. Usage: pnpm test
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ru } from '../src/lib/i18n.ts';

const SRC = new URL('../src/', import.meta.url).pathname;
// Not UI text: the new-song ChordPro template, and language names (shown in their own language).
const NOT_UI = new Set(['{key: C}\\n{time: 4/4}\\n\\n{c: Куплет 1}\\n', 'Українська', 'Русский']);
const CYRILLIC = /[А-Яа-яІіЇїЄєҐґ]/;

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );

const errors: string[] = [];
for (const file of files(SRC)) {
  if (file.endsWith('lib/i18n.ts')) continue;
  const rel = file.slice(SRC.length);
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) // keep line numbers
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const source = readFileSync(file, 'utf8').split('\n');
  code.split('\n').forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    // A line can opt out, e.g. a regex that parses song text.
    if (source[i].includes('i18n-ignore')) return;
    for (const [, s] of line.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g).map((m) => [m[0], m[1] ?? m[2]]))
      if (CYRILLIC.test(s) && !NOT_UI.has(s) && !(s in ru)) errors.push(`${at}: no Russian text for '${s}'`);
    for (const m of line.matchAll(/`[^`]*`/g)) if (CYRILLIC.test(m[0])) errors.push(`${at}: Ukrainian template string, use t(): ${m[0]}`);
    // JSX text: Cyrillic between tags or at the start of a line inside JSX, outside quotes and braces.
    const bare = line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\{[^{}]*\}/g, '');
    if (CYRILLIC.test(bare)) errors.push(`${at}: Ukrainian text outside t(): ${line.trim()}`);
  });
}

const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const [uk, text] of Object.entries(ru)) {
  if (params(uk) !== params(text)) errors.push(`i18n: params differ for '${uk}'`);
  if (uk.split('|').length !== text.split('|').length) errors.push(`i18n: plural forms differ for '${uk}'`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`i18n ok: ${Object.keys(ru).length} Russian texts`);
