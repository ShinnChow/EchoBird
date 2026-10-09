import { useRef, useState } from 'react';
import * as api from '../../api/tauri';
import { useManagedAccounts } from './useManagedAccounts';

export function useClaudeDesktopAccounts(
  enabled: boolean,
  hasModel: boolean,
  clearModel: () => void,
  showError: (error: string) => void
) {
  const currentAttempt = useRef<string | null>(null);
  const startGeneration = useRef(0);
  const [exitAttempt, setExitAttempt] = useState<string | null>(null);
  const managed = useManagedAccounts<api.ClaudeCodeAccount, api.ClaudeDesktopLogin>(
    'claudedesktop',
    enabled,
    hasModel,
    clearModel,
    showError,
    {
      list: api.listClaudeDesktopAccounts,
      start: async () => {
        const generation = ++startGeneration.current;
        const login = await api.startClaudeDesktopLogin();
        if (startGeneration.current === generation) {
          currentAttempt.current = login.loginId;
          setExitAttempt(null);
        }
        return login;
      },
      poll: async (id, nextStage) => {
        const result = await api.pollClaudeDesktopLogin(id);
        if (currentAttempt.current === id) {
          setExitAttempt(result.awaitingClientExit ? id : null);
          if (result.awaitingClientExit && result.expiresAt !== null) nextStage(result.expiresAt);
        }
        return result.account;
      },
      cancel: (id) => {
        if (currentAttempt.current === id) {
          currentAttempt.current = null;
          setExitAttempt(null);
        }
        return api.cancelClaudeDesktopLogin(id);
      },
      remove: (account) => api.deleteClaudeDesktopAccount(account.id),
      refresh: (account) => api.refreshClaudeDesktopAccount(account.id),
      label: (account) => account.email,
    }
  );
  return {
    ...managed,
    awaitingClientExit: enabled && managed.busy && exitAttempt === managed.login?.loginId,
  };
}
