import { buildPdfHtml, type SyncPage, type SyncSong } from '@songbook/shared';

const KEY = 'songbook-admin-key';
const TEMPLATE = '{title: Нова пісня}\n{key: C}\n{time: 4/4}\n\n{c: Куплет 1}\n';
const LABELS = { verse: 'Куплет', chorus: 'Приспів', bridge: 'Бридж', key: 'Тональність', capo: 'Капо', leader: 'Ведучий', notes: 'Примітки', gridSource: 'Оригінальна схема' };
const MESSAGES: Record<string, string> = {
  version_conflict: 'Пісню змінено в іншому місці. Скопіюйте свій текст і перезавантажте пісню.',
  number_taken: 'Цей номер уже має інша пісня.',
  not_found: 'Пісню не знайдено. Можливо, її видалили.',
  unauthorized: 'Ключ не підходить.',
  forbidden: 'Ключ не підходить.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const source = $<HTMLTextAreaElement>('source');
const preview = $<HTMLIFrameElement>('preview');
const status = $('status');
const list = $('list');
const search = $<HTMLInputElement>('search');

class ApiError extends Error {
  constructor(public code: string, public extra: Record<string, unknown>) { super(code); }
}

async function api<T>(path: string, init: { method?: string; body?: unknown; key?: string } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { Authorization: `Bearer ${init.key ?? localStorage.getItem(KEY)}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error = 'internal', ...extra } = data as { error?: string };
    if (res.status === 401) logout();
    throw new ApiError(error, extra);
  }
  return data as T;
}

let songs: SyncSong[] = [];
// `current` is the saved version; null id means a new, unsaved song.
let current: { id: string | null; version: number; chordpro: string } | null = null;
const dirty = () => !!current && source.value !== current.chordpro;

function setStatus(text: string, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}
const fail = (e: unknown) => {
  const code = e instanceof ApiError ? e.code : '';
  setStatus(MESSAGES[code] ?? `Помилка: ${code || String(e)}`, true);
  $('reload').hidden = code !== 'version_conflict';
};

function renderList() {
  const q = search.value.trim().toLowerCase();
  list.replaceChildren(...songs
    .filter((s) => !q || s.title.toLowerCase().includes(q) || String(s.number ?? '').startsWith(q))
    .map((s) => {
      const li = document.createElement('li');
      const button = li.appendChild(document.createElement('button'));
      button.textContent = `${s.number ?? '—'}. ${s.title}`;
      button.setAttribute('aria-current', String(s.id === current?.id));
      button.onclick = () => open(s.id);
      return li;
    }));
}

async function loadSongs() {
  const all = new Map<string, SyncSong>();
  let cursor = '';
  for (;;) {
    const page = await api<SyncPage>(`/sync?limit=1000&cursor=${encodeURIComponent(cursor)}`);
    page.songs.forEach((s) => (s.deletedAt ? all.delete(s.id) : all.set(s.id, s)));
    cursor = page.cursor;
    if (!page.hasMore) break;
  }
  songs = [...all.values()].sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.title.localeCompare(b.title, 'uk'));
  renderList();
}

let previewTimer = 0;
function renderPreview() {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    preview.srcdoc = buildPdfHtml({ title: '', songs: [{ chordpro: source.value }], variant: 'musician', labels: LABELS });
  }, 150);
}

function show(song: typeof current) {
  current = song;
  source.value = song?.chordpro ?? '';
  $('empty').hidden = !!song;
  $('toolbar').hidden = $('panes').hidden = !song;
  $<HTMLButtonElement>('delete').disabled = !song?.id;
  $('reload').hidden = true;
  setStatus(song?.id ? `Версія ${song.version}` : 'Нова пісня, ще не збережена');
  renderPreview();
  renderList();
}

const confirmDiscard = () => !dirty() || confirm('Відкинути незбережені зміни?');

async function open(id: string) {
  if (!confirmDiscard()) return;
  try {
    const song = await api<SyncSong>(`/songs/${encodeURIComponent(id)}`);
    show({ id: song.id, version: song.version, chordpro: song.chordpro });
  } catch (e) { fail(e); }
}

async function save() {
  if (!current || !source.value.trim()) return;
  const button = $<HTMLButtonElement>('save');
  button.disabled = true;
  setStatus('Збереження…');
  try {
    const song = current.id
      ? await api<SyncSong>(`/songs/${encodeURIComponent(current.id)}`, { method: 'PUT', body: { chordpro: source.value, baseVersion: current.version } })
      : await api<SyncSong>('/songs', { body: { chordpro: source.value } });
    show({ id: song.id, version: song.version, chordpro: song.chordpro });
    setStatus(`Збережено · версія ${song.version}`);
    await loadSongs();
  } catch (e) { fail(e); }
  finally { button.disabled = false; }
}

async function remove() {
  if (!current?.id) return;
  const title = songs.find((s) => s.id === current!.id)?.title ?? '';
  if (!confirm(`Видалити пісню «${title}»? Вона зникне з застосунку в усіх користувачів.`)) return;
  try {
    await api(`/songs/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
    show(null);
    await loadSongs();
  } catch (e) { fail(e); }
}

function logout() {
  localStorage.removeItem(KEY);
  current = null;
  $('login').hidden = false;
  $('app').hidden = $('app-header').hidden = true;
}

async function start() {
  $('login').hidden = true;
  $('app').hidden = $('app-header').hidden = false;
  show(null);
  await loadSongs();
}

$('login').onsubmit = async (event) => {
  event.preventDefault();
  const key = $<HTMLInputElement>('key').value.trim();
  try {
    await api('/me', { key });
    localStorage.setItem(KEY, key);
    $('login-error').textContent = '';
    await start();
  } catch (e) {
    $('login-error').textContent = MESSAGES[e instanceof ApiError ? e.code : ''] ?? `Помилка: ${String(e)}`;
  }
};
$('logout').onclick = () => { if (confirmDiscard()) logout(); };
$('new').onclick = () => { if (confirmDiscard()) show({ id: null, version: 0, chordpro: TEMPLATE }); };
$('save').onclick = save;
$('delete').onclick = remove;
$('reload').onclick = () => { if (current?.id) open(current.id); };
search.oninput = renderList;
source.oninput = renderPreview;
source.onkeydown = (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); save(); }
};
window.onbeforeunload = (event) => { if (dirty()) event.preventDefault(); };

if (localStorage.getItem(KEY)) start().catch(fail);
else logout();
