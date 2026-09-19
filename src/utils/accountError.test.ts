import { describe, expect, it } from 'vitest';
import codexSource from '../../src-tauri/src/services/codex_accounts.rs?raw';
import claudeSource from '../../src-tauri/src/services/claude_code_accounts.rs?raw';
import oauthSource from '../../src-tauri/src/services/claude_code_oauth.rs?raw';
import { accountError } from './accountError';
import { en } from '../i18n/en';
import zhHans from '../i18n/zh-Hans';
import zhHant from '../i18n/zh-Hant';
import ja from '../i18n/ja';
import type { TKey } from '../i18n/types';

const t = (key: TKey) => zhHans[key] ?? en[key];

describe('account errors', () => {
  it('localizes both backend strings and Error objects without leaking diagnostics', () => {
    expect(accountError('accountError.expired', t)).toBe(zhHans['accountError.expired']);
    expect(accountError(new Error('accountError.write|Permission denied'), t)).toBe(
      zhHans['accountError.write']
    );
    expect(accountError('accountError.quota|HTTP 429|upstream English error', t)).toBe(
      `${zhHans['accountError.quota']} (HTTP 429)`
    );
  });

  it('uses a localized fallback for unknown system errors and invalid keys', () => {
    for (const error of ['Access is denied', 'accountError.unknown', 'toString', null]) {
      expect(accountError(error, t)).toBe(zhHans['accountError.failed']);
    }
  });

  it('has translations in every language for every backend account error', () => {
    for (const source of [codexSource, claudeSource, oauthSource]) {
      for (const match of source.matchAll(/accountError\.[A-Za-z]+/g)) {
        const key = match[0] as TKey;
        for (const locale of [en, zhHans, zhHant, ja]) expect(locale[key], key).toBeTruthy();
      }
    }
  });
});
