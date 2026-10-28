import Constants from 'expo-constants';
import { t } from './i18n';

// Same host as Metro, so a phone on the same Wi-Fi reaches `wrangler dev --ip 0.0.0.0`.
const host = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? `http://${host}:8787`;

let token: string | null = null;
export const setApiToken = (t: string | null) => {
  token = t;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public body: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15000);
  try {
    const res = await fetch(API_URL + path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error ?? 'http_' + res.status, data);
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'network');
  } finally {
    clearTimeout(timer);
  }
}

/** Server error codes → Ukrainian text, translated by `t` when shown. */
const MESSAGES: Record<string, string> = {
  network: 'Немає зʼєднання з сервером',
  pending_shared_changes: 'Спочатку синхронізуйте зміни спільних альбомів.',
  account_changed: 'Акаунт змінився. Повторіть дію в потрібному акаунті.',
  recent_auth_required: 'Для видалення підтвердьте вхід у цей акаунт ще раз.',
  unauthorized: 'Потрібно увійти',
  forbidden: 'Недостатньо прав',
  not_found: 'Не знайдено',
  invalid_email: 'Невірний email',
  invalid_code: 'Невірний код',
  expired: 'Код прострочений, запросіть новий',
  too_many_attempts: 'Забагато спроб, запросіть новий код',
  version_conflict: 'Пісню вже змінили на сервері. Оновіть і повторіть.',
  number_taken: 'Такий номер уже зайнятий',
  already_reviewed: 'Пропозицію вже розглянули',
  song_deleted: 'Пісню видалено',
  snapshot_in_shared_album: 'Збережену копію можна додати лише до особистого альбому.',
  provider_not_configured: 'Цей спосіб входу не налаштований на сервері',
  invalid_token: 'Не вдалося перевірити вхід',
};

export const errorMessage = (e: unknown) =>
  e instanceof ApiError ? (MESSAGES[e.code] ? t(MESSAGES[e.code]) : t('Помилка: {code}', { code: e.code }))
    : e instanceof Error && MESSAGES[e.message] ? t(MESSAGES[e.message]) : String(e);
