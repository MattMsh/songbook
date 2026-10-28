import { chordBars, isChordOnlyLine, parseChordPro } from './chordpro';
import { chordContext, type Notation } from './chords';
import { effectiveCapo } from './plans';
import type { AlbumPlan, SongSettings } from './types';

export type PdfVariant = 'lyrics' | 'musician';
export interface PdfSong {
  chordpro: string;
  title?: string;
  settings?: SongSettings;
}
export interface PdfLabels {
  verse: string;
  chorus: string;
  bridge: string;
  key: string;
  capo: string;
  leader: string;
  notes: string;
}
export interface PdfDocument extends Omit<AlbumPlan, 'songSettings'> {
  title: string;
  songs: PdfSong[];
  variant: PdfVariant;
  notation?: Notation;
  labels: PdfLabels;
}

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Self-contained HTML: no scripts, remote assets, or user-controlled markup. */
export function buildPdfHtml(document: PdfDocument): string {
  const e = escapeHtml;
  const { labels, variant } = document;
  const musician = variant === 'musician';
  const note = (value?: string) => value ? `<p class="notes">${e(value)}</p>` : '';
  const songs = document.songs.map((song, index) => {
    const parsed = parseChordPro(song.chordpro);
    const { meta } = parsed;
    const settings = song.settings;
    const capo = effectiveCapo(meta.capo ?? 0, settings?.capo);
    const ctx = chordContext({ key: meta.key, chords: parsed.chords, notation: meta.notation,
      display: document.notation, transpose: settings?.transpose ?? 0, capo, songCapo: meta.capo ?? 0 });
    const title = song.title ?? meta.title;
    const details = musician ? [ctx.soundingKey && `${labels.key}: ${ctx.soundingKey}`,
      `${labels.capo}: ${capo}`, (settings?.bpm ?? meta.tempo) && `${settings?.bpm ?? meta.tempo} BPM`,
      meta.time, meta.rhythm].filter(Boolean).join(' · ') : '';
    const sections = parsed.sections.map((section) => {
      const label = section.label ?? (section.kind ? labels[section.kind] : null);
      const lines = section.lines.map((line) => {
        if (line.type === 'empty') return '<div class="space"></div>';
        if (line.type === 'comment') return `<p class="comment">${e(line.text)}</p>`;
        if (!musician) return isChordOnlyLine(line.segments) ? '' :
          `<div class="line">${e(line.segments.map((segment) => segment.text).join(''))}</div>`;
        const grid = isChordOnlyLine(line.segments) ? chordBars(line.segments) : null;
        if (grid) return `<div class="grid">${grid.bars.map((bar) =>
          `<span class="bar">${bar.map((chord) => e(ctx.map(chord))).join(' ')}</span>`).join('')}${e(grid.rest)}</div>`;
        return `<div class="line">${line.segments.map((segment) => `<span class="segment">${segment.chord === null ? '' :
          `<b class="chord">${e(ctx.map(segment.chord))}</b>`}<span>${e(segment.text) || '&nbsp;'}</span></span>`).join('')}</div>`;
      }).join('');
      return `<section>${label ? `<h3>${e(label)}</h3>` : ''}${lines}</section>`;
    }).join('');
    return `<article><h2>${index + 1}. ${meta.number === null ? '' : `№${meta.number} `}${e(title)}</h2>${details ?
      `<p class="meta">${e(details)}</p>` : ''}${musician ? note(settings?.notes) : ''}${sections}</article>`;
  }).join('');
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${e(document.title)}</title><style>
@page{size:A4;margin:16mm}body{font-family:Arial,sans-serif;color:#111;font-size:13pt;line-height:1.5}h1{font-size:22pt}h2{font-size:19pt;line-height:1.2}h3{font-size:12pt;margin:16px 0 4px}article+article{break-before:page}h2,h3{break-after:avoid}section{margin-bottom:10px}.meta,.comment{font-size:11pt;color:#444}.notes{white-space:pre-wrap}.line{white-space:pre-wrap;break-inside:avoid;min-height:1.5em}.segment{display:inline-flex;flex-direction:column;vertical-align:bottom}.chord{font-size:11pt;min-height:1.5em}.space{height:.65em}.grid{display:flex;flex-wrap:wrap;align-items:center;gap:0;margin:8px 0;break-inside:avoid}.bar{border-left:1px solid #555;border-top:1px solid #bbb;border-bottom:1px solid #bbb;min-width:75px;padding:5px 10px;font-weight:bold}.bar:last-child{border-right:1px solid #555}ol{padding-left:24px}
</style></head><body><header><h1>${e(document.title)}</h1>${document.serviceDate ? `<p>${e(document.serviceDate)}</p>` : ''}${document.leader ?
    `<p>${e(labels.leader)}: ${e(document.leader)}</p>` : ''}${note(document.notes)}${document.songs.length > 1 ?
    `<ol>${document.songs.map((song) => `<li>${e(song.title ?? parseChordPro(song.chordpro).meta.title)}</li>`).join('')}</ol>` : ''}</header>${songs}</body></html>`;
}
