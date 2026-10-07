import type { TKey } from '../i18n/types';
import { en } from '../i18n/en';

export function isAccountAuthorizationError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error);
  const key = raw.split('|', 1)[0];
  if (!key.startsWith('accountError.')) return false;
  if (key === 'accountError.loginRequired' || key === 'accountError.expired') return true;
  const status = raw.match(/\|HTTP (\d{3})(?:\b|$)/)?.[1];
  return (
    status === '401' ||
    (key === 'accountError.auth' && (status === undefined || status === '400' || status === '403'))
  );
}

/** Backend account errors carry a translation key followed by optional diagnostics. */
export function accountError(error: unknown, t: (key: TKey) => string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const key = raw.split('|', 1)[0];
  if (!key.startsWith('accountError.') || !Object.prototype.hasOwnProperty.call(en, key)) {
    return t('accountError.failed');
  }
  const status = raw.match(/\|HTTP (\d{3})(?:\b|$)/)?.[1];
  return t(key as TKey) + (status ? ` (HTTP ${status})` : '');
}
