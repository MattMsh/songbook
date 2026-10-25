export interface DiffLine {
  op: 'eq' | 'add' | 'del';
  text: string;
}

/** Line diff based on the longest common subsequence. */
export function lineDiff(before: string, after: string): DiffLine[] {
  // Trailing blank lines are editor noise, not a change.
  const a = before.replace(/\s+$/, '').split('\n');
  const b = after.replace(/\s+$/, '').split('\n');
  const n = a.length;
  const m = b.length;
  // lcs[i * (m + 1) + j] = LCS length of a[i..] and b[j..]
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * (m + 1) + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'eq', text: a[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1]) {
      out.push({ op: 'del', text: a[i++] });
    } else {
      out.push({ op: 'add', text: b[j++] });
    }
  }
  while (i < n) out.push({ op: 'del', text: a[i++] });
  while (j < m) out.push({ op: 'add', text: b[j++] });
  return out;
}

export const hasChanges = (d: DiffLine[]) => d.some((l) => l.op !== 'eq');
